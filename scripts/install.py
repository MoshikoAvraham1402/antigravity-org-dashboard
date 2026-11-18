#!/usr/bin/env python3
"""
Cross-platform turnkey GCP installer for Antigravity Organization & FinOps Dashboard.
Works identically on Windows, macOS, Linux, and Google Cloud Shell.

Usage:
  python scripts/install.py --project YOUR_PROJECT_ID [options]
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.telemetry_utils import is_valid_dns_domain  # noqa: E402

AUTH_SECRET_NAME = "antigravity-dashboard-auth-token"


def _gcloud_bin() -> str:
    return shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"


def _bq_bin() -> str:
    return shutil.which("bq") or shutil.which("bq.cmd") or "bq"


def run_cmd(
    args: list[str],
    capture: bool = False,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(
        args,
        cwd=str(ROOT_DIR),
        text=True,
        input=input_text,
        capture_output=capture,
        check=check,
        env=env,
    )


def ensure_venv_python() -> str:
    venv_dir = ROOT_DIR / ".venv"
    if os.name == "nt":
        py_bin = venv_dir / "Scripts" / "python.exe"
    else:
        py_bin = venv_dir / "bin" / "python"

    if not py_bin.exists():
        print("==> Preparing Python virtual environment (.venv)...")
        run_cmd([sys.executable, "-m", "venv", str(venv_dir)])

    print("==> Installing/verifying Python dependencies...")
    run_cmd([str(py_bin), "-m", "pip", "install", "--quiet", "--upgrade", "pip"])
    run_cmd([str(py_bin), "-m", "pip", "install", "--quiet", "-r", str(ROOT_DIR / "requirements.txt")])
    return str(py_bin)


def choose_access_security(
    org_id: str,
    explicit_access: str | None,
    explicit_token: str,
    generate_token: bool,
    no_prompt: bool,
) -> tuple[str, str, bool]:
    """Interactively resolve access mode ('iap' or 'public') and optional DASHBOARD_AUTH_TOKEN.

    Returns (access_mode, auth_token, was_auto_generated).
    """
    if explicit_token:
        return (explicit_access or "public"), explicit_token, False
    if generate_token:
        return (explicit_access or "public"), secrets.token_urlsafe(24), True

    if explicit_access == "iap" or no_prompt or not sys.stdin.isatty():
        mode = explicit_access or ("iap" if org_id else "public")
        return mode, "", False

    print("")
    print("------------------------------------------------------------------------------")
    if explicit_access == "public":
        if org_id:
            print(f"  Dashboard Access Security (Public URL Selected · Org: {org_id})")
        else:
            print("  Dashboard Access Security (No GCP Organization detected)")
        print("------------------------------------------------------------------------------")
        print("  Notice: The service is configured for public mode (without built-in IAP).")
        if not org_id:
            print("  Because this project has no GCP Organization, Workspace IAP is unavailable.")
        print("  To protect your telemetry data, you can set DASHBOARD_AUTH_TOKEN on Cloud Run")
        print("  (stored securely in Secret Manager) or enable IAP under a Workspace Org.")
        print("")
        print("  [1] Protect with a password / token (Recommended — sets DASHBOARD_AUTH_TOKEN)")
        print("  [2] Continue with open public access (no password)")
        choice = input("  Select access protection [1/2, default 1]: ").strip() or "1"
        if choice == "2":
            return "public", "", False
    elif org_id:
        print(f"  Dashboard Access Security (GCP Organization: {org_id})")
        print("------------------------------------------------------------------------------")
        print("  [1] Zero-Trust IAP (Recommended for Enterprise / Workspace)")
        print("  [2] Password / Token-protected Public URL (DASHBOARD_AUTH_TOKEN)")
        print("  [3] Public unauthenticated URL (no password — open access)")
        choice = input("  Select access mode [1/2/3, default 1]: ").strip() or "1"
        if choice == "1":
            return "iap", "", False
        if choice == "3":
            return "public", "", False
    else:
        print("  Dashboard Access Security (No GCP Organization detected)")
        print("------------------------------------------------------------------------------")
        print("  Notice: Currently the service deploys in public mode (because this project")
        print("  has no GCP Organization for built-in Workspace IAP). To protect access to")
        print("  your telemetry data, you can set a password/token (DASHBOARD_AUTH_TOKEN in")
        print("  Cloud Run / Secret Manager) or host under a Workspace Organization for IAP.")
        print("")
        print("  [1] Password / Token-protected URL (Recommended — sets DASHBOARD_AUTH_TOKEN)")
        print("  [2] Public unauthenticated URL (open access, no password)")
        print("  [3] Zero-Trust IAP (only if your project has an IAP OAuth brand)")
        choice = input("  Select access mode [1/2/3, default 1]: ").strip() or "1"
        if choice == "2":
            return "public", "", False
        if choice == "3":
            return "iap", "", False

    entered = getpass.getpass(
        "  Enter dashboard password/token (min 8 chars recommended, press Enter to auto-generate): "
    ).strip()
    if entered:
        if len(entered) < 8:
            print("    [Note] Password is shorter than 8 chars; a 12+ character passphrase is recommended.")
        return "public", entered, False
    return "public", secrets.token_urlsafe(24), True


def store_auth_token_secret(gcloud: str, project_id: str, sa_email: str, token: str) -> bool:
    """Store DASHBOARD_AUTH_TOKEN in GCP Secret Manager and bind secretAccessor to runtime SA."""
    try:
        run_cmd([gcloud, "services", "enable", "secretmanager.googleapis.com", f"--project={project_id}"], capture=True)
        desc = run_cmd([gcloud, "secrets", "describe", AUTH_SECRET_NAME, f"--project={project_id}"], capture=True, check=False)
        if desc.returncode != 0:
            run_cmd(
                [
                    gcloud,
                    "secrets",
                    "create",
                    AUTH_SECRET_NAME,
                    "--replication-policy=automatic",
                    "--labels=datacloud=antigravity",
                    f"--project={project_id}",
                ],
                capture=True,
            )
        run_cmd(
            [gcloud, "secrets", "versions", "add", AUTH_SECRET_NAME, "--data-file=-", f"--project={project_id}"],
            input_text=token,
            capture=True,
        )
        run_cmd(
            [
                gcloud,
                "secrets",
                "add-iam-policy-binding",
                AUTH_SECRET_NAME,
                f"--project={project_id}",
                f"--member=serviceAccount:{sa_email}",
                "--role=roles/secretmanager.secretAccessor",
                "--condition=None",
            ],
            capture=True,
        )
        print(f"    Stored DASHBOARD_AUTH_TOKEN securely in Secret Manager ({AUTH_SECRET_NAME}).")
        return True
    except Exception as exc:
        print(f"    [Warning] Secret Manager setup failed ({exc}); falling back to Cloud Run env var.")
        return False


def ensure_runtime_sa_early(gcloud: str, project_id: str, sa_id: str = "antigravity-dashboard-sa") -> str:
    sa_email = f"{sa_id}@{project_id}.iam.gserviceaccount.com"
    desc = run_cmd([gcloud, "iam", "service-accounts", "describe", sa_email, f"--project={project_id}"], capture=True, check=False)
    if desc.returncode != 0:
        run_cmd(
            [
                gcloud,
                "iam",
                "service-accounts",
                "create",
                sa_id,
                "--display-name=Antigravity Dashboard Least-Privilege Runtime SA",
                f"--project={project_id}",
            ],
            capture=True,
            check=False,
        )
    return sa_email


def ensure_project_sink(
    gcloud: str,
    bq: str,
    project_id: str,
    raw_dataset: str,
    bq_location: str,
    sink_name: str,
    org_id: str,
    folder_id: str,
    py_bin: str,
) -> None:
    log_filter = 'resource.type="businessaicode.googleapis.com/BAICInstance" AND (logName:"inference_response" OR logName:"client_telemetry")'
    destination = f"bigquery.googleapis.com/projects/{project_id}/datasets/{raw_dataset}"

    if org_id:
        scope_flags = [f"--organization={org_id}"]
        extra_flags = ["--include-children"]
        scope_label = f"Organization {org_id}"
    elif folder_id:
        scope_flags = [f"--folder={folder_id}"]
        extra_flags = ["--include-children"]
        scope_label = f"Folder {folder_id}"
    else:
        scope_flags = [f"--project={project_id}"]
        extra_flags = []
        scope_label = f"Project {project_id}"

    print(f"==> [Step 4/6] Configuring Cloud Logging -> BigQuery sink '{sink_name}' on {scope_label}...")
    desc = run_cmd([gcloud, "logging", "sinks", "describe", sink_name, *scope_flags], capture=True, check=False)
    if desc.returncode == 0:
        res = run_cmd(
            [gcloud, "logging", "sinks", "update", sink_name, destination, *scope_flags, f"--log-filter={log_filter}"],
            check=False,
        )
    else:
        res = run_cmd(
            [
                gcloud,
                "logging",
                "sinks",
                "create",
                sink_name,
                destination,
                *scope_flags,
                *extra_flags,
                "--use-partitioned-tables",
                f"--log-filter={log_filter}",
            ],
            check=False,
        )

    if res.returncode != 0 and (org_id or folder_id):
        print("    [Warning] Organization/Folder sink permission denied; falling back to Project-scoped sink.")
        ensure_project_sink(gcloud, bq, project_id, raw_dataset, bq_location, sink_name, "", "", py_bin)
        return
    if res.returncode != 0:
        raise RuntimeError(f"Failed to configure Cloud Logging sink '{sink_name}'.")

    writer_res = run_cmd(
        [gcloud, "logging", "sinks", "describe", sink_name, *scope_flags, "--format=value(writerIdentity)"],
        capture=True,
    )
    writer_id = writer_res.stdout.strip()
    if writer_id:
        grant_code = (
            "import sys; from google.cloud import bigquery; "
            "from backend.telemetry_utils import get_gcp_credentials; "
            "p, d, w = sys.argv[1:4]; email = w.split(':', 1)[1] if ':' in w else w; "
            "creds, _ = get_gcp_credentials(scopes=['https://www.googleapis.com/auth/cloud-platform']); "
            "bq = bigquery.Client(project=p, credentials=creds); ds = bq.get_dataset(f'{p}.{d}'); "
            "entries = list(ds.access_entries); e = bigquery.AccessEntry('WRITER', 'userByEmail', email); "
            "(entries.append(e), setattr(ds, 'access_entries', entries), bq.update_dataset(ds, ['access_entries'])) if e not in entries else None; "
            "print(f'    Sink writer WRITER verified on {p}.{d} for {email}.')"
        )
        run_cmd([py_bin, "-c", grant_code, project_id, raw_dataset, writer_id])


def main() -> None:
    parser = argparse.ArgumentParser(description="Cross-platform turnkey installer for Antigravity Dashboard.")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", ""), required=True, help="Host GCP Project ID")
    parser.add_argument("--org", default=os.getenv("GCP_ORG_ID", ""), help="Optional GCP Organization ID")
    parser.add_argument("--folder", default=os.getenv("GCP_FOLDER_ID", ""), help="Optional GCP Folder ID")
    parser.add_argument("--region", default=os.getenv("GCP_REGION", "us-central1"))
    parser.add_argument("--bq-location", default=os.getenv("BQ_LOCATION", "US"))
    parser.add_argument("--domain", default=os.getenv("GCP_ORG_DOMAIN", ""))
    parser.add_argument("--timezone", default=os.getenv("ORG_TIMEZONE", "UTC"))
    parser.add_argument("--billing-table", default=os.getenv("BILLING_EXPORT_TABLE", ""))
    parser.add_argument("--access", choices=["iap", "public"], default=None, help="Ingress mode ('iap' or 'public')")
    parser.add_argument("--auth-token", default=os.getenv("DASHBOARD_AUTH_TOKEN", ""), help="Optional password/token for public deployments")
    parser.add_argument("--generate-token", action="store_true", help="Auto-generate a secure random DASHBOARD_AUTH_TOKEN")
    parser.add_argument("--no-auth-prompt", action="store_true", help="Skip interactive access-security prompt")
    parser.add_argument("--service", default=os.getenv("SERVICE_NAME", "antigravity-usage-dashboard"))
    parser.add_argument("--monitoring-dataset", default=os.getenv("MONITORING_DATASET", "antigravity_monitoring"))
    parser.add_argument("--raw-dataset", default=os.getenv("RAW_LOGS_DATASET", "antigravity_raw_logs"))
    parser.add_argument("--sink-name", default=os.getenv("LOGGING_SINK_NAME", "antigravity-org-bq-sink"))
    parser.add_argument("--scan-projects", default=os.getenv("ORG_PROJECTS", ""), help="Comma-separated GCP projects to monitor")
    parser.add_argument("--backfill-days", type=int, default=30)
    parser.add_argument("--no-vertex-telemetry", action="store_true")
    parser.add_argument("--sync-local", action="store_true", help="Also sync local ~/.gemini/antigravity metadata")
    parser.add_argument("--skip-backfill", action="store_true")
    parser.add_argument("--skip-sink", action="store_true")
    args = parser.parse_args()

    gcloud = _gcloud_bin()
    bq = _bq_bin()
    project_id = args.project.strip()
    id_re = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")
    if not id_re.match(project_id) or not id_re.match(args.service) or not id_re.match(args.region):
        raise SystemExit("Error: invalid GCP project, service, or region identifier.")
    if not re.match(r"^[A-Za-z0-9_]{1,128}$", args.monitoring_dataset) or not re.match(
        r"^[A-Za-z0-9_]{1,128}$", args.raw_dataset
    ):
        raise SystemExit("Error: invalid BigQuery dataset identifier.")

    print(f"==> [Step 1/6] Enabling required GCP APIs on {project_id}...")
    run_cmd(
        [
            gcloud,
            "services",
            "enable",
            "run.googleapis.com",
            "cloudbuild.googleapis.com",
            "artifactregistry.googleapis.com",
            "bigquery.googleapis.com",
            "logging.googleapis.com",
            "monitoring.googleapis.com",
            "cloudresourcemanager.googleapis.com",
            "iam.googleapis.com",
            "iap.googleapis.com",
            f"--project={project_id}",
        ]
    )

    proj_num = run_cmd(
        [gcloud, "projects", "describe", project_id, "--format=value(projectNumber)"],
        capture=True,
    ).stdout.strip()

    org_id = args.org.strip()
    folder_id = args.folder.strip()
    if not org_id and not folder_id:
        anc = run_cmd([gcloud, "projects", "get-ancestors", project_id, "--format=json"], capture=True, check=False)
        if anc.returncode == 0 and anc.stdout.strip():
            try:
                orgs = [x["id"] for x in json.loads(anc.stdout) if x.get("type") == "organization"]
                if orgs:
                    org_id = str(orgs[0])
            except Exception:
                pass

    org_domain = args.domain.strip().lower()
    if not org_domain and org_id:
        d_res = run_cmd([gcloud, "organizations", "describe", org_id, "--format=value(displayName)"], capture=True, check=False)
        candidate = d_res.stdout.strip().lower()
        if is_valid_dns_domain(candidate):
            org_domain = candidate

    access_mode, auth_token, generated_token = choose_access_security(
        org_id=org_id,
        explicit_access=args.access,
        explicit_token=args.auth_token.strip(),
        generate_token=args.generate_token,
        no_prompt=args.no_auth_prompt,
    )

    print("==> [Step 2/6] Setting up Python provisioning environment...")
    py_bin = ensure_venv_python()

    print("==> [Step 3/6] Bootstrapping BigQuery datasets, pricing catalog & views...")
    run_cmd(
        [
            py_bin,
            str(ROOT_DIR / "scripts" / "bootstrap_bigquery.py"),
            "--project",
            project_id,
            "--location",
            args.bq_location,
            "--monitoring-dataset",
            args.monitoring_dataset,
            "--raw-dataset",
            args.raw_dataset,
            "--refresh-pricing",
        ]
    )

    if not args.skip_sink:
        ensure_project_sink(
            gcloud,
            bq,
            project_id,
            args.raw_dataset,
            args.bq_location,
            args.sink_name,
            org_id,
            folder_id,
            py_bin,
        )

    if not args.skip_backfill:
        print(f"==> [Step 5/6] Backfilling last {args.backfill_days} days of telemetry...")
        bf_cmd = [
            py_bin,
            str(ROOT_DIR / "scripts" / "backfill_real_logs.py"),
            "--project",
            project_id,
            "--dataset",
            args.monitoring_dataset,
            "--days",
            str(args.backfill_days),
        ]
        if args.scan_projects:
            bf_cmd.extend(["--projects", args.scan_projects])
        if args.no_vertex_telemetry:
            bf_cmd.append("--no-vertex")
        run_cmd(bf_cmd, check=False)

    if args.sync_local:
        print("==> Syncing local workstation Antigravity session metadata...")
        run_cmd(
            [
                py_bin,
                str(ROOT_DIR / "scripts" / "sync_local_antigravity.py"),
                "--project",
                project_id,
                "--dataset",
                args.monitoring_dataset,
                "--days",
                str(args.backfill_days),
            ],
            check=False,
        )

    print(f"==> [Step 6/6] Building & deploying Cloud Run service '{args.service}'...")
    sa_email = ensure_runtime_sa_early(gcloud, project_id)
    require_iap = "false" if access_mode == "public" else "true"
    vertex_flag = "false" if args.no_vertex_telemetry else "true"

    env_dict = {
        "GCP_PROJECT_ID": project_id,
        "GCP_PROJECT_NUMBER": proj_num,
        "GCP_REGION": args.region,
        "GCP_ORG_ID": org_id,
        "GCP_ORG_DOMAIN": org_domain,
        "ORG_TIMEZONE": args.timezone,
        "MONITORING_DATASET": args.monitoring_dataset,
        "RAW_LOGS_DATASET": args.raw_dataset,
        "LOGGING_SINK_NAME": args.sink_name,
        "ORG_PROJECTS": args.scan_projects,
        "BILLING_EXPORT_TABLE": args.billing_table,
        "REQUIRE_IAP_AUTH": require_iap,
        "ENABLE_VERTEX_TELEMETRY": vertex_flag,
    }

    secret_flags: list[str] = []
    if auth_token:
        if store_auth_token_secret(gcloud, project_id, sa_email, auth_token):
            secret_flags.append(f"--set-secrets=DASHBOARD_AUTH_TOKEN={AUTH_SECRET_NAME}:latest")
        else:
            env_dict["DASHBOARD_AUTH_TOKEN"] = auth_token
    else:
        secret_flags.append("--clear-secrets")

    auth_flag = "--allow-unauthenticated" if access_mode == "public" else "--no-allow-unauthenticated"

    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False, encoding="utf-8") as tf:
        for k, v in env_dict.items():
            tf.write(f"{k}: {json.dumps(v)}\n")
        env_file_path = tf.name

    try:
        run_cmd(
            [
                gcloud,
                "run",
                "deploy",
                args.service,
                "--source",
                str(ROOT_DIR),
                "--project",
                project_id,
                "--region",
                args.region,
                f"--service-account={sa_email}",
                "--memory",
                "512Mi",
                "--cpu",
                "1",
                "--max-instances",
                "5",
                "--concurrency",
                "40",
                "--port",
                "8080",
                auth_flag,
                f"--env-vars-file={env_file_path}",
                *secret_flags,
                "--labels=datacloud=antigravity,app=antigravity-dashboard",
                "--quiet",
            ]
        )
    finally:
        try:
            os.unlink(env_file_path)
        except OSError:
            pass

    harden_cmd = [
        py_bin,
        str(ROOT_DIR / "scripts" / "harden_cloud_run_security.py"),
        "--project",
        project_id,
        "--region",
        args.region,
        "--service",
        args.service,
        "--access",
        access_mode,
        "--raw-dataset",
        args.raw_dataset,
        "--monitoring-dataset",
        args.monitoring_dataset,
        "--billing-table",
        args.billing_table,
        "--scan-projects",
        args.scan_projects,
    ]
    if args.no_vertex_telemetry:
        harden_cmd.append("--no-monitoring")
    run_cmd(harden_cmd)

    svc_url = run_cmd(
        [gcloud, "run", "services", "describe", args.service, f"--project={project_id}", f"--region={args.region}", "--format=value(status.url)"],
        capture=True,
    ).stdout.strip()

    print(f"\n[OK] Deployment complete! Dashboard URL: {svc_url}")
    print(f"     Access Mode: {access_mode}")
    if auth_token:
        print(f"     Password/Token Protection: ENABLED (Secret Manager: {AUTH_SECRET_NAME})")
        if generated_token:
            print(f"     Generated Access Token (save this now): {auth_token}")
    elif access_mode == "public":
        print("     Note: Dashboard URL is currently public without a password.")
        print("     To add password protection later, re-run with --generate-token or set DASHBOARD_AUTH_TOKEN in Cloud Run.")


if __name__ == "__main__":
    main()
