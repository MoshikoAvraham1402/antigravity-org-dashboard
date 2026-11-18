#!/usr/bin/env python3
"""
Backfills historical Google Antigravity (businessaicode.googleapis.com) telemetry
and optional Vertex AI / Gemini API Cloud Monitoring usage across accessible GCP
projects into BigQuery (metadata only — prompt & code payloads are never extracted).
"""
from __future__ import annotations

import argparse
import collections
import os
import sys
import time
from datetime import datetime, timedelta, timezone
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
from backend.vertex_sync import collect_vertex_telemetry  # noqa: E402


def discover_projects(creds: Any, host_project: str, explicit_csv: str = "") -> tuple[list[str], dict[str, str]]:
    if not creds.token:
        creds.refresh(google.auth.transport.requests.Request())

    explicit = [p.strip() for p in explicit_csv.split(",") if p.strip()]
    num_map: dict[str, str] = {}
    discovered: list[str] = list(explicit)

    try:
        resp = requests.get(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            headers={"Authorization": f"Bearer {creds.token}"},
            params={"filter": "lifecycleState:ACTIVE", "pageSize": 300},
            timeout=20,
        )
        if resp.status_code == 200:
            for p in resp.json().get("projects", []):
                pid = p.get("projectId")
                pnum = str(p.get("projectNumber") or "")
                if pid:
                    if not explicit:
                        discovered.append(pid)
                    if pnum:
                        num_map[pnum] = pid
    except Exception as exc:
        print(f"    Note: Cloud Resource Manager auto-discovery skipped ({exc}); scanning host project only.")

    if host_project not in discovered:
        discovered.insert(0, host_project)
    return list(dict.fromkeys(discovered)), num_map


def post_with_retry(creds: Any, body: dict[str, Any]) -> dict[str, Any]:
    for attempt in range(5):
        if not creds.token:
            creds.refresh(google.auth.transport.requests.Request())
        headers = {"Authorization": f"Bearer {creds.token}"}
        resp = requests.post(
            "https://logging.googleapis.com/v2/entries:list",
            headers=headers,
            json=body,
            timeout=60,
        )
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = 1.5 * (attempt + 1)
            print(f"    Transient HTTP {resp.status_code}, retrying in {wait:.1f}s...")
            time.sleep(wait)
            continue
        return {}
    return {}


