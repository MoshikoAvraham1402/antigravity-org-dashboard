#!/usr/bin/env bash
# ==============================================================================
# Antigravity Cloud Logging -> BigQuery Sink Provisioning
# Supports Organization-level (recommended), Folder-level, or Single-Project sinks.
#
# Environment / CLI Variables:
#   PROJECT_ID   (Required) Destination GCP Project ID hosting BigQuery
#   ORG_ID       (Optional) GCP Organization ID for org-wide aggregated sink
#   FOLDER_ID    (Optional) GCP Folder ID for folder-wide aggregated sink
#   RAW_DATASET  (Optional) Default: antigravity_raw_logs
#   BQ_LOCATION  (Optional) Default: US
#   SINK_NAME    (Optional) Default: antigravity-org-bq-sink
# ==============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
ORG_ID="${ORG_ID:-}"
FOLDER_ID="${FOLDER_ID:-}"
RAW_DATASET="${RAW_DATASET:-antigravity_raw_logs}"
BQ_LOCATION="${BQ_LOCATION:-US}"
SINK_NAME="${SINK_NAME:-antigravity-org-bq-sink}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: PROJECT_ID must be set (e.g. PROJECT_ID=my-gcp-project ./scripts/setup_org_sink.sh)." >&2
  exit 1
fi

export CLOUDSDK_CORE_PROJECT="${PROJECT_ID}"

echo "==> [1/3] Ensuring BigQuery destination dataset ${PROJECT_ID}:${RAW_DATASET} (${BQ_LOCATION}) exists..."
bq --location="${BQ_LOCATION}" mk --dataset --label datacloud:antigravity \
  --description="Cloud Logging sink destination for Antigravity InferenceResponseLog & ClientTelemetryLog" \
  "${PROJECT_ID}:${RAW_DATASET}" 2>/dev/null || echo "    Dataset ${PROJECT_ID}:${RAW_DATASET} already exists."

LOG_FILTER='resource.type="businessaicode.googleapis.com/BAICInstance" AND (logName:"inference_response" OR logName:"client_telemetry")'
DESTINATION="bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/${RAW_DATASET}"

if [[ -n "${ORG_ID}" ]]; then
  SCOPE_LABEL="Organization ${ORG_ID} (includeChildren=true)"
  SCOPE_FLAGS=(--organization="${ORG_ID}")
  CREATE_EXTRA_FLAGS=(--include-children)
elif [[ -n "${FOLDER_ID}" ]]; then
  SCOPE_LABEL="Folder ${FOLDER_ID} (includeChildren=true)"
  SCOPE_FLAGS=(--folder="${FOLDER_ID}")
  CREATE_EXTRA_FLAGS=(--include-children)
else
  SCOPE_LABEL="Project ${PROJECT_ID}"
  SCOPE_FLAGS=(--project="${PROJECT_ID}")
  CREATE_EXTRA_FLAGS=()
fi

echo "==> [2/3] Provisioning Cloud Logging sink '${SINK_NAME}' on ${SCOPE_LABEL}..."
if gcloud logging sinks describe "${SINK_NAME}" "${SCOPE_FLAGS[@]}" >/dev/null 2>&1; then
  gcloud logging sinks update "${SINK_NAME}" "${DESTINATION}" \
    "${SCOPE_FLAGS[@]}" \
    --log-filter="${LOG_FILTER}"
else
  gcloud logging sinks create "${SINK_NAME}" "${DESTINATION}" \
    "${SCOPE_FLAGS[@]}" \
    "${CREATE_EXTRA_FLAGS[@]}" \
    --use-partitioned-tables \
    --log-filter="${LOG_FILTER}"
fi

WRITER_IDENTITY="$(gcloud logging sinks describe "${SINK_NAME}" "${SCOPE_FLAGS[@]}" --format='value(writerIdentity)')"
echo "    Sink writer identity: ${WRITER_IDENTITY}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_CMD="${PYTHON_BIN:-python3}"
if [[ -x "${SCRIPT_DIR}/../.venv/bin/python" ]]; then
  PY_CMD="${SCRIPT_DIR}/../.venv/bin/python"
fi

echo "==> [3/3] Granting dataset-scoped BigQuery WRITER access on ${PROJECT_ID}:${RAW_DATASET} to ${WRITER_IDENTITY}..."
"${PY_CMD}" - "${PROJECT_ID}" "${RAW_DATASET}" "${WRITER_IDENTITY}" <<'PYEOF'
import sys
from google.cloud import bigquery

project_id, dataset_id, writer_identity = sys.argv[1], sys.argv[2], sys.argv[3]
email = writer_identity.split(":", 1)[1] if ":" in writer_identity else writer_identity

bq = bigquery.Client(project=project_id)
ds = bq.get_dataset(f"{project_id}.{dataset_id}")
entries = list(ds.access_entries)
writer_entry = bigquery.AccessEntry("WRITER", "userByEmail", email)
if writer_entry not in entries:
    entries.append(writer_entry)
    ds.access_entries = entries
    bq.update_dataset(ds, ["access_entries"])
    print(f"    Granted dataset WRITER on {project_id}.{dataset_id} to {email}.")
else:
    print(f"    Dataset WRITER already active for {email}.")
PYEOF

echo "✅ Cloud Logging -> BigQuery sink '${SINK_NAME}' is active!"
echo "   Live tables will populate automatically upon the next Antigravity turn:"
echo "   - ${PROJECT_ID}.${RAW_DATASET}.businessaicode_googleapis_com_inference_response"
echo "   - ${PROJECT_ID}.${RAW_DATASET}.businessaicode_googleapis_com_client_telemetry"
