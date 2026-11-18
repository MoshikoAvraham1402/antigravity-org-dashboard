"""Optional Cloud Monitoring collector for Vertex AI & Gemini API consumption.

Complements Enterprise Antigravity Cloud Logging (businessaicode.googleapis.com)
by querying standard Cloud Monitoring metrics across accessible GCP projects:
  - aiplatform.googleapis.com/publisher/online_serving/token_count
  - aiplatform.googleapis.com/publisher/online_serving/model_invocation_count
  - serviceruntime.googleapis.com/api/request_count (generativelanguage.googleapis.com)

Zero prompt or response content exists in Cloud Monitoring metrics.
"""
from __future__ import annotations

import collections
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from backend.telemetry_utils import infer_provider_for_model

logger = logging.getLogger("antigravity.vertex_sync")

MONITORING_URL = "https://monitoring.googleapis.com/v3/projects/{project}/timeSeries"


def _query_timeseries(
    token: str,
    project_id: str,
    metric_filter: str,
    start_iso: str,
    end_iso: str,
    alignment_seconds: int = 3600,
) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    series: list[dict[str, Any]] = []
    page_token: str | None = None
    for _ in range(10):
        params: dict[str, Any] = {
            "filter": metric_filter,
            "interval.startTime": start_iso,
            "interval.endTime": end_iso,
            "aggregation.alignmentPeriod": f"{alignment_seconds}s",
            "aggregation.perSeriesAligner": "ALIGN_SUM",
            "pageSize": 500,
        }
        if page_token:
            params["pageToken"] = page_token
        try:
            resp = requests.get(
                MONITORING_URL.format(project=project_id),
                headers=headers,
                params=params,
                timeout=12,
            )
            if resp.status_code != 200:
                if resp.status_code not in (403, 404):
                    logger.debug("Monitoring query HTTP %s for %s", resp.status_code, project_id)
                break
            data = resp.json()
            series.extend(data.get("timeSeries", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        except Exception as exc:
            logger.debug("Monitoring query skipped for %s: %s", project_id, exc)
            break
    return series


def _point_int(pt: dict[str, Any]) -> int:
    val = pt.get("value") or {}
    if "int64Value" in val:
        return int(val["int64Value"])
    if "doubleValue" in val:
        return int(round(float(val["doubleValue"])))
    return 0


def collect_project_vertex_rows(
    token: str,
    project_id: str,
    start_iso: str,
    end_iso: str,
    existing_ids: set[str],
    include_aistudio: bool = True,
) -> list[dict[str, Any]]:
    """Collect hourly aggregated Vertex AI & Gemini API rows for one project."""
    tok_series = _query_timeseries(
        token,
        project_id,
        'metric.type="aiplatform.googleapis.com/publisher/online_serving/token_count"',
        start_iso,
        end_iso,
        alignment_seconds=3600,
    )
    inv_series = _query_timeseries(
        token,
        project_id,
        'metric.type="aiplatform.googleapis.com/publisher/online_serving/model_invocation_count"',
        start_iso,
        end_iso,
        alignment_seconds=3600,
    )

    # Key: (model_id, location, hour_end_iso)
    buckets: dict[tuple[str, str, str], dict[str, int]] = collections.defaultdict(
        lambda: {"input": 0, "cached": 0, "output": 0, "thinking": 0, "requests": 0}
    )

    for ts in tok_series:
        res_lbl = (ts.get("resource") or {}).get("labels") or {}
        met_lbl = (ts.get("metric") or {}).get("labels") or {}
        model_id = (res_lbl.get("model_user_id") or "").strip() or "unknown"
        location = (res_lbl.get("location") or "global").strip()
        tok_type = (met_lbl.get("type") or "input").lower()
        for pt in ts.get("points") or []:
            cnt = _point_int(pt)
            if cnt <= 0:
                continue
            end_t = (pt.get("interval") or {}).get("endTime") or ""
            if not end_t:
                continue
            b = buckets[(model_id, location, end_t)]
            if "cache" in tok_type:
                b["cached"] += cnt
            elif "thought" in tok_type or "reason" in tok_type:
                b["thinking"] += cnt
            elif "output" in tok_type or "cand" in tok_type:
                b["output"] += cnt
            else:
                b["input"] += cnt

    for ts in inv_series:
        res_lbl = (ts.get("resource") or {}).get("labels") or {}
        model_id = (res_lbl.get("model_user_id") or "").strip() or "unknown"
        location = (res_lbl.get("location") or "global").strip()
        for pt in ts.get("points") or []:
            cnt = _point_int(pt)
            if cnt <= 0:
                continue
            end_t = (pt.get("interval") or {}).get("endTime") or ""
            if not end_t:
                continue
            buckets[(model_id, location, end_t)]["requests"] += cnt

    rows: list[dict[str, Any]] = []
    for (model_id, location, end_t), stats in buckets.items():
        total_tok = stats["input"] + stats["cached"] + stats["output"] + stats["thinking"]
        req_count = max(1, stats["requests"]) if (total_tok > 0 or stats["requests"] > 0) else 0
        if req_count == 0 and total_tok == 0:
            continue
        req_id = f"vertex:{project_id}:{model_id}:{location}:{end_t}"
        if req_id in existing_ids:
            continue
        existing_ids.add(req_id)

        prompt_tok = stats["input"] + stats["cached"]
        rows.append(
            {
                "insert_id": req_id,
                "request_id": req_id,
                "event_ts": end_t,
                "project_id": project_id,
                "resource_container": project_id,
                "user_email": f"vertex-api@{project_id}.gcp.internal",
                "trajectory_id": "",
                "model_id": model_id,
                "model_provider": infer_provider_for_model(model_id),
                "client_name": "vertex_ai",
                "client_version": "",
                "experience": "",
                "quota_type": "REGULAR_QUOTA",
                "prompt_tokens": prompt_tok,
                "cached_tokens": stats["cached"],
                "output_tokens": stats["output"],
                "thinking_tokens": stats["thinking"],
                "total_tokens": total_tok,
                "tool_calls_count": 0,
                "request_count": req_count,
            }
        )

    if include_aistudio:
        inference_methods = {
            "GenerateContent",
            "StreamGenerateContent",
            "BidiGenerateContent",
            "EmbedContent",
            "BatchEmbedContents",
            "Predict",
        }
        api_series = _query_timeseries(
            token,
            project_id,
            'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.labels.service="generativelanguage.googleapis.com" AND metric.labels.response_code_class="2xx"',
            start_iso,
            end_iso,
            alignment_seconds=3600,
        )
        api_buckets: dict[tuple[str, str], int] = collections.defaultdict(int)
        for ts in api_series:
            res_lbl = (ts.get("resource") or {}).get("labels") or {}
            method = (res_lbl.get("method") or "GenerateContent").split(".")[-1]
            if method not in inference_methods:
                continue
            for pt in ts.get("points") or []:
                cnt = _point_int(pt)
                end_t = (pt.get("interval") or {}).get("endTime") or ""
                if cnt > 0 and end_t:
                    api_buckets[(method, end_t)] += cnt

        for (method, end_t), cnt in api_buckets.items():
            req_id = f"aistudio:{project_id}:{method}:{end_t}"
            if req_id in existing_ids:
                continue
            existing_ids.add(req_id)
            rows.append(
                {
                    "insert_id": req_id,
                    "request_id": req_id,
                    "event_ts": end_t,
                    "project_id": project_id,
                    "resource_container": project_id,
                    "user_email": f"gemini-api@{project_id}.gcp.internal",
                    "trajectory_id": "",
                    "model_id": f"gemini-api-{method.lower()}",
                    "model_provider": "Google",
                    "client_name": "gemini_api",
                    "client_version": "",
                    "experience": "",
                    "quota_type": "REGULAR_QUOTA",
                    "prompt_tokens": 0,
                    "cached_tokens": 0,
                    "output_tokens": 0,
                    "thinking_tokens": 0,
                    "total_tokens": 0,
                    "tool_calls_count": 0,
                    "request_count": cnt,
                }
            )

    return rows


def collect_vertex_telemetry(
    token: str,
    projects: list[str],
    days: int,
    existing_ids: set[str],
) -> list[dict[str, Any]]:
    """Collect hourly Vertex AI & Gemini API metrics across projects in parallel.

    Aligns to completed whole UTC hours (minus 1 hour) so hourly metrics never freeze
    incomplete partial-hour counts under immutable deterministic request_ids.
    """
    now_utc = datetime.now(timezone.utc)
    end_dt = now_utc.replace(minute=0, second=0, microsecond=0)
    start_dt = end_dt - timedelta(days=max(1, days))
    start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    if start_iso >= end_iso:
        return []

    shared_seen = set(existing_ids)
    all_rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [
            pool.submit(collect_project_vertex_rows, token, p, start_iso, end_iso, set(shared_seen))
            for p in projects
        ]
        for fut in futs:
            try:
                for row in fut.result():
                    if row["request_id"] not in shared_seen:
                        shared_seen.add(row["request_id"])
                        all_rows.append(row)
            except Exception as exc:
                logger.debug("Vertex project collection error: %s", exc)
    return all_rows
