#!/usr/bin/env bash
# ==============================================================================
# Antigravity Organization Usage & FinOps Dashboard — Turnkey GCP Installer
#
# Deploys the complete Antigravity Telemetry & FinOps stack into your GCP project:
#   1. Enables required Google Cloud APIs
#   2. Bootstraps BigQuery datasets, reference pricing rates, project directory & SQL views
#   3. Configures the Organization / Folder / Project Cloud Logging -> BigQuery Sink
#   4. Backfills historical Antigravity + optional Vertex AI metadata (last 30 days)
#   5. Builds & deploys the hardened FastAPI + React container to Cloud Run
#   6. Provisions least-privilege runtime Service Account, dataset IAM & IAP/Public/Token ingress
#
# Usage:
#   ./install.sh --project YOUR_PROJECT_ID [options]
#   ./install.sh --help
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

PROJECT_ID="${GCP_PROJECT_ID:-}"
ORG_ID="${GCP_ORG_ID:-}"
FOLDER_ID="${GCP_FOLDER_ID:-}"
REGION="${GCP_REGION:-us-central1}"
BQ_LOCATION="${BQ_LOCATION:-US}"
ORG_DOMAIN="${GCP_ORG_DOMAIN:-}"
ORG_TIMEZONE="${ORG_TIMEZONE:-UTC}"
BILLING_TABLE="${BILLING_EXPORT_TABLE:-}"
SERVICE_NAME="${SERVICE_NAME:-antigravity-usage-dashboard}"
MONITORING_DATASET="${MONITORING_DATASET:-antigravity_monitoring}"
RAW_LOGS_DATASET="${RAW_LOGS_DATASET:-antigravity_raw_logs}"
SINK_NAME="${LOGGING_SINK_NAME:-antigravity-org-bq-sink}"
SCAN_PROJECTS="${ORG_PROJECTS:-}"
ACCESS_MODE=""
AUTH_TOKEN="${DASHBOARD_AUTH_TOKEN:-}"
GENERATE_TOKEN="false"
NO_AUTH_PROMPT="false"
BACKFILL_DAYS=30
ENABLE_VERTEX_TELEMETRY="${ENABLE_VERTEX_TELEMETRY:-true}"
SYNC_LOCAL="false"
SKIP_BACKFILL="false"
SKIP_SINK="false"

usage() {
  cat <<'EOF'
Antigravity Organization Usage & FinOps Dashboard — Turnkey GCP Installer

Usage:
  ./install.sh --project <GCP_PROJECT_ID> [options]

Core Options:
  --project <ID>            (Required) Host GCP Project ID for BigQuery & Cloud Run
  --org <ORG_ID>            GCP Organization ID for org-wide aggregated log sink (auto-detected if omitted)
  --folder <FOLDER_ID>      GCP Folder ID (if scoping the log sink to an engineering folder instead of Org)
  --region <REGION>         Cloud Run deployment region (default: us-central1)
  --bq-location <LOC>       BigQuery dataset location, e.g. US or EU (default: US)
  --domain <DOMAIN>         Workspace DNS domain for IAP domain gating, e.g. acme.com (optional)
  --timezone <TZ>           IANA timezone for 7x24 activity heatmap, e.g. America/New_York (default: UTC)
  --billing-table <FQN>     Optional BigQuery Cloud Billing export table (project.dataset.table)
  --scan-projects <CSV>     Optional comma-separated GCP project IDs to scan during backfill & live sync
  --access <iap|public>     Ingress security mode ('iap' or 'public'; interactive prompt if omitted on TTY)
  --auth-token <TOKEN>      Optional password/token (DASHBOARD_AUTH_TOKEN) to protect a public dashboard
  --generate-token          Auto-generate a random DASHBOARD_AUTH_TOKEN and store it in Secret Manager
  --no-auth-prompt          Skip interactive access security prompt
  --service <NAME>          Cloud Run service name (default: antigravity-usage-dashboard)
  --backfill-days <DAYS>    Days of historical metadata to backfill (default: 30)
  --no-vertex-telemetry     Disable Vertex AI / Gemini API Cloud Monitoring collector
  --sync-local              Also sync local workstation ~/.gemini/antigravity metadata
  --skip-backfill           Skip initial historical backfill
  --skip-sink               Skip Cloud Logging sink creation (if managed externally via Terraform)
  -h, --help                Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --org) ORG_ID="$2"; shift 2 ;;
    --folder) FOLDER_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --bq-location) BQ_LOCATION="$2"; shift 2 ;;
    --domain) ORG_DOMAIN="$2"; shift 2 ;;
    --timezone) ORG_TIMEZONE="$2"; shift 2 ;;
    --billing-table) BILLING_TABLE="$2"; shift 2 ;;
    --scan-projects) SCAN_PROJECTS="$2"; shift 2 ;;
    --access) ACCESS_MODE="$2"; shift 2 ;;
    --auth-token) AUTH_TOKEN="$2"; shift 2 ;;
    --generate-token) GENERATE_TOKEN="true"; shift ;;
    --no-auth-prompt) NO_AUTH_PROMPT="true"; shift ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --backfill-days) BACKFILL_DAYS="$2"; shift 2 ;;
    --no-vertex-telemetry) ENABLE_VERTEX_TELEMETRY="false"; shift ;;
    --sync-local) SYNC_LOCAL="true"; shift ;;
    --skip-backfill) SKIP_BACKFILL="true"; shift ;;
    --skip-sink) SKIP_SINK="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

