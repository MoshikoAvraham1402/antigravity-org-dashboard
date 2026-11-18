from __future__ import annotations

import collections
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import google.auth
import google.auth.transport.requests
import requests as http_requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google.api_core.exceptions import NotFound
from google.cloud import bigquery
from google.oauth2 import id_token

logger = logging.getLogger("antigravity.dashboard")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ==============================================================================
# Customer Environment Configuration (100% Environment-Driven)
# ==============================================================================
PROJECT_ID = (os.getenv("GCP_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
PROJECT_NUMBER = os.getenv("GCP_PROJECT_NUMBER", "").strip()
REGION = os.getenv("GCP_REGION", "us-central1").strip()
SERVICE_NAME = os.getenv("K_SERVICE", "antigravity-usage-dashboard").strip()
IS_CLOUD_RUN = bool(os.getenv("K_SERVICE"))

ORG_ID = os.getenv("GCP_ORG_ID", "").strip()
ORG_DOMAIN = os.getenv("GCP_ORG_DOMAIN", "").strip().lower()
ORG_TIMEZONE = os.getenv("ORG_TIMEZONE", "UTC").strip()
SINK_NAME = os.getenv("LOGGING_SINK_NAME", "antigravity-org-bq-sink").strip()

MONITORING_DATASET = os.getenv("MONITORING_DATASET", "antigravity_monitoring").strip()
RAW_LOGS_DATASET = os.getenv("RAW_LOGS_DATASET", "antigravity_raw_logs").strip()

_BQ_FQN_RE = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$")
_RAW_BILLING_TABLE = os.getenv("BILLING_EXPORT_TABLE", "").strip().strip("`")
BILLING_TABLE = _RAW_BILLING_TABLE if _BQ_FQN_RE.match(_RAW_BILLING_TABLE) else ""

HIST_REAL_TABLE = "real_historical_inference_logs"
PROJECT_DIR_TABLE = "project_directory"
LIVE_RESP_TABLE = "businessaicode_googleapis_com_inference_response"
LIVE_TEL_TABLE = "businessaicode_googleapis_com_client_telemetry"

JOB_LABELS = {"datacloud": "antigravity"}
MAX_BYTES_BILLED = int(os.getenv("MAX_BYTES_BILLED", str(150 * 1024 * 1024)))  # Default 150 MB scan cap per query
BQ_TIMEOUT_MS = 20_000

IAP_CERTS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk"
EXPLICIT_IAP_AUDIENCE = os.getenv("IAP_AUDIENCE", "").strip()
REQUIRE_IAP_AUTH = os.getenv("REQUIRE_IAP_AUTH", "false").lower() == "true"

_ALLOWED_DAYS = frozenset({7, 14, 30, 90})
_SAFE_FILTER_RE = re.compile(r"^[A-Za-z0-9._ :()\-]{1,80}$")
_SAFE_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_SAFE_TZ_RE = re.compile(r"^[A-Za-z0-9_/\-+]{1,48}$")
if not _SAFE_TZ_RE.match(ORG_TIMEZONE):
    ORG_TIMEZONE = "UTC"

SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}

# Disable Swagger / ReDoc / OpenAPI schema exposure in production
app = FastAPI(
    title="Antigravity Organization Intelligence Dashboard",
    version="3.2.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_bq_client: bigquery.Client | None = None
_resolved_project_id: str | None = None
_bq_init_lock = threading.Lock()
_google_auth_req = google.auth.transport.requests.Request()

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 30.0
_MAX_CACHE_ENTRIES = 256

_proj_discovery_lock = threading.Lock()
_proj_discovery_cache: tuple[float, list[str], dict[str, str]] | None = None
_PROJ_DISCOVERY_TTL_SEC = 900.0  # 15 minutes

_rate_lock = threading.Lock()
_read_buckets: dict[str, collections.deque[float]] = collections.defaultdict(collections.deque)
_sync_buckets: dict[str, collections.deque[float]] = collections.defaultdict(collections.deque)

_sync_exec_lock = threading.Lock()
_last_global_sync_mono: float = 0.0
_GLOBAL_SYNC_COOLDOWN_SEC = 15.0


def get_project_id() -> str:
    global _resolved_project_id
    if PROJECT_ID:
        return PROJECT_ID
    if _resolved_project_id:
        return _resolved_project_id
    _, detected = google.auth.default()
    if not detected:
        raise RuntimeError("GCP_PROJECT_ID environment variable is not set and could not be auto-detected.")
    _resolved_project_id = detected
    return detected


def get_bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        with _bq_init_lock:
            if _bq_client is None:
                _bq_client = bigquery.Client(project=get_project_id())
    return _bq_client


def _check_rate_limit(bucket_map: dict[str, collections.deque[float]], key: str, limit: int, window_sec: float = 60.0) -> bool:
    now = time.monotonic()
    with _rate_lock:
        if len(bucket_map) > 4096:
            bucket_map.clear()
        dq = bucket_map[key]
        while dq and (now - dq[0]) > window_sec:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True


def verify_iap_assertion(request: Request) -> str:
    """Verifies Google Cloud IAP ES256 JWT assertion if present or if REQUIRE_IAP_AUTH=true."""
    assertion = request.headers.get("x-goog-iap-jwt-assertion", "").strip()
    if not assertion:
        if REQUIRE_IAP_AUTH and IS_CLOUD_RUN:
            raise HTTPException(status_code=401, detail="Authentication required via Google Identity-Aware Proxy.")
        return ""

    try:
        claims = id_token.verify_token(
            assertion,
            _google_auth_req,
            audience=None,
            certs_url=IAP_CERTS_URL,
        )
    except Exception as exc:
        logger.warning("IAP JWT cryptographic verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid authentication assertion.") from exc

    iss = claims.get("iss")
    aud = str(claims.get("aud") or "")
    email = str(claims.get("email") or "").lower()

    if iss != "https://cloud.google.com/iap":
        logger.warning("Unexpected IAP JWT issuer: %s", iss)
        raise HTTPException(status_code=401, detail="Invalid token issuer.")

    proj_id = get_project_id()
    allowed_audiences = {
        f"/projects/{proj_id}/locations/{REGION}/services/{SERVICE_NAME}",
    }
    if EXPLICIT_IAP_AUDIENCE:
        allowed_audiences.add(EXPLICIT_IAP_AUDIENCE)
    if PROJECT_NUMBER:
        allowed_audiences.update(
            {
                f"/projects/{PROJECT_NUMBER}/locations/{REGION}/services/{SERVICE_NAME}",
                f"/projects/{PROJECT_NUMBER}/iap_web/cloud_run-{REGION}/services/{SERVICE_NAME}",
                f"https://{SERVICE_NAME}-{PROJECT_NUMBER}.{REGION}.run.app",
            }
        )

    aud_ok = (
        (aud in allowed_audiences)
        or (bool(PROJECT_NUMBER) and aud.startswith(f"/projects/{PROJECT_NUMBER}/"))
        or (not PROJECT_NUMBER and not EXPLICIT_IAP_AUDIENCE and f"/services/{SERVICE_NAME}" in aud)
    )
    if not aud_ok:
        logger.warning("Unexpected IAP JWT audience: %s", aud)
        raise HTTPException(status_code=403, detail="Token audience mismatch.")

    if ORG_DOMAIN and not email.endswith(f"@{ORG_DOMAIN}"):
        logger.warning("Unauthorized domain attempting access: %s", email)
        raise HTTPException(status_code=403, detail="Organization access restricted.")

    return email


@app.middleware("http")
async def zero_trust_security_middleware(request: Request, call_next: Any) -> Any:
    path = request.url.path

    if path == "/api/health":
        resp = JSONResponse({"status": "ok"})
        for hk, hv in SECURITY_HEADERS.items():
            resp.headers[hk] = hv
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        return resp

    try:
        viewer_email = verify_iap_assertion(request)
    except HTTPException as auth_exc:
        resp = JSONResponse({"detail": auth_exc.detail}, status_code=auth_exc.status_code)
        for hk, hv in SECURITY_HEADERS.items():
            resp.headers[hk] = hv
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        return resp

    request.state.viewer_email = viewer_email
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "unknown"
    )
    rate_key = f"{viewer_email}:{client_ip}"

    if path.startswith("/api/"):
        if request.headers.get("x-requested-with") != "AntigravityDashboard":
            resp = JSONResponse({"detail": "Missing required security header."}, status_code=403)
            for hk, hv in SECURITY_HEADERS.items():
                resp.headers[hk] = hv
            return resp

        sec_fetch_site = request.headers.get("sec-fetch-site", "").lower()
        if sec_fetch_site and sec_fetch_site not in ("same-origin", "none"):
            resp = JSONResponse({"detail": "Cross-site API requests are forbidden."}, status_code=403)
            for hk, hv in SECURITY_HEADERS.items():
                resp.headers[hk] = hv
            return resp

        if request.method == "POST":
            origin = request.headers.get("origin", "")
            host = request.headers.get("host", "")
            if origin and host:
                parsed_origin = urlparse(origin)
                if parsed_origin.netloc.lower() != host.lower():
                    resp = JSONResponse({"detail": "Origin mismatch."}, status_code=403)
                    for hk, hv in SECURITY_HEADERS.items():
                        resp.headers[hk] = hv
                    return resp

            if not _check_rate_limit(_sync_buckets, rate_key, limit=3, window_sec=60.0):
                resp = JSONResponse({"detail": "Too many sync requests. Please wait before retrying."}, status_code=429)
                for hk, hv in SECURITY_HEADERS.items():
                    resp.headers[hk] = hv
                return resp
        else:
            if not _check_rate_limit(_read_buckets, rate_key, limit=45, window_sec=60.0):
                resp = JSONResponse({"detail": "Rate limit exceeded."}, status_code=429)
                for hk, hv in SECURITY_HEADERS.items():
                    resp.headers[hk] = hv
                return resp

    response = await call_next(request)
    for hk, hv in SECURITY_HEADERS.items():
        response.headers[hk] = hv

    if path.startswith("/api/") or not path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    else:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

    return response


def validate_days(days: int) -> int:
    if days not in _ALLOWED_DAYS:
        raise HTTPException(status_code=400, detail="Invalid date window.")
    return days


def validate_filter(val: str, field_name: str) -> str:
    cleaned = val.strip()
    if not cleaned or not _SAFE_FILTER_RE.match(cleaned):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} filter parameter.")
    return cleaned