def fetch_project_entries(creds: Any, proj: str, log_id_encoded: str, cutoff_iso: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    page_token: str | None = None
    page_num = 0
    while True:
        body: dict[str, Any] = {
            "resourceNames": [f"projects/{proj}"],
            "filter": f'logName="projects/{proj}/logs/{log_id_encoded}" AND timestamp>="{cutoff_iso}"',
            "orderBy": "timestamp desc",
            "pageSize": 500,
        }
        if page_token:
            body["pageToken"] = page_token

        data = post_with_retry(creds, body)
        batch = data.get("entries", [])
        if not batch:
            break
        entries.extend(batch)
        page_num += 1
        if page_num % 10 == 0:
            print(f"    [{proj} / {log_id_encoded}] {len(entries)} entries fetched...")
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    if entries:
        print(f"  -> [{proj}] {log_id_encoded}: {len(entries)} entries")
    return entries


def get_existing_request_ids(bq: bigquery.Client, table_fqn: str) -> tuple[set[str], bool]:
    try:
        t = bq.get_table(table_fqn)
    except NotFound:
        return set(), True

    has_req_count = any(f.name == "request_count" for f in (t.schema or []))
    q = f"SELECT DISTINCT request_id FROM `{table_fqn}` WHERE request_id IS NOT NULL"
    rows = bq.query(q, job_config=bigquery.QueryJobConfig(labels={"datacloud": "antigravity"})).result()
    return {str(r["request_id"]) for r in rows if r.get("request_id")}, has_req_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Antigravity + Vertex telemetry into BigQuery.")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", ""), help="Destination BigQuery GCP Project ID")
    parser.add_argument("--dataset", default=os.getenv("MONITORING_DATASET", "antigravity_monitoring"))
    parser.add_argument("--table", default="real_historical_inference_logs")
    parser.add_argument("--days", type=int, default=30, help="Number of historical days to scan")
    parser.add_argument("--projects", default=os.getenv("ORG_PROJECTS", ""), help="Optional comma-separated GCP project IDs")
    parser.add_argument("--no-vertex", action="store_true", help="Skip Vertex AI / Gemini API Cloud Monitoring metrics")
    args = parser.parse_args()

    creds, detected_proj = get_gcp_credentials(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    project_id = args.project.strip() or detected_proj or ""
    if not project_id:
        raise SystemExit("Error: --project or GCP_PROJECT_ID is required.")

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=max(1, args.days))).strftime("%Y-%m-%dT%H:%M:%SZ")
    scan_projects, num_map = discover_projects(creds, project_id, args.projects)
    print(f"==> Scanning {len(scan_projects)} accessible GCP project(s) since {cutoff_iso}...")

    bq = bigquery.Client(project=project_id, credentials=creds)
    table_fqn = f"{project_id}.{args.dataset}.{args.table}"
    existing_ids, has_req_count = get_existing_request_ids(bq, table_fqn)
    if existing_ids:
        print(f"    Found {len(existing_ids)} existing events in {table_fqn} (deduplicating).")

    tel_entries: list[dict[str, Any]] = []
    for proj in scan_projects:
        tel_entries.extend(fetch_project_entries(creds, proj, "businessaicode.googleapis.com%2Fclient_telemetry", cutoff_iso))

    tool_calls_by_req: dict[str, int] = collections.defaultdict(int)
    for e in tel_entries:
        lbl = e.get("labels") or {}
        jp = e.get("jsonPayload") or {}
        meta = jp.get("metadata") or {}
        if jp.get("eventType") == "InferenceResolved":
            req_id = lbl.get("request_id", "")
            if req_id:
                tool_calls_by_req[req_id] += int(meta.get("toolCallsCount") or 0)

    resp_entries: list[dict[str, Any]] = []
    for proj in scan_projects:
        resp_entries.extend(fetch_project_entries(creds, proj, "businessaicode.googleapis.com%2Finference_response", cutoff_iso))

    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set(existing_ids)

    for e in resp_entries:
        insert_id = e.get("insertId") or ""
        lbl = e.get("labels") or {}
        req_id = lbl.get("request_id") or insert_id
        dedup_key = req_id or insert_id
        if not dedup_key or dedup_key in seen_ids:
            continue
        seen_ids.add(dedup_key)

        res_labels = (e.get("resource") or {}).get("labels") or {}
        container_num = str(res_labels.get("resource_container") or "")
        resolved_proj = num_map.get(container_num, container_num or project_id)

        jp = e.get("jsonPayload") or {}
        meta = jp.get("metadata") or {}

        user_raw = lbl.get("user_id") or "unknown"
        user_email = user_raw[5:] if user_raw.startswith("user:") else user_raw

        prompt_tok = int(meta.get("promptTokenCount") or 0)
        cached_tok = int(meta.get("cachedContentTokenCount") or 0)
        cand_tok = int(meta.get("candidatesTokenCount") or 0)
        thought_tok = int(meta.get("thoughtsTokenCount") or 0)
        total_tok = int(meta.get("totalTokenCount") or (prompt_tok + cand_tok + thought_tok))

        row = {
            "insert_id": insert_id,
            "request_id": req_id,
            "event_ts": e.get("timestamp"),
            "project_id": resolved_proj,
            "resource_container": container_num,
            "user_email": user_email,
            "trajectory_id": lbl.get("trajectory_id") or "",
            "model_id": lbl.get("model") or "unknown",
            "model_provider": lbl.get("model_provider") or "Google",
            "client_name": lbl.get("client_name") or "antigravity_hub",
            "client_version": lbl.get("client_version") or "",
            "experience": jp.get("experience") or "",
            "quota_type": meta.get("quotaType") or "",
            "prompt_tokens": prompt_tok,
            "cached_tokens": cached_tok,
            "output_tokens": cand_tok,
            "thinking_tokens": thought_tok,
            "total_tokens": total_tok,
            "tool_calls_count": int(tool_calls_by_req.get(req_id, 0)),
        }
        if has_req_count:
            row["request_count"] = 1
        rows.append(row)

    baic_count = len(rows)

    if not args.no_vertex:
        if not creds.token:
            creds.refresh(google.auth.transport.requests.Request())
        vertex_rows = collect_vertex_telemetry(creds.token, scan_projects, days=max(1, args.days), existing_ids=seen_ids)
        if not has_req_count:
            for r in vertex_rows:
                r.pop("request_count", None)
        rows.extend(vertex_rows)
        if vertex_rows:
            print(f"  -> Cloud Monitoring (Vertex AI / Gemini API): {len(vertex_rows)} hourly aggregate rows")

    if not rows:
        print("==> Backfill complete: 0 new historical events to insert.")
        return

    schema = [
        bigquery.SchemaField("insert_id", "STRING"),
        bigquery.SchemaField("request_id", "STRING"),
        bigquery.SchemaField("event_ts", "TIMESTAMP"),
        bigquery.SchemaField("project_id", "STRING"),
        bigquery.SchemaField("resource_container", "STRING"),
        bigquery.SchemaField("user_email", "STRING"),
        bigquery.SchemaField("trajectory_id", "STRING"),
        bigquery.SchemaField("model_id", "STRING"),
        bigquery.SchemaField("model_provider", "STRING"),
        bigquery.SchemaField("client_name", "STRING"),
        bigquery.SchemaField("client_version", "STRING"),
        bigquery.SchemaField("experience", "STRING"),
        bigquery.SchemaField("quota_type", "STRING"),
        bigquery.SchemaField("prompt_tokens", "INT64"),
        bigquery.SchemaField("cached_tokens", "INT64"),
        bigquery.SchemaField("output_tokens", "INT64"),
        bigquery.SchemaField("thinking_tokens", "INT64"),
        bigquery.SchemaField("total_tokens", "INT64"),
        bigquery.SchemaField("tool_calls_count", "INT64"),
    ]
    if has_req_count:
        schema.append(bigquery.SchemaField("request_count", "INT64"))

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        time_partitioning=bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY,
            field="event_ts",
        ),
        clustering_fields=["user_email", "model_id", "client_name"],
        labels={"datacloud": "antigravity"},
    )
    load_job = bq.load_table_from_json(rows, table_fqn, job_config=job_config)
    load_job.result()
    print(
        f"[OK] Backfilled {len(rows)} events "
        f"({baic_count} Antigravity Enterprise + {len(rows) - baic_count} Vertex/Gemini API) "
        f"into {table_fqn}."
    )


if __name__ == "__main__":
    main()