for cmd in gcloud bq; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: Required CLI '${cmd}' is not installed or not in PATH." >&2
    exit 1
  fi
done

PYTHON_SYS="$(command -v python3 || command -v python || true)"
if [[ -z "${PYTHON_SYS}" ]]; then
  echo "Error: Python 3.10+ is required." >&2
  exit 1
fi

if [[ -n "${ACCESS_MODE}" && "${ACCESS_MODE}" != "iap" && "${ACCESS_MODE}" != "public" ]]; then
  echo "Error: --access must be either 'iap' or 'public' (got '${ACCESS_MODE}')." >&2
  exit 1
fi

if [[ -z "${PROJECT_ID}" ]]; then
  DETECTED_PROJ="$(gcloud config get-value project 2>/dev/null || true)"
  if [[ -t 0 ]]; then
    read -r -p "Enter target GCP Project ID [${DETECTED_PROJ}]: " INPUT_PROJ
    PROJECT_ID="${INPUT_PROJ:-${DETECTED_PROJ}}"
  else
    PROJECT_ID="${DETECTED_PROJ}"
  fi
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: --project <GCP_PROJECT_ID> is required." >&2
  exit 1
fi

export CLOUDSDK_CORE_PROJECT="${PROJECT_ID}"

echo "=============================================================================="
echo "  Antigravity Organization Intelligence & FinOps Dashboard — Installer"
echo "=============================================================================="
echo "  Host GCP Project : ${PROJECT_ID}"
echo "  Cloud Run Region : ${REGION}"
echo "  BigQuery Location: ${BQ_LOCATION}"
echo "=============================================================================="

echo ""
echo "==> [Step 1/6] Enabling required Google Cloud APIs in ${PROJECT_ID}..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  bigquery.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  iap.googleapis.com \
  --project="${PROJECT_ID}"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

if [[ -z "${ORG_ID}" && -z "${FOLDER_ID}" ]]; then
  ORG_ID="$(gcloud projects get-ancestors "${PROJECT_ID}" --format='json' 2>/dev/null \
    | "${PYTHON_SYS}" -c "import sys,json; data=json.load(sys.stdin); orgs=[x['id'] for x in data if x.get('type')=='organization']; print(orgs[0] if orgs else '')" 2>/dev/null || true)"
  if [[ -n "${ORG_ID}" ]]; then
    echo "    Auto-detected GCP Organization ID: ${ORG_ID}"
  fi
fi

