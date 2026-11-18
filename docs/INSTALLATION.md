# Enterprise Installation & Operations Guide

This guide walks Google Cloud administrators, platform engineers, and FinOps teams through deploying, configuring, securing, and upgrading the **Antigravity Organization Intelligence & FinOps Dashboard** in a customer GCP environment.

---

## 1. Prerequisites & Required IAM Permissions

### Workstation / Cloud Shell Tools
- **Google Cloud CLI (`gcloud` & `bq`)** authenticated via `gcloud auth login` and `gcloud auth application-default login`.
  > **Tip:** Opening this repository directly in **Google Cloud Shell** requires zero local tool installation.
- **Python 3.10+** (used by the provisioning scripts in `scripts/`).

### Deployer IAM Roles
To run `./install.sh` (or `terraform apply`), the deploying principal needs:

| Scope | Required IAM Role(s) | Purpose |
| :--- | :--- | :--- |
| **Host GCP Project** | `roles/serviceusage.serviceUsageAdmin`<br/>`roles/bigquery.admin`<br/>`roles/run.admin`<br/>`roles/cloudbuild.builds.editor`<br/>`roles/iam.serviceAccountAdmin`<br/>`roles/resourcemanager.projectIamAdmin` | Enable APIs, create BigQuery datasets/views, build & deploy Cloud Run, and create the least-privilege `antigravity-dashboard-sa` service account. *(Project `Owner` covers all of these.)* |
| **GCP Organization** *(Recommended)* | `roles/logging.configWriter` | Create the aggregated Organization Cloud Logging sink (`--include-children`) so every existing and future GCP project streams Antigravity telemetry automatically. |
| **GCP Organization** *(Optional, for live `Sync Data`)* | `roles/resourcemanager.organizationAdmin` *(only if binding org-wide `logging.viewer` + `browser`)* | Allows the `Sync Data` button in the UI to poll real-time Cloud Logging metadata across all child projects on demand. |

---

## 2. Ensuring Antigravity Telemetry Logs Are Enabled

Google Antigravity (`businessaicode.googleapis.com`) emits two structured telemetry streams to Google Cloud Logging in each GCP project where Antigravity is enabled:
1. `projects/<PROJECT>/logs/businessaicode.googleapis.com%2Finference_response` (`InferenceResponseLog`) — contains token counts (`promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`), `model`, `experience`, `quotaType`, `toolCalls` count, and `trajectoryId`.
2. `projects/<PROJECT>/logs/businessaicode.googleapis.com%2Fclient_telemetry` (`ClientTelemetryLog`) — contains the authenticated engineer's `authenticationInfo.principalEmail` (when audit principal logging is enabled), `ideInfo.ideName`, `ideInfo.ideVersion`, and matching `requestId` / `trajectoryId`.

Ensure **Data Access Audit Logs** / **Telemetry Logging** for `businessaicode.googleapis.com` (`Google Antigravity` / `Gemini Cloud Assist`) are enabled in **IAM & Admin -> Audit Logs** at your Organization or Folder level if you require per-user email attribution (`user_email`). Even when `principalEmail` is redacted by privacy settings, the dashboard seamlessly attributes sessions by workspace project (`Unattributed (<project_id>)`).

---

## 3. Choosing Your Cloud Logging Sink Scope

The installer supports three telemetry collection topologies:

### Option A: Organization-Wide Aggregated Sink (Recommended)
Captures Antigravity usage across **every project and folder** in your Google Cloud Organization automatically:
```bash
./install.sh \
  --project my-observability-prod \
  --org 123456789012 \
  --region us-central1 \
  --bq-location US
```

### Option B: Folder-Scoped Aggregated Sink
Ideal when Antigravity is used inside a dedicated Engineering or R&D GCP Folder:
```bash
./install.sh \
  --project my-observability-prod \
  --folder 987654321098 \
  --region us-central1 \
  --bq-location US
```

### Option C: Single-Project Sink
If you do not have Organization or Folder `roles/logging.configWriter` permissions, omit `--org` and `--folder` (or let `./install.sh` automatically fall back to project scope):
```bash
./install.sh \
  --project my-single-project \
  --region us-central1 \
  --bq-location US
```

---

## 4. Configuring Ingress Security: Zero-Trust IAP vs. Public Access

### Mode 1: Identity-Aware Proxy (`--access iap`, Default)
Recommended for enterprise deployments. Cloud Run requires Google-authenticated requests routed through **Cloud Run native IAP**, and the FastAPI backend additionally verifies the cryptographic `X-Goog-IAP-JWT-Assertion` signature (`ES256`).

After running `./install.sh --project ... --access iap`, grant access to your leadership group or Google Workspace domain:
```bash
gcloud iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service=antigravity-usage-dashboard \
  --region=us-central1 \
  --project=YOUR_HOST_PROJECT_ID \
  --member="group:finops-leadership@yourdomain.com" \
  --role="roles/iap.httpsResourceAccessor"
```

