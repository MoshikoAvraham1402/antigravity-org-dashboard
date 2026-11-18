# Deploy Antigravity Organization Intelligence & FinOps Dashboard

Welcome! This interactive tutorial deploys the **Antigravity Organization Intelligence & FinOps Dashboard** (`Cloud Run` + `BigQuery` + `Cloud Logging Sink`) into **your** Google Cloud environment in ~4 minutes.

<walkthrough-tutorial-duration duration="4"></walkthrough-tutorial-duration>

---

## Step 1: Select Your Host Google Cloud Project

Choose the Google Cloud project that will host the **BigQuery** analytics datasets and the **Cloud Run** web service:

<walkthrough-project-setup billing="true"></walkthrough-project-setup>

Verify your active project in Cloud Shell:

```bash
export PROJECT_ID="$(gcloud config get-value project)"
echo "Deploying into host project: ${PROJECT_ID}"
```

---

## Step 2: (Optional) Detect Your GCP Organization ID

To capture Antigravity telemetry across **all** projects in your Google Cloud Organization automatically via an aggregated Cloud Logging sink, detect your Organization ID:

```bash
export ORG_ID="$(gcloud projects get-ancestors "${PROJECT_ID}" --format='json' | python3 -c "import sys,json; d=json.load(sys.stdin); o=[x['id'] for x in d if x.get('type')=='organization']; print(o[0] if o else '')")"
echo "Detected Organization ID: ${ORG_ID:-<Single-Project Mode>}"
```

> **Note:** If you don't have `roles/logging.configWriter` at the Organization root, `install.sh` automatically falls back to a Project-scoped sink without failing.

---

## Step 3: Run the Turnkey Installer

Choose **Option A** (Zero-Trust Identity-Aware Proxy — recommended for internal enterprise teams) or **Option B** (Public HTTPS URL):

### Option A: Enterprise Zero-Trust IAP Mode (Recommended)

```bash
./install.sh \
  --project "${PROJECT_ID}" \
  --org "${ORG_ID}" \
  --region us-central1 \
  --bq-location US \
  --access iap
```

### Option B: Public URL (With Optional Password Protection)

```bash
# Prompts interactively to set or auto-generate DASHBOARD_AUTH_TOKEN when no Org IAP exists,
# or pass --generate-token to auto-generate and store it in Secret Manager:
./install.sh \
  --project "${PROJECT_ID}" \
  --org "${ORG_ID}" \
  --region us-central1 \
  --bq-location US \
  --access public \
  --generate-token
```

### Optional: Link Cloud Billing Standard Export
If you already export GCP Billing to BigQuery (`gcp_billing_export_v1_XXXXXX`), append:
```text
--billing-table BILLING_PROJECT.BILLING_DATASET.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX
```

---

## Step 4: Grant Viewer Access (If Using IAP) & Open Dashboard

If you deployed with `--access iap`, grant yourself or your Google Workspace domain access:

```bash
USER_EMAIL="$(gcloud config get-value account)"
gcloud iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service=antigravity-usage-dashboard \
  --region=us-central1 \
  --project="${PROJECT_ID}" \
  --member="user:${USER_EMAIL}" \
  --role="roles/iap.httpsResourceAccessor"
```

Print your live dashboard URL:

```bash
gcloud run services describe antigravity-usage-dashboard \
  --project="${PROJECT_ID}" \
  --region=us-central1 \
  --format="value(status.url)"
```

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Your **Antigravity Organization Intelligence & FinOps Dashboard** is now live! Click the Cloud Run URL above to explore Executive Overview, Models & Fleet Hygiene, FinOps & Cloud Billing, and Engineer Trajectories.

> **FinOps Tip:** All dashboard resources and BigQuery queries are automatically labeled `datacloud=antigravity` (typical serverless TCO is `$0–$2.80/mo` for up to 250 engineers). Open `docs/COST_ESTIMATION.md` for full sizing tables and SQL self-audit queries.