if [[ -z "${ORG_DOMAIN}" && -n "${ORG_ID}" ]]; then
  CANDIDATE_DOMAIN="$(gcloud organizations describe "${ORG_ID}" --format='value(displayName)' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
  if [[ "${CANDIDATE_DOMAIN}" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
    ORG_DOMAIN="${CANDIDATE_DOMAIN}"
    echo "    Auto-detected Organization Domain: ${ORG_DOMAIN}"
  fi
fi

GENERATED_TOKEN="false"
if [[ "${GENERATE_TOKEN}" == "true" && -z "${AUTH_TOKEN}" ]]; then
  AUTH_TOKEN="$("${PYTHON_SYS}" -c "import secrets; print(secrets.token_urlsafe(24))")"
  GENERATED_TOKEN="true"
  ACCESS_MODE="${ACCESS_MODE:-public}"
elif [[ -n "${AUTH_TOKEN}" ]]; then
  ACCESS_MODE="${ACCESS_MODE:-public}"
elif [[ "${ACCESS_MODE}" != "iap" && -t 0 && "${NO_AUTH_PROMPT}" != "true" ]]; then
  echo ""
  echo "------------------------------------------------------------------------------"
  if [[ "${ACCESS_MODE}" == "public" ]]; then
    if [[ -n "${ORG_ID}" ]]; then
      echo "  Dashboard Access Security (Public URL Selected · Org: ${ORG_ID})"
    else
      echo "  Dashboard Access Security (No GCP Organization detected)"
    fi
    echo "------------------------------------------------------------------------------"
    echo "  Notice: The service is configured for public mode (without built-in IAP)."
    if [[ -z "${ORG_ID}" ]]; then
      echo "  Because this project has no GCP Organization, Workspace IAP is unavailable."
    fi
    echo "  To protect your telemetry data, you can set DASHBOARD_AUTH_TOKEN on Cloud Run"
    echo "  (stored securely in Secret Manager) or enable IAP under a Workspace Org."
    echo ""
    echo "  [1] Protect with a password / token (Recommended — sets DASHBOARD_AUTH_TOKEN)"
    echo "  [2] Continue with open public access (no password)"
    read -r -p "  Select access protection [1/2, default 1]: " CHOICE
    CHOICE="${CHOICE:-1}"
    if [[ "${CHOICE}" != "2" ]]; then
      WANT_TOKEN="true"
    fi
  elif [[ -n "${ORG_ID}" ]]; then
    echo "  Dashboard Access Security (GCP Organization: ${ORG_ID})"
    echo "------------------------------------------------------------------------------"
    echo "  [1] Zero-Trust IAP (Recommended for Enterprise / Workspace)"
    echo "  [2] Password / Token-protected Public URL (DASHBOARD_AUTH_TOKEN)"
    echo "  [3] Public unauthenticated URL (no password — open access)"
    read -r -p "  Select access mode [1/2/3, default 1]: " CHOICE
    CHOICE="${CHOICE:-1}"
    case "${CHOICE}" in
      1) ACCESS_MODE="iap" ;;
      3) ACCESS_MODE="public" ;;
      *) ACCESS_MODE="public"; WANT_TOKEN="true" ;;
    esac
  else
    echo "  Dashboard Access Security (No GCP Organization detected)"
    echo "------------------------------------------------------------------------------"
    echo "  Notice: Currently the service deploys in public mode (because this project"
    echo "  has no GCP Organization for built-in Workspace IAP). To protect access to"
    echo "  your telemetry data, you can set a password/token (DASHBOARD_AUTH_TOKEN in"
    echo "  Cloud Run / Secret Manager) or host under a Workspace Organization for IAP."
    echo ""
    echo "  [1] Password / Token-protected URL (Recommended — sets DASHBOARD_AUTH_TOKEN)"
    echo "  [2] Public unauthenticated URL (open access, no password)"
    echo "  [3] Zero-Trust IAP (only if your project has an IAP OAuth brand)"
    read -r -p "  Select access mode [1/2/3, default 1]: " CHOICE
    CHOICE="${CHOICE:-1}"
    case "${CHOICE}" in
      2) ACCESS_MODE="public" ;;
      3) ACCESS_MODE="iap" ;;
      *) ACCESS_MODE="public"; WANT_TOKEN="true" ;;
    esac
  fi

  if [[ "${WANT_TOKEN:-false}" == "true" ]]; then
    read -r -s -p "  Enter dashboard password/token (min 8 chars recommended, press Enter to auto-generate): " INPUT_TOK
    echo ""
    if [[ -n "${INPUT_TOK}" ]]; then
      if [[ "${#INPUT_TOK}" -lt 8 ]]; then
        echo "    [Note] Password is shorter than 8 chars; a 12+ character passphrase is recommended."
      fi
      AUTH_TOKEN="${INPUT_TOK}"
    else
      AUTH_TOKEN="$("${PYTHON_SYS}" -c "import secrets; print(secrets.token_urlsafe(24))")"
      GENERATED_TOKEN="true"
    fi
  fi
fi

if [[ -z "${ACCESS_MODE}" ]]; then
  ACCESS_MODE="$([[ -n "${ORG_ID}" ]] && echo "iap" || echo "public")"
fi

echo ""
echo "==> [Step 2/6] Preparing local Python provisioning virtual environment..."
if [[ ! -d "${ROOT_DIR}/.venv" ]]; then
  "${PYTHON_SYS}" -m venv "${ROOT_DIR}/.venv"
fi
VENV_PY="${ROOT_DIR}/.venv/bin/python"
if [[ -x "${ROOT_DIR}/.venv/Scripts/python.exe" ]]; then
  VENV_PY="${ROOT_DIR}/.venv/Scripts/python.exe"