def validate_user_email(raw_email: str) -> str:
    decoded = unquote(raw_email).strip().lower()
    if len(decoded) > 128 or not _SAFE_EMAIL_RE.match(decoded):
        raise HTTPException(status_code=400, detail="Invalid user email identifier.")
    return decoded


def _get_cached(key: str, refresh: bool = False) -> Any | None:
    if refresh:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[0]) < _CACHE_TTL_SECONDS:
            return entry[1]
    return None


def _set_cached(key: str, value: Any) -> Any:
    with _cache_lock:
        if len(_cache) >= _MAX_CACHE_ENTRIES:
            _cache.clear()
        _cache[key] = (time.monotonic(), value)
    return value


def _clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def discover_accessible_projects(token: str | None = None) -> tuple[list[str], dict[str, str]]:
    """Dynamically discovers active GCP projects accessible to the service account (or reads ORG_PROJECTS env)."""
    global _proj_discovery_cache
    now = time.monotonic()
    with _proj_discovery_lock:
        if _proj_discovery_cache and (now - _proj_discovery_cache[0]) < _PROJ_DISCOVERY_TTL_SEC:
            return _proj_discovery_cache[1], _proj_discovery_cache[2]

    host_project = get_project_id()
    env_projects = [p.strip() for p in os.getenv("ORG_PROJECTS", "").split(",") if p.strip()]
    env_map_raw = os.getenv("PROJECT_NUMBER_MAP_JSON", "").strip()
    num_map: dict[str, str] = {}
    if env_map_raw:
        try:
            parsed = json.loads(env_map_raw)
            if isinstance(parsed, dict):
                num_map.update({str(k): str(v) for k, v in parsed.items()})
        except Exception:
            pass

    if PROJECT_NUMBER:
        num_map.setdefault(PROJECT_NUMBER, host_project)

    discovered_ids: list[str] = list(env_projects)
    try:
        if not token:
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            creds.refresh(_google_auth_req)
            token = creds.token
        resp = http_requests.get(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            headers={"Authorization": f"Bearer {token}"},
            params={"filter": "lifecycleState:ACTIVE", "pageSize": 200},
            timeout=6,
        )
        if resp.status_code == 200:
            for p in resp.json().get("projects", []):
                pid = p.get("projectId")
                pnum = str(p.get("projectNumber") or "")
                if pid:
                    if not env_projects:
                        discovered_ids.append(pid)
                    if pnum:
                        num_map[pnum] = pid
    except Exception as exc:
        logger.debug("Automatic project discovery skipped: %s", exc)

    if host_project not in discovered_ids:
        discovered_ids.insert(0, host_project)
    deduped_ids = list(dict.fromkeys(discovered_ids))[:40]  # Cap concurrent sync fan-out safely

    with _proj_discovery_lock:
        _proj_discovery_cache = (now, deduped_ids, num_map)
    return deduped_ids, num_map


def inspect_sink_tables(refresh: bool = False) -> dict[str, Any]:
    cache_key = "sink_tables_status"
    cached = _get_cached(cache_key, refresh=refresh)
    if cached is not None:
        return cached

    proj_id = get_project_id()
    client = get_bq_client()
    resp_fqn = f"{proj_id}.{RAW_LOGS_DATASET}.{LIVE_RESP_TABLE}"
    tel_fqn = f"{proj_id}.{RAW_LOGS_DATASET}.{LIVE_TEL_TABLE}"
    hist_fqn = f"{proj_id}.{MONITORING_DATASET}.{HIST_REAL_TABLE}"
    pdir_fqn = f"{proj_id}.{MONITORING_DATASET}.{PROJECT_DIR_TABLE}"

    def _check(fqn: str) -> tuple[bool, int]:
        try:
            t = client.get_table(fqn)
            base_rows = int(t.num_rows or 0)
            stream_rows = int(getattr(t.streaming_buffer, "estimated_rows", 0) or 0) if t.streaming_buffer else 0
            return True, base_rows + stream_rows
        except NotFound:
            return False, 0

    live_resp_exists, live_resp_rows = _check(resp_fqn)
    live_tel_exists, live_tel_rows = _check(tel_fqn)
    hist_exists, hist_rows = _check(hist_fqn)
    pdir_exists, _ = _check(pdir_fqn)

    sink_scope = f"organizations/{ORG_ID}" if ORG_ID else f"projects/{proj_id}"
    status = {
        "live_resp_exists": live_resp_exists,
        "live_resp_rows": live_resp_rows,
        "live_tel_exists": live_tel_exists,
        "live_tel_rows": live_tel_rows,
        "hist_exists": hist_exists,
        "hist_rows": hist_rows,
        "pdir_exists": pdir_exists,
        "live_table_fqn": resp_fqn,
        "sink_resource": f"{sink_scope}/sinks/{SINK_NAME}",
    }
    return _set_cached(cache_key, status)