### Mode 2: Public URL (`--access public`)
If you want the dashboard accessible via its HTTPS URL without IAP (for demos, shared executive links, or when your GCP Org does not use IAP):
```bash
./install.sh \
  --project YOUR_HOST_PROJECT_ID \
  --org YOUR_GCP_ORG_ID \
  --access public
```
> **Note:** If your GCP Organization enforces the `constraints/iam.allowedPolicyMemberDomains` Organization Policy, granting `allUsers` (`--access public`) will be blocked by GCP unless an Org Policy exception is configured on the host project. See [Troubleshooting](TROUBLESHOOTING.md#1-domain-restricted-sharing-blocks---access-public).

---

## 5. Enabling Cross-Project Live "Sync Data" (Optional)

While the Organization Cloud Logging Sink continuously streams new logs to BigQuery automatically, clicking **Sync Data** in the dashboard header queries the Cloud Logging API directly so brand-new turns appear within seconds.

To allow the dashboard's least-privilege service account (`antigravity-dashboard-sa@<HOST_PROJECT>.iam.gserviceaccount.com`) to discover and sync logs across **all child projects** in your Organization:

```bash
SA="serviceAccount:antigravity-dashboard-sa@YOUR_HOST_PROJECT_ID.iam.gserviceaccount.com"

gcloud organizations add-iam-policy-binding YOUR_GCP_ORG_ID \
  --member="${SA}" \
  --role="roles/browser"

gcloud organizations add-iam-policy-binding YOUR_GCP_ORG_ID \
  --member="${SA}" \
  --role="roles/logging.viewer"
```
*(In Terraform, simply set `grant_org_sync_roles = true` in `terraform.tfvars`.)*

---

## 6. Linking Google Cloud Billing Standard Export (Optional)

To unlock actual invoice Gross Cost, Negotiated Credits, Net Spend, and SKU-level breakdowns in the **FinOps & Cloud Billing** workspace tab:

1. Locate your existing BigQuery **Standard Usage Cost Export** table (`gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`).
2. **Important Region Requirement:** BigQuery requires joined/queried datasets in the same query or region context to match location. Deploy your dashboard datasets in the **same BigQuery location** (`--bq-location US` or `--bq-location EU`) as your billing export dataset!
3. Grant `antigravity-dashboard-sa@<HOST_PROJECT>.iam.gserviceaccount.com` **BigQuery Data Viewer** (`roles/bigquery.dataViewer`) on the billing export dataset (if it resides in a separate billing host project, run):
   ```bash
   bq show --format=prettyjson BILLING_PROJECT:BILLING_DATASET > /tmp/ds.json
   # Or grant via gcloud / Console IAM on the dataset: roles/bigquery.dataViewer
   ```
4. Pass `--billing-table BILLING_PROJECT.BILLING_DATASET.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX` to `./install.sh`, or update an existing Cloud Run service at any time:
   ```bash
   gcloud run services update antigravity-usage-dashboard \
     --project YOUR_HOST_PROJECT_ID \
     --region us-central1 \
     --update-env-vars BILLING_EXPORT_TABLE=BILLING_PROJECT.BILLING_DATASET.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX
   ```

---

## 7. Local Development

To run the backend and React frontend locally against your GCP project:

```bash
# 1. Authenticate ADC
gcloud auth application-default login

# 2. Start FastAPI backend on :8080
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GCP_PROJECT_ID=YOUR_HOST_PROJECT_ID
uvicorn backend.main:app --reload --port 8080

# 3. In a second terminal, start Vite dev server on :5173 (proxies /api -> :8080)
cd frontend
npm install
npm run dev
```

---

## 8. Upgrading & Uninstalling

### Upgrading to a Newer Release
Pull the latest repository changes and re-run `./install.sh` with the same `--project` and `--region`. All steps (`bootstrap_bigquery.py`, `setup_org_sink.sh`, `backfill_real_logs.py`, and Cloud Run deploy) are **idempotent** and preserve all historical telemetry and custom pricing rows.

### Clean Uninstall
```bash
# 1. Delete Cloud Run service & runtime Service Account
gcloud run services delete antigravity-usage-dashboard --region=us-central1 --project=YOUR_HOST_PROJECT_ID --quiet
gcloud iam service-accounts delete antigravity-dashboard-sa@YOUR_HOST_PROJECT_ID.iam.gserviceaccount.com --project=YOUR_HOST_PROJECT_ID --quiet

# 2. Remove Cloud Logging Sink (Org or Project level)
gcloud logging sinks delete antigravity-org-bq-sink --organization=YOUR_GCP_ORG_ID --quiet

# 3. Optional: Delete BigQuery datasets (WARNING: permanently deletes historical telemetry)
bq rm -r -f -d YOUR_HOST_PROJECT_ID:antigravity_monitoring
bq rm -r -f -d YOUR_HOST_PROJECT_ID:antigravity_raw_logs
```

---

## 8. Tracking Dashboard Hosting Costs

All resources and BigQuery queries created by this installer carry the GCP billing label **`datacloud=antigravity`**. Filter **Cloud Billing → Reports** by `datacloud = antigravity` or see [`COST_ESTIMATION.md`](COST_ESTIMATION.md) for TCO estimates (`$0–$15/mo` for up to 1,000 engineers) and copy-paste `INFORMATION_SCHEMA` audit queries.
