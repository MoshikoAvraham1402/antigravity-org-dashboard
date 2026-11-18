# Architecture, Telemetry Schema & Security Whitepaper

This document details the internal data architecture, Cloud Logging schema correlation, FinOps cost modeling, and multi-layered security posture of the **Antigravity Organization Intelligence & FinOps Dashboard**.

---

## 1. End-to-End Telemetry Pipeline

Google Antigravity workspaces run inference and agentic orchestration against `businessaicode.googleapis.com` (`BAICInstance`). Each agentic turn emits two complementary structured log entries in Google Cloud Logging:

### A. `InferenceResponseLog` (`businessaicode.googleapis.com/inference_response`)
Captures token consumption, model routing, quota tier, and autonomous tool execution per LLM call:
- `labels."businessaicode.googleapis.com/request_id"` / `jsonPayload.requestId`: Globally unique turn identifier.
- `jsonPayload.trajectoryId`: Shared identifier grouping dozens or hundreds of turns into a single multi-step coding session ("trajectory").
- `jsonPayload.model`: Resolved model identifier (e.g., `gemini-3.1-pro-high`, `gemini-3-flash-agent`, `claude-opus-4-6`, `claude-sonnet-4-6`).
- `jsonPayload.experience`: Agent capability & effort mode (e.g., `agent-high`, `agent-medium`, `chat-lite`).
- `jsonPayload.quotaType`: Quota pool consumed (`REGULAR_QUOTA` vs. `OVERAGE_QUOTA`).
- `jsonPayload.usageMetadata`:
  - `promptTokenCount`: Total input context window tokens (including cached context).
  - `cachedContentTokenCount`: Prompt tokens served directly from context cache.
  - `candidatesTokenCount`: Generated completion / code / tool-argument output tokens.
  - `thoughtsTokenCount`: Extended reasoning ("thinking") tokens.
  - `totalTokenCount`: Sum of prompt + output + thinking tokens.
- `ARRAY_LENGTH(jsonPayload.candidates[0].content.parts)` (filtered to `functionCall` entries): Autonomous tool invocation count per turn.

### B. `ClientTelemetryLog` (`businessaicode.googleapis.com/client_telemetry`)
Captures workstation fleet metadata and authenticated principal identity:
- `protoPayload.authenticationInfo.principalEmail` or `labels.user_email`: Engineer's Google Workspace email (when organization audit principal logging is enabled).
- `jsonPayload.ideInfo.ideName` & `ideVersion`: Client IDE identifier and semantic version (e.g., `Antigravity 1.19.x`) used for fleet version hygiene tracking.

### Hybrid Union & Deduplication (`request_id`)
Because Cloud Logging sinks only capture events *from the moment the sink is created*, the dashboard implements a **Hybrid Union Architecture**:
1. **Historical & On-Demand Table (`real_historical_inference_logs`):** Day-partitioned (`event_ts`) and clustered (`project_id, model_id, user_email`) BigQuery table populated initially by `scripts/backfill_real_logs.py` and updated incrementally whenever an operator clicks **Sync Data**.
2. **Live Streaming Sink Tables (`businessaicode_googleapis_com_inference_response` & `businessaicode_googleapis_com_client_telemetry`):** Continuously populated by Google Cloud Logging's BigQuery export sink.
3. **Idempotent Deduplication:** Both `backend/main.py` and `v_antigravity_events` union historical + live rows and deduplicate via `ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY event_ts DESC) = 1` — guaranteeing **zero double-counting** even when historical backfill overlaps with live streaming exports.
4. **Day-0 Resilience:** On a brand-new installation before the first live sink table is auto-created by Cloud Logging, `backend/main.py` checks table metadata via cached existence checks (`_live_sink_status`) and seamlessly queries `real_historical_inference_logs` without raising `404 NotFound` errors.

---

## 2. Privacy-by-Design (Zero Prompt or Code Leakage)

Enterprise security teams frequently disallow storing raw developer prompts or proprietary source code inside analytics dashboards.

- **Strict Columnar Pruning:** Neither `bootstrap_bigquery.py`, `backfill_real_logs.py`, nor `backend/main.py` ever selects `prompt` text, system instructions, file contents, or `candidates[].content.parts[].text`.
- **Metadata-Only Extraction:** Only numeric token counters, timestamps, model/experience enums, tool call counts, project IDs, IDE versions, and user emails are projected.
- **BigQuery Column-Level Cost & Privacy Benefit:** Because BigQuery uses columnar storage (Capacitor), omitting payload text columns reduces bytes scanned by **>95%** while structurally preventing proprietary source code from entering API responses.

---

## 3. FinOps Valuation & Cache Savings Math

For every inference turn, token valuation is computed by joining `model_id` against `{MONITORING_DATASET}.model_pricing_rates`:

$$\text{Uncached Input Tokens} = \max(0, \text{prompt\_tokens} - \text{cached\_tokens})$$

$$\text{Estimated Cost (USD)} = \frac{\text{Uncached Input} \times R_{\text{in}} + \text{Cached} \times R_{\text{cache}} + \text{Output} \times R_{\text{out}} + \text{Thinking} \times R_{\text{think}}}{1,000,000}$$

$$\text{Cache Savings (USD)} = \frac{\text{Cached} \times \max(0, R_{\text{in}} - R_{\text{cache}})}{1,000,000}$$

When `BILLING_EXPORT_TABLE` is configured, the **FinOps & Cloud Billing** tab additionally queries actual GCP Cloud Billing SKUs (gross cost, negotiated enterprise/promotional credits, and net invoice spend) side-by-side with token-level telemetry.

---

## 4. Defense-in-Depth Security Controls

| Layer | Security Control | Implementation Details |
| :--- | :--- | :--- |
| **1. Identity & Ingress** | **Native Cloud Run IAP + ES256 JWT Verification** | Supports Zero-Trust IAP (`--access iap`) with cryptographic verification against `https://www.gstatic.com/iap/verify/public_key-jwk` (`aud` & `iss` pinned). |
| **2. Container Hardening** | **Non-Root UID `10001` & Read-Only App Tree** | `Dockerfile` strips write permissions (`chmod -R a-w /app`), runs as `10001:10001` (`/usr/sbin/nologin`), and hides server banners (`--no-server-header`). |
| **3. Least-Privilege IAM** | **Dataset-Scoped Service Account** | `antigravity-dashboard-sa` holds `READER` strictly on `antigravity_raw_logs` and `antigravity_monitoring` (and optional billing dataset), plus `WRITER` only on `real_historical_inference_logs`. |
| **4. SQL Injection Prevention** | **100% Parameterized Queries + Regex Allowlists** | All query parameters (`days`, `project_id`, `model_id`, `email`) are validated via strict allowlists and bound with `bigquery.ScalarQueryParameter`. |
| **5. DoS & Wallet Protection** | **Rate Limiter + `150 MB` Scan Ceiling + `maxInstances=5`** | Per-IP token-bucket rate limiter (`60 req/min` read, `3 syncs / 5 min`), `maximum_bytes_billed=157286400` + `20s` timeout per BigQuery job, and Cloud Run `maxInstanceCount=5`. |
| **6. Browser & API Hygiene** | **CSP, HSTS & OpenAPI Disabled in Production** | Enforces `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, disables `/docs` & `/openapi.json` on Cloud Run, and masks internal stack traces. |