def build_real_events_cte(refresh: bool = False) -> tuple[str, dict[str, Any]]:
    proj_id = get_project_id()
    status = inspect_sink_tables(refresh=refresh)

    branches: list[str] = []
    tel_join_cte = ""

    if status["hist_exists"]:
        branches.append(
            f"""
            SELECT
              request_id,
              event_ts,
              DATE(event_ts) AS event_date,
              project_id,
              user_email,
              trajectory_id AS session_id,
              model_id,
              model_provider,
              client_name,
              client_version,
              experience,
              quota_type,
              prompt_tokens,
              cached_tokens,
              output_tokens,
              thinking_tokens,
              total_tokens,
              tool_calls_count
            FROM `{proj_id}.{MONITORING_DATASET}.{HIST_REAL_TABLE}`
            WHERE DATE(event_ts) >= DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
            """
        )

    if status["live_resp_exists"]:
        tel_join_clause = ""
        tool_expr = "0"
        if status["live_tel_exists"]:
            tel_join_cte = f"""
            live_tel AS (
              SELECT
                COALESCE(labels.request_id, '') AS req_id,
                SUM(
                  CAST(ROUND(COALESCE(jsonpayload_v1_clienttelemetrylog.metadata.toolcallscount, 0)) AS INT64)
                ) AS tool_calls
              FROM `{proj_id}.{RAW_LOGS_DATASET}.{LIVE_TEL_TABLE}`
              WHERE DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
              GROUP BY 1
            ),
            """
            tel_join_clause = "LEFT JOIN live_tel lt ON lt.req_id = COALESCE(r.labels.request_id, r.insertId)"
            tool_expr = "COALESCE(lt.tool_calls, 0)"

        pdir_join_clause = ""
        proj_expr = f"COALESCE(NULLIF(r.resource.labels.resource_container, ''), '{proj_id}')"
        if status.get("pdir_exists"):
            pdir_join_clause = (
                f"LEFT JOIN `{proj_id}.{MONITORING_DATASET}.{PROJECT_DIR_TABLE}` pd "
                f"ON pd.project_number = COALESCE(r.resource.labels.resource_container, '')"
            )
            proj_expr = f"COALESCE(pd.project_id, NULLIF(r.resource.labels.resource_container, ''), '{proj_id}')"

        branches.append(
            f"""
            SELECT
              COALESCE(r.labels.request_id, r.insertId) AS request_id,
              r.timestamp AS event_ts,
              DATE(r.timestamp) AS event_date,
              {proj_expr} AS project_id,
              REGEXP_REPLACE(COALESCE(r.labels.user_id, 'unknown'), r'^user:', '') AS user_email,
              COALESCE(r.labels.trajectory_id, '') AS session_id,
              COALESCE(r.labels.model, 'unknown') AS model_id,
              COALESCE(r.labels.model_provider, 'Google') AS model_provider,
              COALESCE(r.labels.client_name, 'antigravity_hub') AS client_name,
              COALESCE(r.labels.client_version, '') AS client_version,
              COALESCE(r.jsonpayload_v1_inferenceresponselog.experience, '') AS experience,
              COALESCE(r.jsonpayload_v1_inferenceresponselog.metadata.quotatype, '') AS quota_type,
              COALESCE(SAFE_CAST(r.jsonpayload_v1_inferenceresponselog.metadata.prompttokencount AS INT64), 0) AS prompt_tokens,
              COALESCE(SAFE_CAST(r.jsonpayload_v1_inferenceresponselog.metadata.cachedcontenttokencount AS INT64), 0) AS cached_tokens,
              COALESCE(SAFE_CAST(r.jsonpayload_v1_inferenceresponselog.metadata.candidatestokencount AS INT64), 0) AS output_tokens,
              COALESCE(SAFE_CAST(r.jsonpayload_v1_inferenceresponselog.metadata.thoughtstokencount AS INT64), 0) AS thinking_tokens,
              COALESCE(SAFE_CAST(r.jsonpayload_v1_inferenceresponselog.metadata.totaltokencount AS INT64), 0) AS total_tokens,
              {tool_expr} AS tool_calls_count
            FROM `{proj_id}.{RAW_LOGS_DATASET}.{LIVE_RESP_TABLE}` r
            {tel_join_clause}
            {pdir_join_clause}
            WHERE DATE(r.timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @lookback_days DAY)
            """
        )

    if branches:
        combined_body = "\nUNION ALL\n".join(branches)
    else:
        # Clean empty state on brand-new installation prior to first inference event
        combined_body = """
        SELECT
          CAST(NULL AS STRING) AS request_id,
          CURRENT_TIMESTAMP() AS event_ts,
          CURRENT_DATE() AS event_date,
          CAST(NULL AS STRING) AS project_id,
          CAST(NULL AS STRING) AS user_email,
          CAST(NULL AS STRING) AS session_id,
          CAST(NULL AS STRING) AS model_id,
          CAST(NULL AS STRING) AS model_provider,
          CAST(NULL AS STRING) AS client_name,
          CAST(NULL AS STRING) AS client_version,
          CAST(NULL AS STRING) AS experience,
          CAST(NULL AS STRING) AS quota_type,
          0 AS prompt_tokens,
          0 AS cached_tokens,
          0 AS output_tokens,
          0 AS thinking_tokens,
          0 AS total_tokens,
          0 AS tool_calls_count
        FROM UNNEST(ARRAY<INT64>[])
        """

    cte_sql = f"""
    {tel_join_cte}
    combined_raw AS (
      {combined_body}
    ),
    deduped_events AS (
      SELECT *
      FROM combined_raw
      QUALIFY ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY tool_calls_count DESC, event_ts DESC) = 1
    ),
    formatted_events AS (
      SELECT
        e.*,
        CASE e.client_name
          WHEN 'antigravity_hub' THEN 'Antigravity Hub'
          WHEN 'antigravity_cli' THEN 'Antigravity CLI (agy)'
          WHEN 'antigravity_ide' THEN 'Antigravity IDE'
          ELSE INITCAP(REPLACE(e.client_name, '_', ' '))
        END AS surface,
        CASE
          WHEN REGEXP_CONTAINS(LOWER(COALESCE(e.experience, '')), r'-max$') THEN 'Max Effort'
          WHEN REGEXP_CONTAINS(LOWER(COALESCE(e.experience, '')), r'-high$') THEN 'High Effort'
          WHEN REGEXP_CONTAINS(LOWER(COALESCE(e.experience, '')), r'-medium$') THEN 'Medium Effort'
          WHEN REGEXP_CONTAINS(LOWER(COALESCE(e.experience, '')), r'-lite$|-low$') THEN 'Lite Effort'
          ELSE 'Standard'
        END AS effort_level,
        CASE COALESCE(e.quota_type, '')
          WHEN 'OVERAGE_QUOTA' THEN 'OVERAGE_QUOTA'
          ELSE 'REGULAR_QUOTA'
        END AS quota_tier,
        CASE COALESCE(e.quota_type, '')
          WHEN 'OVERAGE_QUOTA' THEN 'Overage (Pay-As-You-Go)'
          ELSE 'Included Subscription'
        END AS quota_label,
        IF(e.prompt_tokens > 200000, 1, 0) AS is_long_context,
        GREATEST(0, e.prompt_tokens - e.cached_tokens) AS uncached_prompt_tokens,
        COALESCE(r.display_name, INITCAP(REPLACE(e.model_id, '-', ' '))) AS model_display_name,
        ROUND(
          (GREATEST(0, e.prompt_tokens - e.cached_tokens) * COALESCE(r.input_usd_per_1m, 1.50) / 1000000.0)
          + (e.cached_tokens * COALESCE(r.cached_input_usd_per_1m, 0.20) / 1000000.0)
          + (e.output_tokens * COALESCE(r.output_usd_per_1m, 8.00) / 1000000.0)
          + (e.thinking_tokens * COALESCE(r.thinking_usd_per_1m, 8.00) / 1000000.0),
          6
        ) AS estimated_cost_usd,
        ROUND(
          (e.cached_tokens * GREATEST(0, COALESCE(r.input_usd_per_1m, 1.50) - COALESCE(r.cached_input_usd_per_1m, 0.20)) / 1000000.0),
          6
        ) AS cache_savings_usd
      FROM deduped_events e
      LEFT JOIN `{proj_id}.{MONITORING_DATASET}.model_pricing_rates` r
        ON e.model_id = r.model_id
    ),
    priced_events AS (
      SELECT *
      FROM formatted_events
      WHERE (@project = 'ALL' OR project_id = @project)
        AND (@surface = 'ALL' OR surface = @surface)
        AND (@model = 'ALL' OR model_id = @model)
        AND (@provider = 'ALL' OR model_provider = @provider)
        AND (@quota = 'ALL' OR quota_tier = @quota)
        AND (@effort = 'ALL' OR effort_level = @effort)
    )
    """
    return cte_sql, status


def run_query(
    sql: str,
    params: list[bigquery.ScalarQueryParameter],
    bypass_bq_cache: bool = False,
) -> list[dict[str, Any]]:
    client = get_bq_client()
    job_config = bigquery.QueryJobConfig(
        query_parameters=params,
        labels=JOB_LABELS,
        use_legacy_sql=False,
        use_query_cache=not bypass_bq_cache,
        maximum_bytes_billed=MAX_BYTES_BILLED,
        job_timeout_ms=BQ_TIMEOUT_MS,
    )
    rows = client.query(sql, job_config=job_config).result(timeout=20)
    result: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row.items())
        for k, v in item.items():
            if isinstance(v, (date, datetime)):
                item[k] = v.isoformat()
        result.append(item)
    return result


