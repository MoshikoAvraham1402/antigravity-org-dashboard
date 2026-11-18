# Troubleshooting Guide

Common deployment, IAM, Organization Policy, and BigQuery questions encountered in enterprise Google Cloud environments and how to resolve them in minutes.

---

## 1. Domain Restricted Sharing Blocks `--access public`

### Symptom
When running `./install.sh ... --access public` or `harden_cloud_run_security.py --access public`, GCP returns an error mentioning `allUsers` or `constraints/iam.allowedPolicyMemberDomains`.

### Cause
Your Google Cloud Organization enforces the **Domain Restricted Sharing** Organization Policy (`constraints/iam.allowedPolicyMemberDomains`), which prohibits granting `allUsers` IAM bindings unless Cloud Run `invokerIamDisabled` is used or IAP is enabled.

### Resolution
1. **Recommended:** Deploy using **Zero-Trust Identity-Aware Proxy** instead of public access:
   ```bash
   ./install.sh --project YOUR_PROJECT_ID --org YOUR_ORG_ID --access iap
   ```
2. **Alternative:** Note that `scripts/harden_cloud_run_security.py --access public` automatically sets Cloud Run v2 `invokerIamDisabled: true` via the Cloud Run Admin API, which bypasses `allUsers` IAM bindings when `constraints/run.managed.requireInvokerIam` is not enforced.

---

## 2. Permission Denied Creating Organization Cloud Logging Sink

### Symptom
Step 4 of `./install.sh` logs:
```text
[Warning] Organization/Folder sink setup encountered a permission error.
Falling back to Project-scoped sink on <PROJECT_ID>...
```

### Cause
Your user account has Project `Owner`/`Editor` on the host project, but lacks `roles/logging.configWriter` at the **Google Cloud Organization** root (`organizations/<ORG_ID>`).

### Resolution
Ask a GCP Organization Admin to run **only** the sink provisioning script once (takes 10 seconds):
```bash
PROJECT_ID=YOUR_HOST_PROJECT_ID \
ORG_ID=YOUR_GCP_ORG_ID \
BQ_LOCATION=US \
./scripts/setup_org_sink.sh
```
You can also view the exact copy-paste `gcloud logging sinks create` CLI commands anytime inside the dashboard UI by clicking the **Org Sink** button in the top-right header.

---

## 3. Dashboard Shows `0` Events Immediately After Fresh Installation

### Symptom
Deployment succeeded (`HTTP 200`), `/api/health` reports `healthy`, and the UI loads cleanly, but KPI cards show `0` turns/tokens.

### Cause & Resolution
1. **Verify Antigravity Usage & Time Window:** Switch the top-right date selector to **Last 90 Days** and click **Sync Data**.
2. **Cross-Project Visibility for `Sync Data`:** If engineers use Antigravity in *other* GCP projects inside your Organization (not the dashboard host project), ensure:
   - The Organization Cloud Logging Sink (`setup_org_sink.sh`) is active (for all *future* turns), AND
   - To backfill *past* turns from child projects, run `backfill_real_logs.py` as an identity with `roles/logging.viewer` on those projects:
     ```bash
     .venv/bin/python scripts/backfill_real_logs.py \
       --project YOUR_HOST_PROJECT_ID \
       --projects child-proj-a,child-proj-b \
       --days 30
     ```
3. **Verify Cloud Logging Telemetry Stream:** In Google Cloud Logs Explorer on an active Antigravity project, run:
   ```text
   resource.type="businessaicode.googleapis.com/BAICInstance"
   ```
   If zero entries appear even while an engineer prompts Antigravity, check **IAM & Admin -> Audit Logs** for `businessaicode.googleapis.com` (`Google Antigravity`).

---

## 4. FinOps Cloud Billing Tab Shows No Invoice Data or Region Error

### Symptom
You set `BILLING_EXPORT_TABLE`, but the **FinOps & Cloud Billing** workspace shows `$0.00` or logs a BigQuery location mismatch warning.

### Cause & Resolution
1. **Dataset Location Match:** Check the location (`US`, `EU`, `us-central1`, etc.) of your Cloud Billing export dataset:
   ```bash
   bq show --format=prettyjson BILLING_PROJECT:BILLING_DATASET | grep location
   ```
   Ensure `--bq-location` matches that location (`US` vs `EU`), or pass `--location` accordingly.
2. **Service Account Viewer Access:** If your billing export table lives in a separate `billing-admin` project, grant the dashboard runtime service account read access on the billing dataset:
   ```bash
   gcloud projects add-iam-policy-binding BILLING_PROJECT_ID \
     --member="serviceAccount:antigravity-dashboard-sa@YOUR_HOST_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataViewer"
   ```
   *(Or grant `READER` strictly on the single `BILLING_DATASET` in BigQuery Studio.)*

---

## 5. Engineers Show as `Unattributed (<project_id>)` Instead of Email Addresses

### Cause
By default in some Google Cloud configurations, `ClientTelemetryLog` omits `principalEmail` unless Data Access principal logging or Workspace telemetry identity sharing is enabled for `businessaicode.googleapis.com`.

### Resolution
1. In Google Cloud Console, navigate to **IAM & Admin -> Audit Logs** at your Organization level.
2. Filter for **Google Antigravity** / `businessaicode.googleapis.com` and enable **Admin Read**, **Data Read**, and **Data Write** audit logs.
3. All subsequent Antigravity turns will populate `principalEmail` automatically and resolve individual engineer profiles in the Leaderboard and Profile Drawer.

---

## 6. IAP Returns `403 Forbidden: You don't have access`

### Cause
`--access iap` is enabled (Zero-Trust default), and your Google account or Workspace group has not yet been granted `roles/iap.httpsResourceAccessor` on the Cloud Run service.

### Resolution
```bash
gcloud iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service=antigravity-usage-dashboard \
  --region=YOUR_REGION \
  --project=YOUR_HOST_PROJECT_ID \
  --member="user:you@yourdomain.com" \
  --role="roles/iap.httpsResourceAccessor"
```
