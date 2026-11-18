# Infrastructure Cost Estimation (TCO) & Self-Monitoring Guide

Because the **Antigravity Organization Intelligence & FinOps Dashboard** runs entirely on serverless, scale-to-zero Google Cloud primitives (**Cloud Run**, **BigQuery**, and **Cloud Logging Sinks**), there are **zero idle VM, database instance, or load-balancer hourly charges**.

For most small and mid-sized engineering teams, the monthly infrastructure cost of running this dashboard is **\$0.00 – \$1.50 / month**, and even for a **1,000-engineer enterprise** it typically runs **\$5 – \$15 / month**.

---

## 1. Monthly TCO Estimate by Organization Size

The table below shows **both**:
1. **Net Monthly Cost (With GCP Monthly Free Tier)** — what you pay if your GCP Billing Account has unused monthly free tier allowances (`1 TiB` BigQuery query scans, `10 GiB` BigQuery active storage, `180K vCPU-s` Cloud Run).
2. **Gross List Cost (Shared Enterprise Billing Account)** — what you pay if other workloads in your organization already consume the GCP Free Tier.

| Organization Tier | Active Antigravity Engineers | Monthly Inference Turns *(est.)* | Dashboard Refreshes / Month | Net Cost *(With Free Tier)* | Gross List Cost *(No Free Tier)* |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Starter / Team** | 1 – 25 | ~150K | ~300 | **\$0.00 / mo** | **~\$0.15 – \$0.40 / mo** |
| **Growth / Mid-Market** | 25 – 250 | ~1.5M | ~1,200 | **\$0.00 – \$0.25 / mo** | **~\$1.20 – \$2.80 / mo** |
| **Enterprise** | 250 – 1,000 | ~6.5M | ~3,500 | **~\$2.50 – \$5.50 / mo** | **~\$6.50 – \$14.50 / mo** |
| **Global Scale** | 1,000 – 5,000 | ~30M+ | ~10,000 | **~\$15.00 – \$38.00 / mo** | **~\$25.00 – \$55.00 / mo** |

> **Important Distinction:** These figures represent the **infrastructure cost of hosting and querying this dashboard** (`Cloud Run` + `BigQuery` + `Artifact Registry`), separate from your organization's Google Antigravity seat subscriptions or model overage usage.

---

## 2. Component-by-Component Pricing Breakdown

| GCP Service | Provisioned Configuration | Google Cloud Free Tier | List Unit Price *(US / Tier-1)* | Why Cost Stays Near Zero |
| :--- | :--- | :--- | :--- | :--- |
| **Cloud Run** (`antigravity-usage-dashboard`) | `1 vCPU`, `512 MiB` RAM, **`minInstances=0`**, `maxInstances=5`, concurrency `40` | `180,000 vCPU-s`, `360,000 GiB-s`, `2M` requests / mo | `$0.000024 / vCPU-s`<br/>`$0.0000025 / GiB-s` | **Scales completely to 0** when no browser tab is actively refreshing. Even 1,500 uncached API loads/month consume `<3,000 vCPU-s` (`<2%` of Free Tier, or `~$0.08/mo` list). |
| **Identity-Aware Proxy (IAP)** | Direct Cloud Run v2 IAP (`iapEnabled=true`) | **\$0.00 (Free)** | **\$0.00** | Uses **Cloud Run Direct IAP** instead of a Global External Application Load Balancer — saving **~\$18+/month** in forwarding-rule fixed fees. |
| **Cloud Logging Sink** (`antigravity-org-bq-sink`) | Filtered strictly to `businessaicode.googleapis.com` (`inference_response` & `client_telemetry`) | **\$0.00 routing fee** | **\$0.00** for Logs Router & service-to-service BigQuery sink export | Google Cloud does not charge Logs Router fees or standalone BigQuery streaming surcharges for native Cloud Logging sink exports. |
| **BigQuery Storage** (`antigravity_raw_logs` + `antigravity_monitoring`) | Day-partitioned (`TIMESTAMP` / `event_ts`) & clustered (`user_email`, `model_id`, `client_name`) | `10 GiB` Active Logical Storage / mo | `$0.02 / GiB-mo` Active<br/>`$0.01 / GiB-mo` Long-Term *(>90d)* | Telemetry metadata averages **~`30 MB` (`0.03 GiB`) per active engineer per month**. `10 GiB` free covers ~330 engineers; partitions older than 90 days automatically drop 50% to `$0.01/GiB-mo`. |
| **BigQuery Query Compute** (On-Demand SQL) | Partition-pruned metadata projections + `30s` server cache + `150 MB` per-query safety cap | `1 TiB` (`1,024 GiB`) scanned / mo | `$6.25 / TiB` (`~$0.0061 / GiB`) | Queries never scan `prompt` or `candidates` blobs, prune daily partitions via `7D/14D/30D/90D` filters, and reuse BigQuery + FastAPI caches. |
| **Artifact Registry & Cloud Build** | ~`180 MB` multi-stage Docker image | `0.5 GiB` storage + `2,500` build-min / mo | `$0.10 / GiB-mo` | One image fits inside the `0.5 GiB` free tier (`~$0.02/mo` if keeping multiple historical image revisions). |