def sync_recent_cloud_logging_delta() -> dict[str, Any]:
    """Pulls sub-minute Cloud Logging entries across accessible org projects with global cooldown."""
    global _last_global_sync_mono
    with _sync_exec_lock:
        now_mono = time.monotonic()
        if (now_mono - _last_global_sync_mono) < _GLOBAL_SYNC_COOLDOWN_SEC:
            return {"inserted_rows": 0, "scanned_entries": 0, "cooldown": True}
        _last_global_sync_mono = now_mono

        proj_id = get_project_id()
        client = get_bq_client()
        cte_sql, status = build_real_events_cte(refresh=True)
        if not status["hist_exists"]:
            return {"inserted_rows": 0, "scanned_entries": 0}

        recent_sql = f"""
        WITH {cte_sql}
        SELECT
          MAX(event_ts) AS max_ts,
          ARRAY_AGG(DISTINCT request_id LIMIT 5000) AS recent_ids
        FROM deduped_events
        WHERE event_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
        """
        recent_params = [
            bigquery.ScalarQueryParameter("lookback_days", "INT64", 2),
            bigquery.ScalarQueryParameter("project", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("surface", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("model", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("provider", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("quota", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("effort", "STRING", "ALL"),
        ]
        try:
            recent_rows = run_query(recent_sql, recent_params, bypass_bq_cache=True)
        except Exception:
            recent_rows = []

        rec = recent_rows[0] if recent_rows else {}
        existing_ids: set[str] = set(rec.get("recent_ids") or [])
        now_utc = datetime.now(timezone.utc)

        raw_max_ts = rec.get("max_ts")
        if isinstance(raw_max_ts, str) and raw_max_ts:
            try:
                parsed_ts = datetime.fromisoformat(raw_max_ts.replace("Z", "+00:00"))
                if parsed_ts.tzinfo is None:
                    parsed_ts = parsed_ts.replace(tzinfo=timezone.utc)
                cutoff_dt = max(parsed_ts - timedelta(minutes=20), now_utc - timedelta(hours=4))
            except Exception:
                cutoff_dt = now_utc - timedelta(hours=2)
        else:
            cutoff_dt = now_utc - timedelta(hours=2)

        cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        try:
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            creds.refresh(_google_auth_req)
            token = creds.token
        except Exception as exc:
            logger.warning("Cloud Logging credential refresh skipped: %s", exc)
            return {"inserted_rows": 0, "scanned_entries": 0}

        target_projects, num_map = discover_accessible_projects(token=token)
        headers = {"Authorization": f"Bearer {token}"}

        def _fetch_recent(proj: str, log_id_encoded: str) -> list[dict[str, Any]]:
            try:
                resp = http_requests.post(
                    "https://logging.googleapis.com/v2/entries:list",
                    headers=headers,
                    json={
                        "resourceNames": [f"projects/{proj}"],
                        "filter": f'logName="projects/{proj}/logs/{log_id_encoded}" AND timestamp>="{cutoff_iso}"',
                        "orderBy": "timestamp desc",
                        "pageSize": 250,
                    },
                    timeout=6,
                )
                if resp.status_code == 200:
                    return resp.json().get("entries", [])
            except Exception:
                pass
            return []

        tel_entries: list[dict[str, Any]] = []
        resp_entries: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            tel_futs = [pool.submit(_fetch_recent, p, "businessaicode.googleapis.com%2Fclient_telemetry") for p in target_projects]
            resp_futs = [pool.submit(_fetch_recent, p, "businessaicode.googleapis.com%2Finference_response") for p in target_projects]
            for f in tel_futs:
                tel_entries.extend(f.result())
            for f in resp_futs:
                resp_entries.extend(f.result())

        tool_calls_by_req: dict[str, int] = collections.defaultdict(int)
        for e in tel_entries:
            lbl = e.get("labels") or {}
            jp = e.get("jsonPayload") or {}
            meta = jp.get("metadata") or {}
            if jp.get("eventType") == "InferenceResolved":
                req_id = lbl.get("request_id", "")
                if req_id:
                    tool_calls_by_req[req_id] += int(meta.get("toolCallsCount") or 0)

        new_rows: list[dict[str, Any]] = []
        for e in resp_entries:
            insert_id = e.get("insertId") or ""
            lbl = e.get("labels") or {}
            req_id = lbl.get("request_id") or insert_id
            if not req_id or req_id in existing_ids:
                continue
            existing_ids.add(req_id)

            res_labels = (e.get("resource") or {}).get("labels") or {}
            container_num = str(res_labels.get("resource_container") or "")
            resolved_proj = num_map.get(container_num, container_num or proj_id)

            jp = e.get("jsonPayload") or {}
            meta = jp.get("metadata") or {}

            user_raw = lbl.get("user_id") or "unknown"
            user_email = user_raw[5:] if user_raw.startswith("user:") else user_raw

            prompt_tok = int(meta.get("promptTokenCount") or 0)
            cached_tok = int(meta.get("cachedContentTokenCount") or 0)
            cand_tok = int(meta.get("candidatesTokenCount") or 0)
            thought_tok = int(meta.get("thoughtsTokenCount") or 0)
            total_tok = int(meta.get("totalTokenCount") or (prompt_tok + cand_tok + thought_tok))

            new_rows.append(
                {
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
            )

        inserted = 0
        if new_rows:
            hist_fqn = f"{proj_id}.{MONITORING_DATASET}.{HIST_REAL_TABLE}"
            errors = client.insert_rows_json(hist_fqn, new_rows)
            if not errors:
                inserted = len(new_rows)
            else:
                logger.warning("Partial streaming insert errors: %s", errors[:2])

        return {
            "inserted_rows": inserted,
            "scanned_entries": len(resp_entries),
        }


def calc_delta_pct(curr: float | int | None, prev: float | int | None) -> float | None:
    c = float(curr or 0)
    p = float(prev or 0)
    if p <= 0:
        return None
    return round(((c - p) / p) * 100.0, 1)


def _compute_dashboard_payload(
    days: int,
    project: str,
    surface: str,
    model: str,
    provider: str,
    quota: str,
    effort: str,
    viewer_email: str,
    force_refresh: bool = False,
) -> dict[str, Any]:
    cache_key = f"real_dash_v4:{days}:{project}:{surface}:{model}:{provider}:{quota}:{effort}"
    cached = _get_cached(cache_key, refresh=force_refresh)
    if cached is not None:
        out = dict(cached)
        out["meta"] = {**cached["meta"], "viewer_email": viewer_email}
        return out

    proj_id = get_project_id()
    lookback_days = max(days * 2 + 5, days + 35)
    cte_sql, sink_status = build_real_events_cte(refresh=force_refresh)

    base_params = [
        bigquery.ScalarQueryParameter("days", "INT64", days),
        bigquery.ScalarQueryParameter("lookback_days", "INT64", lookback_days),
        bigquery.ScalarQueryParameter("project", "STRING", project),
        bigquery.ScalarQueryParameter("surface", "STRING", surface),
        bigquery.ScalarQueryParameter("model", "STRING", model),
        bigquery.ScalarQueryParameter("provider", "STRING", provider),
        bigquery.ScalarQueryParameter("quota", "STRING", quota),
        bigquery.ScalarQueryParameter("effort", "STRING", effort),
    ]

    kpi_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT
        COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date,
        MAX(event_ts) AS latest_event_ts
      FROM priced_events
    ),
    win AS (
      SELECT p.*
      FROM priced_events p, anchor
      WHERE p.event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
        AND p.event_date <= anchor.max_date
    ),
    curr AS (
      SELECT
        COUNT(DISTINCT user_email) AS active_users,
        COUNT(DISTINCT project_id) AS active_projects,
        COUNT(1) AS total_requests,
        COUNT(DISTINCT NULLIF(session_id, '')) AS total_sessions,
        COALESCE(SUM(tool_calls_count), 0) AS total_tool_calls,
        COUNTIF(tool_calls_count > 0) AS tool_assisted_turns,
        ROUND(SAFE_DIVIDE(COUNTIF(tool_calls_count > 0), COUNT(1)) * 100, 1) AS tool_assisted_pct,
        ROUND(SAFE_DIVIDE(SUM(tool_calls_count), COUNT(1)), 2) AS avg_tools_per_turn,
        COUNTIF(quota_tier = 'OVERAGE_QUOTA') AS overage_requests,
        COUNTIF(quota_tier = 'REGULAR_QUOTA') AS regular_requests,
        ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
        COALESCE(SUM(IF(quota_tier = 'OVERAGE_QUOTA', total_tokens, 0)), 0) AS overage_tokens,
        COALESCE(ROUND(SUM(IF(quota_tier = 'OVERAGE_QUOTA', estimated_cost_usd, 0)), 2), 0) AS overage_cost_usd,
        COALESCE(SUM(is_long_context), 0) AS long_context_turns,
        ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
        CAST(ROUND(COALESCE(AVG(prompt_tokens), 0)) AS INT64) AS avg_prompt_tokens,
        COALESCE(APPROX_QUANTILES(prompt_tokens, 100)[OFFSET(50)], 0) AS p50_prompt_tokens,
        COALESCE(APPROX_QUANTILES(prompt_tokens, 100)[OFFSET(95)], 0) AS p95_prompt_tokens,
        COALESCE(MAX(prompt_tokens), 0) AS max_prompt_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(uncached_prompt_tokens), 0) AS uncached_prompt_tokens,
        COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(thinking_tokens), 0) AS thinking_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        ROUND(SAFE_DIVIDE(SUM(thinking_tokens), SUM(total_tokens)) * 100, 1) AS thinking_share_pct,
        ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
        COALESCE(ROUND(SUM(estimated_cost_usd), 2), 0) AS estimated_cost_usd,
        COALESCE(ROUND(SUM(cache_savings_usd), 2), 0) AS cache_savings_usd
      FROM win
    ),
    sess_per_id AS (
      SELECT
        session_id AS sid,
        COUNT(1) AS sess_turns
      FROM win
      WHERE NULLIF(session_id, '') IS NOT NULL
      GROUP BY 1
    ),
    sess_stats AS (
      SELECT
        COALESCE(ROUND(AVG(sess_turns), 1), 0) AS avg_turns_per_session,
        COALESCE(APPROX_QUANTILES(sess_turns, 100)[OFFSET(50)], 0) AS p50_session_turns,
        COALESCE(APPROX_QUANTILES(sess_turns, 100)[OFFSET(90)], 0) AS p90_session_turns,
        COALESCE(MAX(sess_turns), 0) AS max_session_turns
      FROM sess_per_id
    ),
    prev AS (
      SELECT
        COUNT(DISTINCT user_email) AS prev_active_users,
        COUNT(1) AS prev_requests,
        COALESCE(SUM(total_tokens), 0) AS prev_tokens,
        COALESCE(ROUND(SUM(estimated_cost_usd), 2), 0) AS prev_cost_usd
      FROM priced_events, anchor
      WHERE event_date > DATE_SUB(anchor.max_date, INTERVAL (@days * 2) DAY)
        AND event_date <= DATE_SUB(anchor.max_date, INTERVAL @days DAY)
    )
    SELECT
      anchor.max_date AS max_date,
      anchor.latest_event_ts AS latest_event_ts,
      (SELECT MIN(event_date) FROM win) AS min_date,
      curr.*,
      sess_stats.*,
      prev.*
    FROM curr, sess_stats, prev, anchor
    """

    daily_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
    ),
    daily_users AS (
      SELECT DISTINCT event_date, user_email FROM priced_events
    ),
    window_dates AS (
      SELECT DISTINCT event_date
      FROM priced_events, anchor
      WHERE event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
        AND event_date <= anchor.max_date
    ),
    rolling AS (
      SELECT
        w.event_date,
        COUNT(DISTINCT IF(u.event_date = w.event_date, u.user_email, NULL)) AS dau,
        COUNT(DISTINCT IF(u.event_date BETWEEN DATE_SUB(w.event_date, INTERVAL 6 DAY) AND w.event_date, u.user_email, NULL)) AS wau_7d,
        COUNT(DISTINCT IF(u.event_date BETWEEN DATE_SUB(w.event_date, INTERVAL 27 DAY) AND w.event_date, u.user_email, NULL)) AS mau_28d
      FROM window_dates w
      JOIN daily_users u
        ON u.event_date BETWEEN DATE_SUB(w.event_date, INTERVAL 27 DAY) AND w.event_date
      GROUP BY w.event_date
    ),
    agg AS (
      SELECT
        event_date,
        COUNT(1) AS requests,
        COUNT(DISTINCT NULLIF(session_id, '')) AS sessions,
        SUM(tool_calls_count) AS tool_calls,
        COUNTIF(quota_tier = 'OVERAGE_QUOTA') AS overage_requests,
        COUNTIF(quota_tier = 'REGULAR_QUOTA') AS regular_requests,
        SUM(is_long_context) AS long_context_turns,
        CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
        SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
        SUM(cached_tokens) AS cached_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(thinking_tokens) AS thinking_tokens,
        SUM(total_tokens) AS total_tokens,
        ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
        ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
        ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
      FROM priced_events, anchor
      WHERE event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
        AND event_date <= anchor.max_date
      GROUP BY event_date
    )
    SELECT
      a.event_date AS date,
      r.dau,
      r.wau_7d,
      r.mau_28d,
      ROUND(SAFE_DIVIDE(r.dau, r.mau_28d) * 100, 1) AS stickiness_pct,
      a.requests,
      a.sessions,
      a.tool_calls,
      a.overage_requests,
      a.regular_requests,
      a.long_context_turns,
      a.avg_prompt_tokens,
      a.uncached_prompt_tokens,
      a.cached_tokens,
      a.output_tokens,
      a.thinking_tokens,
      a.total_tokens,
      a.cache_hit_rate_pct,
      a.estimated_cost_usd,
      a.cache_savings_usd
    FROM agg a
    JOIN rolling r ON a.event_date = r.event_date
    ORDER BY a.event_date ASC
    """

    breakdown_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
    ),
    filtered AS (
      SELECT p.* FROM priced_events p, anchor
      WHERE p.event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
        AND p.event_date <= anchor.max_date
    )
    SELECT
      'model' AS dimension_type,
      model_id AS key_id,
      ANY_VALUE(model_display_name) AS label,
      ANY_VALUE(model_provider) AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY model_id
    UNION ALL
    SELECT
      'surface' AS dimension_type,
      surface AS key_id,
      surface AS label,
      '' AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY surface
    UNION ALL
    SELECT
      'provider' AS dimension_type,
      model_provider AS key_id,
      model_provider AS label,
      model_provider AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY model_provider
    UNION ALL
    SELECT
      'effort' AS dimension_type,
      effort_level AS key_id,
      effort_level AS label,
      '' AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY effort_level
    UNION ALL
    SELECT
      'quota' AS dimension_type,
      quota_tier AS key_id,
      ANY_VALUE(quota_label) AS label,
      '' AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY quota_tier
    UNION ALL
    SELECT
      'client_version' AS dimension_type,
      COALESCE(NULLIF(client_version, ''), 'unknown') AS key_id,
      CONCAT('v', COALESCE(NULLIF(client_version, ''), 'unknown')) AS label,
      '' AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY 2, 3
    UNION ALL
    SELECT
      'project' AS dimension_type,
      project_id AS key_id,
      project_id AS label,
      '' AS provider,
      COUNT(1) AS requests,
      COUNT(DISTINCT user_email) AS active_users,
      SUM(tool_calls_count) AS tool_calls,
      SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
      SUM(cached_tokens) AS cached_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
      CAST(ROUND(AVG(prompt_tokens)) AS INT64) AS avg_prompt_tokens,
      ROUND(SAFE_DIVIDE(SUM(is_long_context), COUNT(1)) * 100, 1) AS long_context_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM filtered
    GROUP BY project_id
    """

    heatmap_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
    )
    SELECT
      EXTRACT(DAYOFWEEK FROM event_ts AT TIME ZONE '{ORG_TIMEZONE}') AS dow,
      EXTRACT(HOUR FROM event_ts AT TIME ZONE '{ORG_TIMEZONE}') AS hour_of_day,
      COUNT(1) AS requests,
      SUM(total_tokens) AS total_tokens,
      COUNT(DISTINCT user_email) AS active_users,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd
    FROM priced_events, anchor
    WHERE event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
      AND event_date <= anchor.max_date
    GROUP BY 1, 2
    ORDER BY 1, 2
    """

    trajectories_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
    )
    SELECT
      session_id AS trajectory_id,
      ANY_VALUE(user_email) AS user_email,
      ANY_VALUE(project_id) AS project_id,
      ANY_VALUE(surface) AS surface,
      APPROX_TOP_COUNT(model_display_name, 1)[OFFSET(0)].value AS primary_model,
      APPROX_TOP_COUNT(effort_level, 1)[OFFSET(0)].value AS primary_effort,
      MIN(event_ts) AS started_at,
      MAX(event_ts) AS last_event_ts,
      GREATEST(1, TIMESTAMP_DIFF(MAX(event_ts), MIN(event_ts), MINUTE)) AS duration_min,
      COUNT(1) AS turns,
      SUM(tool_calls_count) AS tool_calls,
      MAX(prompt_tokens) AS peak_context_tokens,
      SUM(total_tokens) AS total_tokens,
      ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 0) AS overage_pct,
      ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
      ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
    FROM priced_events, anchor
    WHERE event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
      AND event_date <= anchor.max_date
      AND NULLIF(session_id, '') IS NOT NULL
    GROUP BY 1
    ORDER BY total_tokens DESC
    LIMIT 15
    """

    users_sql = f"""
    WITH {cte_sql},
    anchor AS (
      SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
    ),
    window_events AS (
      SELECT p.* FROM priced_events p, anchor
      WHERE p.event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
        AND p.event_date <= anchor.max_date
    ),
    org_sum AS (
      SELECT GREATEST(1, COALESCE(SUM(total_tokens), 1)) AS org_tokens FROM window_events
    ),
    user_agg AS (
      SELECT
        user_email,
        APPROX_TOP_COUNT(model_provider, 1)[OFFSET(0)].value AS top_provider,
        APPROX_TOP_COUNT(project_id, 1)[OFFSET(0)].value AS primary_project,
        APPROX_TOP_COUNT(surface, 1)[OFFSET(0)].value AS primary_surface,
        APPROX_TOP_COUNT(model_display_name, 1)[OFFSET(0)].value AS favorite_model,
        APPROX_TOP_COUNT(effort_level, 1)[OFFSET(0)].value AS top_effort,
        APPROX_TOP_COUNT(NULLIF(client_version, ''), 1)[OFFSET(0)].value AS latest_client_version,
        COUNT(DISTINCT event_date) AS active_days,
        MAX(event_ts) AS last_active_ts,
        COUNT(1) AS requests,
        COUNT(DISTINCT NULLIF(session_id, '')) AS total_sessions,
        COUNT(DISTINCT NULLIF(session_id, '')) AS sessions,
        SUM(tool_calls_count) AS tool_calls,
        ROUND(SAFE_DIVIDE(SUM(tool_calls_count), COUNT(1)), 2) AS avg_tools_per_turn,
        MAX(prompt_tokens) AS peak_context_tokens,
        SUM(is_long_context) AS long_context_turns,
        ROUND(SAFE_DIVIDE(COUNTIF(quota_tier = 'OVERAGE_QUOTA'), COUNT(1)) * 100, 1) AS overage_share_pct,
        SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
        SUM(cached_tokens) AS cached_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(thinking_tokens) AS thinking_tokens,
        SUM(total_tokens) AS total_tokens,
        ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1) AS cache_hit_rate_pct,
        ROUND(SAFE_DIVIDE(SUM(thinking_tokens), SUM(total_tokens)) * 100, 1) AS thinking_ratio_pct,
        ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
        ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
      FROM window_events
      GROUP BY user_email
    )
    SELECT
      u.*,
      ROUND(SAFE_DIVIDE(u.total_tokens, o.org_tokens) * 100, 1) AS token_share_pct
    FROM user_agg u
    CROSS JOIN org_sum o
    ORDER BY u.total_tokens DESC
    """

    facets_sql = f"""
    WITH {cte_sql},
    distinct_models AS (
      SELECT model_id, ANY_VALUE(model_display_name) AS model_display_name
      FROM formatted_events
      GROUP BY model_id
    )
    SELECT
      (SELECT ARRAY_AGG(DISTINCT project_id ORDER BY project_id) FROM formatted_events WHERE project_id IS NOT NULL AND project_id != '') AS projects,
      (SELECT ARRAY_AGG(DISTINCT surface ORDER BY surface) FROM formatted_events WHERE surface IS NOT NULL AND surface != '') AS surfaces,
      (SELECT ARRAY_AGG(STRUCT(model_id AS value, model_display_name AS label) ORDER BY model_display_name) FROM distinct_models) AS models,
      (SELECT ARRAY_AGG(DISTINCT model_provider ORDER BY model_provider) FROM formatted_events WHERE model_provider IS NOT NULL AND model_provider != '') AS providers,
      (SELECT ARRAY_AGG(DISTINCT effort_level ORDER BY effort_level) FROM formatted_events WHERE effort_level IS NOT NULL AND effort_level != '') AS efforts
    """

    billing_skus_sql = ""
    if BILLING_TABLE:
        billing_skus_sql = f"""
        SELECT
          service.description AS service_name,
          sku.description AS sku_description,
          CASE
            WHEN REGEXP_CONTAINS(LOWER(sku.description), r'subscription|code assist|gemini enterprise') THEN 'Subscription Seat'
            WHEN REGEXP_CONTAINS(LOWER(sku.description), r'cache') THEN 'Prompt Caching SKU'
            WHEN REGEXP_CONTAINS(LOWER(sku.description), r'200001|long context') THEN 'Long Context (>200K)'
            ELSE 'Model Inference SKU'
          END AS billing_category,
          ROUND(SUM(cost), 2) AS gross_cost_usd,
          ROUND(SUM(COALESCE((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS credits_usd,
          ROUND(SUM(cost) + SUM(COALESCE((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost_usd
        FROM `{BILLING_TABLE}`
        WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL (@days + 3) DAY)
          AND DATE(usage_start_time) > DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
          AND REGEXP_CONTAINS(LOWER(CONCAT(service.description, ' ', sku.description)), r'gemini enterprise|code assist|claude|gemini')
          AND NOT REGEXP_CONTAINS(LOWER(sku.description), r'colab|persistent disk|storage|network')
        GROUP BY 1, 2, 3
        HAVING ABS(gross_cost_usd) >= 0.01 OR ABS(net_cost_usd) >= 0.01
        ORDER BY gross_cost_usd DESC
        LIMIT 25
        """

    with ThreadPoolExecutor(max_workers=8) as pool:
        f_kpi = pool.submit(run_query, kpi_sql, base_params, force_refresh)
        f_daily = pool.submit(run_query, daily_sql, base_params, force_refresh)
        f_break = pool.submit(run_query, breakdown_sql, base_params, force_refresh)
        f_heat = pool.submit(run_query, heatmap_sql, base_params, force_refresh)
        f_traj = pool.submit(run_query, trajectories_sql, base_params, force_refresh)
        f_users = pool.submit(run_query, users_sql, base_params, force_refresh)
        f_facets = pool.submit(run_query, facets_sql, base_params, force_refresh)
        f_bill = (
            pool.submit(
                run_query,
                billing_skus_sql,
                [bigquery.ScalarQueryParameter("days", "INT64", days)],
                force_refresh,
            )
            if billing_skus_sql
            else None
        )

        kpi_rows = f_kpi.result()
        daily_rows = f_daily.result()
        break_rows = f_break.result()
        heatmap_rows = f_heat.result()
        traj_rows = f_traj.result()
        user_rows = f_users.result()
        facet_rows = f_facets.result()
        billing_skus: list[dict[str, Any]] = []
        if f_bill is not None:
            try:
                billing_skus = f_bill.result()
            except Exception as bill_exc:
                logger.warning("Billing SKU query fallback: %s", bill_exc)

    kpi_raw = kpi_rows[0] if kpi_rows else {}
    latest_point = daily_rows[-1] if daily_rows else {}

    invoice_gross_usd = round(sum(float(r.get("gross_cost_usd") or 0.0) for r in billing_skus), 2)
    invoice_credits_usd = round(sum(float(r.get("credits_usd") or 0.0) for r in billing_skus), 2)
    invoice_net_usd = round(sum(float(r.get("net_cost_usd") or 0.0) for r in billing_skus), 2)
    invoice_sub_usd = round(
        sum(float(r.get("gross_cost_usd") or 0.0) for r in billing_skus if r.get("billing_category") == "Subscription Seat"),
        2,
    )
    invoice_model_usd = round(
        sum(float(r.get("gross_cost_usd") or 0.0) for r in billing_skus if r.get("billing_category") != "Subscription Seat"),
        2,
    )

    active_users = int(kpi_raw.get("active_users") or 0)
    total_requests = int(kpi_raw.get("total_requests") or 0)
    total_tokens = int(kpi_raw.get("total_tokens") or 0)
    est_cost = float(kpi_raw.get("estimated_cost_usd") or 0.0)
    cache_savings = float(kpi_raw.get("cache_savings_usd") or 0.0)
    hypothetical_uncached_cost = est_cost + cache_savings
    cost_avoidance_pct = round((cache_savings / hypothetical_uncached_cost) * 100.0, 1) if hypothetical_uncached_cost > 0 else 0.0
    observed_days = max(1, len(daily_rows))

    kpis = {
        "active_users_period": active_users,
        "active_projects": int(kpi_raw.get("active_projects") or 0),
        "active_users_delta_pct": calc_delta_pct(active_users, kpi_raw.get("prev_active_users")),
        "dau_latest": int(latest_point.get("dau") or 0),
        "wau_latest": int(latest_point.get("wau_7d") or 0),
        "mau_28d_latest": int(latest_point.get("mau_28d") or 0),
        "stickiness_pct": float(latest_point.get("stickiness_pct") or 0.0),
        "total_requests": total_requests,
        "requests_delta_pct": calc_delta_pct(total_requests, kpi_raw.get("prev_requests")),
        "total_sessions": int(kpi_raw.get("total_sessions") or 0),
        "avg_turns_per_session": float(kpi_raw.get("avg_turns_per_session") or 0.0),
        "p50_session_turns": int(kpi_raw.get("p50_session_turns") or 0),
        "p90_session_turns": int(kpi_raw.get("p90_session_turns") or 0),
        "max_session_turns": int(kpi_raw.get("max_session_turns") or 0),
        "total_tool_calls": int(kpi_raw.get("total_tool_calls") or 0),
        "tool_assisted_turns": int(kpi_raw.get("tool_assisted_turns") or 0),
        "tool_assisted_pct": float(kpi_raw.get("tool_assisted_pct") or 0.0),
        "avg_tools_per_turn": float(kpi_raw.get("avg_tools_per_turn") or 0.0),
        "overage_requests": int(kpi_raw.get("overage_requests") or 0),
        "regular_requests": int(kpi_raw.get("regular_requests") or 0),
        "overage_share_pct": float(kpi_raw.get("overage_share_pct") or 0.0),
        "overage_tokens": int(kpi_raw.get("overage_tokens") or 0),
        "overage_cost_usd": float(kpi_raw.get("overage_cost_usd") or 0.0),
        "long_context_turns": int(kpi_raw.get("long_context_turns") or 0),
        "long_context_pct": float(kpi_raw.get("long_context_pct") or 0.0),
        "avg_prompt_tokens": int(kpi_raw.get("avg_prompt_tokens") or 0),
        "p50_prompt_tokens": int(kpi_raw.get("p50_prompt_tokens") or 0),
        "p95_prompt_tokens": int(kpi_raw.get("p95_prompt_tokens") or 0),
        "max_prompt_tokens": int(kpi_raw.get("max_prompt_tokens") or 0),
        "avg_daily_requests_per_user": round(total_requests / max(1, active_users * observed_days), 1),
        "total_tokens": total_tokens,
        "tokens_delta_pct": calc_delta_pct(total_tokens, kpi_raw.get("prev_tokens")),
        "prompt_tokens": int(kpi_raw.get("prompt_tokens") or 0),
        "uncached_prompt_tokens": int(kpi_raw.get("uncached_prompt_tokens") or 0),
        "cached_tokens": int(kpi_raw.get("cached_tokens") or 0),
        "output_tokens": int(kpi_raw.get("output_tokens") or 0),
        "thinking_tokens": int(kpi_raw.get("thinking_tokens") or 0),
        "thinking_share_pct": float(kpi_raw.get("thinking_share_pct") or 0.0),
        "cache_hit_rate_pct": float(kpi_raw.get("cache_hit_rate_pct") or 0.0),
        "estimated_cost_usd": est_cost,
        "cost_delta_pct": calc_delta_pct(est_cost, kpi_raw.get("prev_cost_usd")),
        "cache_savings_usd": cache_savings,
        "cost_avoidance_pct": cost_avoidance_pct,
        "avg_cost_per_active_user": round(est_cost / max(1, active_users), 2),
        "invoice_gross_usd": invoice_gross_usd,
        "invoice_credits_usd": invoice_credits_usd,
        "invoice_net_usd": invoice_net_usd,
        "invoice_subscription_usd": invoice_sub_usd,
        "invoice_model_sku_usd": invoice_model_usd,
    }

    def _dim_sorted(dtype: str, sort_field: str = "total_tokens") -> list[dict[str, Any]]:
        return sorted(
            [r for r in break_rows if r["dimension_type"] == dtype],
            key=lambda x: float(x.get(sort_field) or 0),
            reverse=True,
        )

    models = _dim_sorted("model")
    surfaces = _dim_sorted("surface")
    providers = _dim_sorted("provider")
    efforts = _dim_sorted("effort", "requests")
    quotas = _dim_sorted("quota", "requests")
    projects = _dim_sorted("project", "total_tokens")
    client_versions = sorted(
        [r for r in break_rows if r["dimension_type"] == "client_version"],
        key=lambda x: str(x.get("key_id") or ""),
        reverse=True,
    )

    facets = facet_rows[0] if facet_rows else {"projects": [], "surfaces": [], "models": [], "providers": [], "efforts": []}

    payload = {
        "meta": {
            "project_id": proj_id,
            "org_id": ORG_ID,
            "org_domain": ORG_DOMAIN,
            "org_timezone": ORG_TIMEZONE,
            "viewer_email": viewer_email,
            "monitoring_dataset": MONITORING_DATASET,
            "raw_logs_dataset": RAW_LOGS_DATASET,
            "billing_enabled": bool(BILLING_TABLE),
            "billing_table": BILLING_TABLE,
            "active_source": "live",
            "sink_status": sink_status,
            "days": days,
            "observed_days": observed_days,
            "date_from": kpi_raw.get("min_date"),
            "date_to": kpi_raw.get("max_date"),
            "latest_event_ts": kpi_raw.get("latest_event_ts"),
            "available_projects": facets.get("projects") or [],
            "available_surfaces": facets.get("surfaces") or [],
            "available_models": [dict(m) if not isinstance(m, dict) else m for m in (facets.get("models") or [])],
            "available_providers": facets.get("providers") or [],
            "available_efforts": facets.get("efforts") or [],
            "available_quotas": [
                {"value": "REGULAR_QUOTA", "label": "Included Subscription"},
                {"value": "OVERAGE_QUOTA", "label": "Overage (Pay-As-You-Go)"},
            ],
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
        "kpis": kpis,
        "daily_series": daily_rows,
        "model_breakdown": models,
        "surface_breakdown": surfaces,
        "provider_breakdown": providers,
        "effort_breakdown": efforts,
        "quota_breakdown": quotas,
        "client_version_breakdown": client_versions,
        "project_breakdown": projects,
        "activity_heatmap": heatmap_rows,
        "top_trajectories": traj_rows,
        "billing_skus": billing_skus,
        "users": user_rows,
    }
    return _set_cached(cache_key, payload)


@app.get("/api/dashboard")
def get_dashboard_data(
    request: Request,
    days: int = Query(default=30),
    project: str = Query(default="ALL"),
    surface: str = Query(default="ALL"),
    model: str = Query(default="ALL"),
    provider: str = Query(default="ALL"),
    quota: str = Query(default="ALL"),
    effort: str = Query(default="ALL"),
) -> dict[str, Any]:
    safe_days = validate_days(days)
    safe_project = validate_filter(project, "project")
    safe_surface = validate_filter(surface, "surface")
    safe_model = validate_filter(model, "model")
    safe_provider = validate_filter(provider, "provider")
    safe_quota = validate_filter(quota, "quota")
    safe_effort = validate_filter(effort, "effort")
    viewer_email = getattr(request.state, "viewer_email", "")

    try:
        return _compute_dashboard_payload(
            days=safe_days,
            project=safe_project,
            surface=safe_surface,
            model=safe_model,
            provider=safe_provider,
            quota=safe_quota,
            effort=safe_effort,
            viewer_email=viewer_email,
            force_refresh=False,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Dashboard telemetry query error: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to load telemetry metrics at this time.") from exc


@app.post("/api/sync")
def sync_telemetry_now(
    request: Request,
    days: int = Query(default=30),
    project: str = Query(default="ALL"),
    surface: str = Query(default="ALL"),
    model: str = Query(default="ALL"),
    provider: str = Query(default="ALL"),
    quota: str = Query(default="ALL"),
    effort: str = Query(default="ALL"),
) -> dict[str, Any]:
    safe_days = validate_days(days)
    safe_project = validate_filter(project, "project")
    safe_surface = validate_filter(surface, "surface")
    safe_model = validate_filter(model, "model")
    safe_provider = validate_filter(provider, "provider")
    safe_quota = validate_filter(quota, "quota")
    safe_effort = validate_filter(effort, "effort")
    viewer_email = getattr(request.state, "viewer_email", "")

    try:
        delta_info = sync_recent_cloud_logging_delta()
        _clear_cache()
        dashboard = _compute_dashboard_payload(
            days=safe_days,
            project=safe_project,
            surface=safe_surface,
            model=safe_model,
            provider=safe_provider,
            quota=safe_quota,
            effort=safe_effort,
            viewer_email=viewer_email,
            force_refresh=True,
        )
        return {
            "status": "synced",
            "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "delta_logs_ingested": int(delta_info.get("inserted_rows") or 0),
            "live_sink_rows": int(dashboard["meta"]["sink_status"].get("live_resp_rows") or 0),
            "total_turns_in_window": int(dashboard["kpis"].get("total_requests") or 0),
            "latest_event_ts": dashboard["meta"].get("latest_event_ts"),
            "dashboard": dashboard,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Live telemetry sync error: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to complete live telemetry sync.") from exc


@app.get("/api/users/{user_email:path}")
def get_user_drilldown(
    user_email: str,
    days: int = Query(default=30),
) -> dict[str, Any]:
    safe_days = validate_days(days)
    decoded_email = validate_user_email(user_email)
    cache_key = f"real_user_v4:{decoded_email}:{safe_days}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    try:
        cte_sql, _ = build_real_events_cte()
        params = [
            bigquery.ScalarQueryParameter("days", "INT64", safe_days),
            bigquery.ScalarQueryParameter("lookback_days", "INT64", safe_days + 5),
            bigquery.ScalarQueryParameter("project", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("surface", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("model", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("provider", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("quota", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("effort", "STRING", "ALL"),
            bigquery.ScalarQueryParameter("user_email", "STRING", decoded_email),
        ]

        daily_sql = f"""
        WITH {cte_sql},
        anchor AS (
          SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
        )
        SELECT
          event_date AS date,
          COUNT(1) AS requests,
          SUM(tool_calls_count) AS tool_calls,
          SUM(total_tokens) AS total_tokens,
          SUM(cached_tokens) AS cached_tokens,
          SUM(thinking_tokens) AS thinking_tokens,
          ROUND(SUM(estimated_cost_usd), 3) AS estimated_cost_usd,
          ROUND(SUM(cache_savings_usd), 3) AS cache_savings_usd
        FROM priced_events, anchor
        WHERE LOWER(user_email) = @user_email
          AND event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
          AND event_date <= anchor.max_date
        GROUP BY event_date
        ORDER BY event_date ASC
        """

        split_sql = f"""
        WITH {cte_sql},
        anchor AS (
          SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
        ),
        u AS (
          SELECT p.* FROM priced_events p, anchor
          WHERE LOWER(p.user_email) = @user_email
            AND p.event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
            AND p.event_date <= anchor.max_date
        )
        SELECT
          'model' AS kind,
          ANY_VALUE(model_display_name) AS name,
          COUNT(1) AS requests,
          SUM(total_tokens) AS total_tokens,
          ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd
        FROM u
        GROUP BY model_id
        UNION ALL
        SELECT
          'surface' AS kind,
          surface AS name,
          COUNT(1) AS requests,
          SUM(total_tokens) AS total_tokens,
          ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd
        FROM u
        GROUP BY surface
        UNION ALL
        SELECT
          'effort' AS kind,
          effort_level AS name,
          COUNT(1) AS requests,
          SUM(total_tokens) AS total_tokens,
          ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd
        FROM u
        GROUP BY effort_level
        """

        sessions_sql = f"""
        WITH {cte_sql},
        anchor AS (
          SELECT COALESCE(MAX(event_date), CURRENT_DATE()) AS max_date FROM priced_events
        )
        SELECT
          COALESCE(NULLIF(session_id, ''), request_id) AS session_id,
          MAX(event_ts) AS last_event_ts,
          GREATEST(1, TIMESTAMP_DIFF(MAX(event_ts), MIN(event_ts), MINUTE)) AS duration_min,
          ANY_VALUE(project_id) AS project_id,
          ANY_VALUE(surface) AS surface,
          ANY_VALUE(model_display_name) AS model_display_name,
          COUNT(1) AS turns,
          SUM(tool_calls_count) AS tool_calls,
          MAX(prompt_tokens) AS peak_context_tokens,
          SUM(total_tokens) AS total_tokens,
          ROUND(SUM(estimated_cost_usd), 3) AS estimated_cost_usd
        FROM priced_events, anchor
        WHERE LOWER(user_email) = @user_email
          AND event_date > DATE_SUB(anchor.max_date, INTERVAL @days DAY)
          AND event_date <= anchor.max_date
        GROUP BY 1
        ORDER BY last_event_ts DESC
        LIMIT 8
        """

        with ThreadPoolExecutor(max_workers=3) as pool:
            f_daily = pool.submit(run_query, daily_sql, params)
            f_split = pool.submit(run_query, split_sql, params)
            f_sess = pool.submit(run_query, sessions_sql, params)

            daily_rows = f_daily.result()
            split_rows = f_split.result()
            sess_rows = f_sess.result()

        payload = {
            "user_email": decoded_email,
            "daily_activity": daily_rows,
            "model_split": sorted(
                [r for r in split_rows if r["kind"] == "model"],
                key=lambda x: int(x.get("total_tokens") or 0),
                reverse=True,
            ),
            "surface_split": sorted(
                [r for r in split_rows if r["kind"] == "surface"],
                key=lambda x: int(x.get("total_tokens") or 0),
                reverse=True,
            ),
            "effort_split": sorted(
                [r for r in split_rows if r["kind"] == "effort"],
                key=lambda x: int(x.get("requests") or 0),
                reverse=True,
            ),
            "recent_sessions": sess_rows,
        }
        return _set_cached(cache_key, payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("User drilldown query error: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to load user telemetry profile.") from exc


FRONTEND_DIST = (Path(__file__).resolve().parent.parent / "frontend" / "dist").resolve()
if FRONTEND_DIST.exists():
    assets_dir = (FRONTEND_DIST / "assets").resolve()
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        if full_path:
            candidate = (FRONTEND_DIST / full_path.lstrip("/")).resolve()
            if candidate.is_relative_to(FRONTEND_DIST) and candidate.is_file():
                return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