fi
"${VENV_PY}" -m pip install --quiet --upgrade pip
"${VENV_PY}" -m pip install --quiet -r "${ROOT_DIR}/requirements.txt"

echo ""
echo "==> [Step 3/6] Bootstrapping BigQuery datasets, reference pricing & analytical views..."
"${VENV_PY}" "${ROOT_DIR}/scripts/bootstrap_bigquery.py" \
  --project "${PROJECT_ID}" \
  --location "${BQ_LOCATION}" \
  --monitoring-dataset "${MONITORING_DATASET}" \
  --raw-dataset "${RAW_LOGS_DATASET}" \
  --refresh-pricing

echo ""
if [[ "${SKIP_SINK}" == "true" ]]; then
  echo "==> [Step 4/6] Skipping Cloud Logging sink provisioning (--skip-sink)."
else
  echo "==> [Step 4/6] Configuring Cloud Logging -> BigQuery sink (${SINK_NAME})..."
  if ! PROJECT_ID="${PROJECT_ID}" \
       ORG_ID="${ORG_ID}" \
       FOLDER_ID="${FOLDER_ID}" \
       RAW_DATASET="${RAW_LOGS_DATASET}" \
       BQ_LOCATION="${BQ_LOCATION}" \
       SINK_NAME="${SINK_NAME}" \
       PYTHON_BIN="${VENV_PY}" \
       "${ROOT_DIR}/scripts/setup_org_sink.sh"; then
    echo "    [Warning] Organization/Folder sink setup encountered a permission error."
    echo "    Falling back to Project-scoped sink on ${PROJECT_ID}."
    PROJECT_ID="${PROJECT_ID}" \
      ORG_ID="" \
      FOLDER_ID="" \
      RAW_DATASET="${RAW_LOGS_DATASET}" \
      BQ_LOCATION="${BQ_LOCATION}" \
      SINK_NAME="${SINK_NAME}" \
      PYTHON_BIN="${VENV_PY}" \
      "${ROOT_DIR}/scripts/setup_org_sink.sh"
  fi
fi

echo ""
if [[ "${SKIP_BACKFILL}" == "true" ]]; then
  echo "==> [Step 5/6] Skipping historical backfill (--skip-backfill)."
else
  echo "==> [Step 5/6] Backfilling last ${BACKFILL_DAYS} days of historical metadata..."
  BACKFILL_ARGS=(--project "${PROJECT_ID}" --dataset "${MONITORING_DATASET}" --days "${BACKFILL_DAYS}")
  if [[ -n "${SCAN_PROJECTS}" ]]; then
    BACKFILL_ARGS+=(--projects "${SCAN_PROJECTS}")
  fi
  if [[ "${ENABLE_VERTEX_TELEMETRY}" != "true" ]]; then
    BACKFILL_ARGS+=(--no-vertex)
  fi
  "${VENV_PY}" "${ROOT_DIR}/scripts/backfill_real_logs.py" "${BACKFILL_ARGS[@]}" \
    || echo "    [Warning] Historical backfill encountered an error; continuing deployment."
fi

if [[ "${SYNC_LOCAL}" == "true" ]]; then
  echo ""
  echo "==> Syncing local workstation Antigravity session metadata..."
  "${VENV_PY}" "${ROOT_DIR}/scripts/sync_local_antigravity.py" \
    --project "${PROJECT_ID}" \
    --dataset "${MONITORING_DATASET}" \
    --days "${BACKFILL_DAYS}" || echo "    [Warning] Local Antigravity sync skipped."
fi

echo ""
echo "==> [Step 6/6] Building & deploying hardened Cloud Run service (${SERVICE_NAME})..."
SA_EMAIL="antigravity-dashboard-sa@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create antigravity-dashboard-sa \
    --display-name="Antigravity Dashboard Least-Privilege Runtime SA" \
    --project="${PROJECT_ID}" >/dev/null 2>&1 || true

REQUIRE_IAP="true"
if [[ "${ACCESS_MODE}" == "public" ]]; then
  REQUIRE_IAP="false"
fi

