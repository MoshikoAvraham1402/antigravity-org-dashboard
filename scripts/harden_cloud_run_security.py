#!/usr/bin/env python3
"""
Applies Defense-in-Depth Cloud Run runtime security for the Antigravity Dashboard:
1. Dedicated least-privilege runtime service account (antigravity-dashboard-sa) with:
   - dataset-scoped READER access on raw_logs + monitoring (+ billing dataset if set)
   - table-scoped WRITER access strictly on real_historical_inference_logs (for Sync Data)
   - roles/bigquery.jobUser, roles/logging.viewer, and optional roles/monitoring.viewer
2. Configurable ingress auth mode:
   - --access iap    (Default for enterprise installs: IAP Zero-Trust enabled, invokerIamDisabled=False)
   - --access public (Public web URL with invokerIamDisabled=True, protected by rate limits & 150MB BQ scan caps)
3. DDoS & runaway scaling limits (maxInstanceCount=5, maxInstanceRequestConcurrency=40).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import google.auth
import google.auth.transport.requests
import requests
from google.api_core.exceptions import NotFound
from google.cloud import bigquery

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.telemetry_utils import get_gcp_credentials  # noqa: E402


_SAFE_GCP_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")
_SAFE_FQN_RE = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$")


def get_headers() -> dict[str, str]:
    creds, _ = get_gcp_credentials(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not creds.token:
        creds.refresh(google.auth.transport.requests.Request())
    return {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}


def ensure_project_roles(headers: dict[str, str], project_id: str, sa_email: str, roles: tuple[str, ...]) -> None:
    r_pol = requests.post(
        f"https://cloudresourcemanager.googleapis.com/v1/projects/{project_id}:getIamPolicy",
        headers=headers,
        json={},
        timeout=15,
    )
    if r_pol.status_code in (403, 404, 429):
        print(f"    Skipping IAM binding on project {project_id} (HTTP {r_pol.status_code}).")
        return
    r_pol.raise_for_status()
    policy = r_pol.json()
    bindings: list[dict[str, Any]] = policy.setdefault("bindings", [])
    member = f"serviceAccount:{sa_email}"

    changed = False
    for role in roles:
        found = next((b for b in bindings if b.get("role") == role and not b.get("condition")), None)
        if found is None:
            bindings.append({"role": role, "members": [member]})
            changed = True
        elif member not in found.setdefault("members", []):
            found["members"].append(member)
            changed = True

    if changed:
        r_set = requests.post(
            f"https://cloudresourcemanager.googleapis.com/v1/projects/{project_id}:setIamPolicy",
            headers=headers,
            json={"policy": policy},
            timeout=15,
        )
        r_set.raise_for_status()
        print(f"    Granted {', '.join(roles)} on {project_id} to {sa_email}.")
    else:
        print(f"    Project IAM on {project_id} already configured.")


def ensure_least_privilege_sa(
    headers: dict[str, str],
    project_id: str,
    sa_id: str,
    sa_email: str,
    include_monitoring: bool = True,
    scan_projects: list[str] | None = None,
) -> None:
    print(f"==> [1/3] Ensuring dedicated least-privilege Service Account {sa_email}...")
    sa_url = f"https://iam.googleapis.com/v1/projects/{project_id}/serviceAccounts/{sa_email}"
    r = requests.get(sa_url, headers=headers, timeout=15)
    if r.status_code == 404:
        r_create = requests.post(
            f"https://iam.googleapis.com/v1/projects/{project_id}/serviceAccounts",
            headers=headers,
            json={
                "accountId": sa_id,
                "serviceAccount": {
                    "displayName": "Antigravity Dashboard Least-Privilege Runtime SA",
                    "description": "Strictly scoped read-only telemetry/billing viewer + incremental sync inserter.",
                },
            },
            timeout=15,
        )
        r_create.raise_for_status()
        time.sleep(5)
    elif r.status_code != 200:
        r.raise_for_status()

    host_roles = ["roles/bigquery.jobUser", "roles/logging.viewer"]
    if include_monitoring:
        host_roles.append("roles/monitoring.viewer")
    ensure_project_roles(headers, project_id, sa_email, tuple(host_roles))

    for extra_proj in (scan_projects or []):
        if extra_proj and extra_proj != project_id:
            extra_roles = ["roles/logging.viewer"]
            if include_monitoring:
                extra_roles.append("roles/monitoring.viewer")
            ensure_project_roles(headers, extra_proj, sa_email, tuple(extra_roles))


def grant_scoped_bigquery_access(
    headers: dict[str, str],
    project_id: str,
    sa_email: str,
    raw_dataset: str,
    monitoring_dataset: str,
    billing_table: str = "",
) -> None:
    print("==> [2/3] Applying dataset- and table-scoped BigQuery IAM...")
    creds, _ = get_gcp_credentials(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    bq = bigquery.Client(project=project_id, credentials=creds)

    datasets_to_grant = [
        (project_id, raw_dataset),
        (project_id, monitoring_dataset),
    ]
    if billing_table and billing_table.count(".") == 2:
        b_proj, b_ds, _ = billing_table.split(".")
        datasets_to_grant.append((b_proj, b_ds))

    for ds_proj, ds_id in datasets_to_grant:
        try:
            ds_ref = bq.get_dataset(f"{ds_proj}.{ds_id}")
            entries = list(ds_ref.access_entries)
            reader_entry = bigquery.AccessEntry("READER", "userByEmail", sa_email)
            if reader_entry not in entries:
                entries.append(reader_entry)
                ds_ref.access_entries = entries
                bq.update_dataset(ds_ref, ["access_entries"])
                print(f"    Granted dataset READER on {ds_proj}.{ds_id}.")
        except NotFound:
            print(f"    Dataset {ds_proj}.{ds_id} not found; skipping.")

    hist_iam_url = (
        f"https://bigquery.googleapis.com/bigquery/v2/projects/{project_id}"
        f"/datasets/{monitoring_dataset}/tables/real_historical_inference_logs:getIamPolicy"
    )
    r_tbl = requests.post(hist_iam_url, headers=headers, json={}, timeout=15)
    if r_tbl.status_code == 200:
        pol = r_tbl.json()
        bindings = pol.setdefault("bindings", [])
        member = f"serviceAccount:{sa_email}"
        role = "roles/bigquery.dataEditor"
        found = next((b for b in bindings if b.get("role") == role), None)
        if found is None:
            bindings.append({"role": role, "members": [member]})
        elif member not in found.setdefault("members", []):
            found["members"].append(member)
        set_url = hist_iam_url.replace(":getIamPolicy", ":setIamPolicy")
        requests.post(set_url, headers=headers, json={"policy": pol}, timeout=15).raise_for_status()


def patch_cloud_run_service(
    headers: dict[str, str],
    project_id: str,
    region: str,
    service_name: str,
    sa_email: str,
    access_mode: str,
    max_instances: int,
) -> None:
    print(f"==> [3/3] Updating Cloud Run service '{service_name}' (access={access_mode}, maxInstances={max_instances})...")
    svc_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services/{service_name}"
    r_svc = requests.get(svc_url, headers=headers, timeout=15)
    r_svc.raise_for_status()
    svc_body = r_svc.json()

    is_public = access_mode == "public"
    svc_body["invokerIamDisabled"] = is_public
    svc_body["iapEnabled"] = not is_public
    svc_body["scaling"] = {"maxInstanceCount": max_instances}
    labels = svc_body.setdefault("labels", {})
    labels.setdefault("datacloud", "antigravity")
    labels.setdefault("app", "antigravity-dashboard")

    template = svc_body.setdefault("template", {})
    template["serviceAccount"] = sa_email
    template["maxInstanceRequestConcurrency"] = 40
    template.pop("revision", None)

    for ro_key in (
        "uid",
        "generation",
        "createTime",
        "updateTime",
        "deleteTime",
        "expireTime",
        "creator",
        "lastModifier",
        "observedGeneration",
        "terminalCondition",
        "conditions",
        "latestReadyRevision",
        "latestCreatedRevision",
        "trafficStatuses",
        "uri",
        "urls",
        "satisfiesPzs",
        "reconciling",
    ):
        svc_body.pop(ro_key, None)

    update_mask = "invokerIamDisabled,iapEnabled,labels,scaling.maxInstanceCount,template"
    r_patch = requests.patch(
        f"{svc_url}?updateMask={update_mask}",
        headers=headers,
        json=svc_body,
        timeout=30,
    )
    if r_patch.status_code != 200:
        raise RuntimeError(f"Cloud Run patch failed ({r_patch.status_code}): {r_patch.text}")

    op_name = r_patch.json().get("name", "")
    for _ in range(40):
        time.sleep(3)
        r_op = requests.get(f"https://run.googleapis.com/v2/{op_name}", headers=headers, timeout=15)
        if r_op.status_code == 200 and r_op.json().get("done"):
            if "error" in r_op.json():
                raise RuntimeError(f"Operation failed: {json.dumps(r_op.json()['error'])}")
            break

    r_final = requests.get(svc_url, headers=headers, timeout=15).json()
    print("[OK] Cloud Run Hardened Configuration Active:")
    print(
        json.dumps(
            {
                "uri": r_final.get("uri"),
                "invokerIamDisabled": bool(r_final.get("invokerIamDisabled", False)),
                "iapEnabled": bool(r_final.get("iapEnabled", False)),
                "serviceAccount": r_final.get("template", {}).get("serviceAccount"),
                "maxInstanceCount": r_final.get("scaling", {}).get("maxInstanceCount"),
                "maxInstanceRequestConcurrency": r_final.get("template", {}).get("maxInstanceRequestConcurrency"),
            },
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Harden Cloud Run runtime IAM, scaling, and ingress security.")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", ""), help="GCP Project ID")
    parser.add_argument("--region", default=os.getenv("GCP_REGION", "us-central1"), help="Cloud Run region")
    parser.add_argument("--service", default=os.getenv("SERVICE_NAME", "antigravity-usage-dashboard"))
    parser.add_argument("--sa-id", default="antigravity-dashboard-sa")
    parser.add_argument("--access", choices=["iap", "public"], default=os.getenv("ACCESS_MODE", "iap"))
    parser.add_argument("--max-instances", type=int, default=5)
    parser.add_argument("--raw-dataset", default=os.getenv("RAW_LOGS_DATASET", "antigravity_raw_logs"))
    parser.add_argument("--monitoring-dataset", default=os.getenv("MONITORING_DATASET", "antigravity_monitoring"))
    parser.add_argument("--billing-table", default=os.getenv("BILLING_EXPORT_TABLE", ""))
    parser.add_argument("--scan-projects", default=os.getenv("ORG_PROJECTS", ""), help="Comma-separated projects to grant viewer roles on")
    parser.add_argument("--no-monitoring", action="store_true", help="Do not bind roles/monitoring.viewer")
    args = parser.parse_args()

    project_id = args.project.strip()
    if not project_id:
        _, detected = get_gcp_credentials()
        project_id = detected or ""
    if not project_id or not _SAFE_GCP_ID_RE.match(project_id):
        raise SystemExit("Error: valid --project or GCP_PROJECT_ID is required.")
    if not _SAFE_GCP_ID_RE.match(args.raw_dataset) or not _SAFE_GCP_ID_RE.match(args.monitoring_dataset):
        raise SystemExit("Error: invalid BigQuery dataset identifier.")
    if not _SAFE_GCP_ID_RE.match(args.service) or not _SAFE_GCP_ID_RE.match(args.region) or not _SAFE_GCP_ID_RE.match(args.sa_id):
        raise SystemExit("Error: invalid Cloud Run service, region, or service account identifier.")
    clean_billing = args.billing_table.strip().strip("`")
    if clean_billing and not _SAFE_FQN_RE.match(clean_billing):
        raise SystemExit("Error: --billing-table must match project.dataset.table.")

    sa_email = f"{args.sa_id}@{project_id}.iam.gserviceaccount.com"
    scan_list = [p.strip() for p in args.scan_projects.split(",") if p.strip() and _SAFE_GCP_ID_RE.match(p.strip())]
    hdrs = get_headers()
    ensure_least_privilege_sa(
        hdrs,
        project_id,
        args.sa_id,
        sa_email,
        include_monitoring=not args.no_monitoring,
        scan_projects=scan_list,
    )
    grant_scoped_bigquery_access(
        hdrs,
        project_id,
        sa_email,
        args.raw_dataset,
        args.monitoring_dataset,
        clean_billing,
    )
    hdrs = get_headers()
    patch_cloud_run_service(
        hdrs,
        project_id,
        args.region,
        args.service,
        sa_email,
        args.access,
        args.max_instances,
    )


if __name__ == "__main__":
    main()