### Optional Note on Child-Project Cloud Logging Retention
Cloud Logging provides **`50 GiB / project / month` free** for `_Default` log bucket ingestion (`$0.50/GiB` thereafter). Antigravity telemetry logs typically generate only ~`300–600 MB/month` per 100 engineers — well inside each project's `50 GiB` free allowance. If your organization wants zero duplicate storage in `_Default` buckets after routing to BigQuery, you can optionally add a Cloud Logging exclusion filter for `businessaicode.googleapis.com` on `_Default` (routing sinks run *before* `_Default` exclusions, so BigQuery still receives 100% of events).

---

## 3. Built-in Runaway-Cost Circuit Breakers

Even if you deploy the dashboard in `--access public` mode, five architectural guardrails prevent unexpected GCP bills:

1. **Scale-to-Zero Compute (`minInstances=0`):** Zero compute charges overnight, on weekends, or between page loads.
2. **Hard Horizontal Scaling Cap (`maxInstances=5`):** Caps maximum concurrent Cloud Run containers under traffic spikes.
3. **Per-Query BigQuery Scan Ceiling (`MAX_BYTES_BILLED=157286400` / `150 MB`):** Every BigQuery job sets `maximum_bytes_billed`. Any query that would scan more than `150 MB` (`<$0.001` list cost) is aborted before incurring charges. *(Note: Organizations with 1,000+ engineers or multi-terabyte `BILLING_EXPORT_TABLE`s can raise `MAX_BYTES_BILLED` to `536870912` (`512 MB`) or `1073741824` (`1 GB`) via Cloud Run env vars.)*
4. **Server-Side Response Cache (`30s` TTL) + BigQuery Partition Pruning:** Identical filter selections hit FastAPI's in-memory cache (`0 bytes` scanned), and every SQL query filters strictly on partition boundaries (`TIMESTAMP` / `event_ts` / `_PARTITIONTIME`).
5. **Per-IP Token-Bucket Rate Limiting:** Caps single-client API reads (`60 req/min`) and on-demand Cloud Logging syncs (`3 syncs / 5 min` + global cooldown).

---

## 4. How Customers Know Their Exact Actual Cost in Production

Every resource and BigQuery query created by `install.sh`, `terraform/`, and the FastAPI backend is **automatically stamped with a unified GCP billing label**:

```text
datacloud = antigravity
```

- **Cloud Run Service (`antigravity-usage-dashboard`):** labeled `datacloud=antigravity`
- **BigQuery Datasets & Tables (`antigravity_raw_logs`, `antigravity_monitoring`):** labeled `datacloud=antigravity`
- **Every BigQuery SQL & Load Job (`JOB_LABELS` in `backend/main.py`):** labeled `datacloud=antigravity`

This gives your FinOps and Platform teams **three ways** to inspect exact real-world costs at any time:

### Method A: No-Code View in Google Cloud Billing Reports (Recommended)
1. Open [**Google Cloud Console → Billing → Reports**](https://console.cloud.google.com/billing).
2. In the right-hand **Filters** panel:
   - Set **Projects** to `YOUR_HOST_PROJECT_ID` *(or leave across all projects)*.
   - Under **Labels**, add key **`datacloud`** with value **`antigravity`**.
   - Set **Group by** to **SKU** (or **Service**).
3. Toggle **Credits** on/off to see both your gross usage and your net invoice after Free Tier & enterprise discounts.

---

### Method B: Instant SQL Self-Audit via BigQuery `INFORMATION_SCHEMA` *(Works Day 1 — No Billing Export Required)*

Run these two read-only queries in **BigQuery Studio** (replace `region-us` with your BigQuery dataset region, e.g., `region-eu` or `region-us-central1`, and `YOUR_HOST_PROJECT_ID` with your host project):

#### 1. Audit Exact Dashboard Query Bytes & Compute Cost (Last 30 Days)
```sql
SELECT
  DATE(creation_time) AS query_date,
  COUNT(*) AS total_queries,
  COUNTIF(cache_hit) AS cached_queries,
  ROUND(SUM(total_bytes_billed) / POW(1024, 3), 3) AS billed_gib,
  ROUND((SUM(total_bytes_billed) / POW(1024, 4)) * 6.25, 4) AS estimated_gross_usd
FROM `YOUR_HOST_PROJECT_ID`.`region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND job_type = 'QUERY'
  AND state = 'DONE'
  AND EXISTS (
    SELECT 1 FROM UNNEST(labels) AS l
    WHERE l.key = 'datacloud' AND l.value = 'antigravity'
  )
GROUP BY query_date
ORDER BY query_date DESC;
```

#### 2. Audit Exact BigQuery Dataset Storage Footprint & Monthly Run-Rate
```sql
SELECT
  table_schema AS dataset_name,
  COUNT(*) AS table_count,
  ROUND(SUM(active_logical_bytes) / POW(1024, 3), 3) AS active_gib,
  ROUND(SUM(long_term_logical_bytes) / POW(1024, 3), 3) AS long_term_gib,
  ROUND(
    (SUM(active_logical_bytes) / POW(1024, 3)) * 0.02 +
    (SUM(long_term_logical_bytes) / POW(1024, 3)) * 0.01,
    4
  ) AS estimated_monthly_storage_gross_usd
FROM `YOUR_HOST_PROJECT_ID`.`region-us`.INFORMATION_SCHEMA.TABLE_STORAGE
WHERE table_schema IN ('antigravity_raw_logs', 'antigravity_monitoring')
GROUP BY dataset_name;
```

---

### Method C: Exact Invoice Reconciliation via Cloud Billing Export SQL

If your organization exports Cloud Billing data to BigQuery (`gcp_billing_export_v1_*`), run this query to get the exact **to-the-penny net invoice cost** across Cloud Run, BigQuery, and Artifact Registry:

```sql
SELECT
  service.description AS gcp_service,
  sku.description AS sku_description,
  ROUND(SUM(cost), 4) AS gross_cost_usd,
  ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 4) AS credits_and_free_tier_usd,
  ROUND(
    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)),
    4
  ) AS net_invoice_usd
FROM `BILLING_PROJECT.BILLING_DATASET.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`
WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND (
    EXISTS (SELECT 1 FROM UNNEST(labels) AS l WHERE l.key = 'datacloud' AND l.value = 'antigravity')
    OR (project.id = 'YOUR_HOST_PROJECT_ID' AND service.description IN ('Cloud Run', 'BigQuery', 'Artifact Registry'))
  )
GROUP BY gcp_service, sku_description
HAVING ABS(gross_cost_usd) > 0 OR ABS(net_invoice_usd) > 0
ORDER BY net_invoice_usd DESC, gross_cost_usd DESC;
```

---

## 5. Optional FinOps Controls: Budgets & Partition Auto-Expiration

### Set a \$10 / Month GCP Budget Email Alert
```bash
gcloud billing budgets create \
  --billing-account="YOUR_BILLING_ACCOUNT_ID" \
  --display-name="Antigravity Usage Dashboard Hosting Budget" \
  --budget-amount=10USD \
  --filter-projects="projects/YOUR_HOST_PROJECT_ID" \
  --filter-labels="datacloud=antigravity" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

### Optional: Cap Raw Sink Retention (e.g., 365 Days)
Curated metrics in `antigravity_monitoring.real_historical_inference_logs` are ultra-compact (`~0.35 KB/turn`). If you want raw JSON sink partitions in `antigravity_raw_logs` to expire automatically after 365 days (`31536000` seconds):

```bash
bq update --default_partition_expiration 31536000 YOUR_HOST_PROJECT_ID:antigravity_raw_logs
```