SECRET_FLAGS=(--clear-secrets)
AUTH_SECRET_NAME="antigravity-dashboard-auth-token"
FALLBACK_ENV_TOKEN=""
if [[ -n "${AUTH_TOKEN}" ]]; then
  if gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets describe "${AUTH_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
      gcloud secrets create "${AUTH_SECRET_NAME}" --replication-policy=automatic --labels=datacloud=antigravity --project="${PROJECT_ID}" >/dev/null
    printf '%s' "${AUTH_TOKEN}" | gcloud secrets versions add "${AUTH_SECRET_NAME}" --data-file=- --project="${PROJECT_ID}" >/dev/null
    gcloud secrets add-iam-policy-binding "${AUTH_SECRET_NAME}" --project="${PROJECT_ID}" \
      --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" --condition=None >/dev/null
    SECRET_FLAGS=("--set-secrets=DASHBOARD_AUTH_TOKEN=${AUTH_SECRET_NAME}:latest")
    echo "    Stored DASHBOARD_AUTH_TOKEN in Secret Manager (${AUTH_SECRET_NAME})."
  else
    FALLBACK_ENV_TOKEN="${AUTH_TOKEN}"
  fi
fi

ENV_FILE="$(mktemp)"
"${PYTHON_SYS}" - "${ENV_FILE}" \
  "${PROJECT_ID}" "${PROJECT_NUMBER}" "${REGION}" "${ORG_ID}" "${ORG_DOMAIN}" "${ORG_TIMEZONE}" \
  "${MONITORING_DATASET}" "${RAW_LOGS_DATASET}" "${SINK_NAME}" "${SCAN_PROJECTS}" "${BILLING_TABLE}" \
  "${REQUIRE_IAP}" "${ENABLE_VERTEX_TELEMETRY}" "${FALLBACK_ENV_TOKEN}" <<'PYEOF'
import json
import sys

out_path = sys.argv[1]
keys = [
    "GCP_PROJECT_ID",
    "GCP_PROJECT_NUMBER",
    "GCP_REGION",
    "GCP_ORG_ID",
    "GCP_ORG_DOMAIN",
    "ORG_TIMEZONE",
    "MONITORING_DATASET",
    "RAW_LOGS_DATASET",
    "LOGGING_SINK_NAME",
    "ORG_PROJECTS",
    "BILLING_EXPORT_TABLE",
    "REQUIRE_IAP_AUTH",
    "ENABLE_VERTEX_TELEMETRY",
]
env_map = dict(zip(keys, sys.argv[2:15]))
if len(sys.argv) > 15 and sys.argv[15]:
    env_map["DASHBOARD_AUTH_TOKEN"] = sys.argv[15]
with open(out_path, "w", encoding="utf-8") as fh:
    for k, v in env_map.items():
        fh.write(f"{k}: {json.dumps(v)}\n")
PYEOF
trap 'rm -f "${ENV_FILE}"' EXIT

AUTH_FLAG="--no-allow-unauthenticated"
if [[ "${ACCESS_MODE}" == "public" ]]; then
  AUTH_FLAG="--allow-unauthenticated"
fi

gcloud run deploy "${SERVICE_NAME}" \
  --source "${ROOT_DIR}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account="${SA_EMAIL}" \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 5 \
  --concurrency 40 \
  --port 8080 \
  ${AUTH_FLAG} \
  --env-vars-file="${ENV_FILE}" \
  "${SECRET_FLAGS[@]}" \
  --labels "datacloud=antigravity,app=antigravity-dashboard" \
  --quiet

echo ""
echo "==> Applying runtime IAM least-privilege Service Account & ingress security hardening..."
HARDEN_ARGS=(
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --service "${SERVICE_NAME}"
  --access "${ACCESS_MODE}"
  --raw-dataset "${RAW_LOGS_DATASET}"
  --monitoring-dataset "${MONITORING_DATASET}"
  --billing-table "${BILLING_TABLE}"
  --scan-projects "${SCAN_PROJECTS}"
)
if [[ "${ENABLE_VERTEX_TELEMETRY}" != "true" ]]; then
  HARDEN_ARGS+=(--no-monitoring)
fi
"${VENV_PY}" "${ROOT_DIR}/scripts/harden_cloud_run_security.py" "${HARDEN_ARGS[@]}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"

echo ""
echo "=============================================================================="
echo "  Deployment Complete!"
echo "  Dashboard URL : ${SERVICE_URL}"
echo "  Runtime SA    : ${SA_EMAIL}"
echo "  Access Mode   : ${ACCESS_MODE}"
if [[ -n "${AUTH_TOKEN}" ]]; then
  echo "  Auth Token    : ENABLED (Secret Manager: ${AUTH_SECRET_NAME})"
  if [[ "${GENERATED_TOKEN}" == "true" ]]; then
    echo "  Generated Key : ${AUTH_TOKEN}"
  fi
elif [[ "${ACCESS_MODE}" == "public" ]]; then
  echo "  Note: Dashboard URL is currently public without a password."
  echo "  Re-run with --generate-token (or set DASHBOARD_AUTH_TOKEN) to add password protection."
fi
echo "=============================================================================="
