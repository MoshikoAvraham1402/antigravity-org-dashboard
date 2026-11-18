-- =============================================================================
-- Antigravity Organization Usage & FinOps Analytical Views (GoogleSQL Template)
-- Variables substituted automatically by scripts/bootstrap_bigquery.py / Terraform:
--   ${PROJECT_ID}         -> Host GCP Project ID
--   ${MONITORING_DATASET} -> Default: antigravity_monitoring
--   ${RAW_LOGS_DATASET}   -> Default: antigravity_raw_logs
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${MONITORING_DATASET}.v_antigravity_events` AS
WITH live_tel AS (
  SELECT
    COALESCE(labels.request_id, '') AS req_id,
    SUM(CAST(ROUND(COALESCE(jsonpayload_v1_clienttelemetrylog.metadata.toolcallscount, 0)) AS INT64)) AS tool_calls
  FROM `${PROJECT_ID}.${RAW_LOGS_DATASET}.businessaicode_googleapis_com_client_telemetry`
  GROUP BY 1
),
combined_raw AS (
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
    tool_calls_count,
    GREATEST(1, COALESCE(SAFE_CAST(request_count AS INT64), 1)) AS request_count
  FROM `${PROJECT_ID}.${MONITORING_DATASET}.real_historical_inference_logs`
  UNION ALL
  SELECT
    COALESCE(r.labels.request_id, r.insertId) AS request_id,
    r.timestamp AS event_ts,
    DATE(r.timestamp) AS event_date,
    COALESCE(pd.project_id, NULLIF(r.resource.labels.resource_container, ''), '${PROJECT_ID}') AS project_id,
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
    COALESCE(lt.tool_calls, 0) AS tool_calls_count,
    1 AS request_count
  FROM `${PROJECT_ID}.${RAW_LOGS_DATASET}.businessaicode_googleapis_com_inference_response` r
  LEFT JOIN live_tel lt
    ON lt.req_id = COALESCE(r.labels.request_id, r.insertId)
  LEFT JOIN `${PROJECT_ID}.${MONITORING_DATASET}.project_directory` pd
    ON pd.project_number = COALESCE(r.resource.labels.resource_container, '')
),
deduped AS (
  SELECT *
  FROM combined_raw
  QUALIFY ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY tool_calls_count DESC, event_ts DESC) = 1
)
SELECT
  d.request_id,
  d.event_ts,
  d.event_date,
  d.project_id,
  d.user_email,
  d.session_id,
  d.model_id,
  COALESCE(r.display_name, INITCAP(REPLACE(d.model_id, '-', ' '))) AS model_display_name,
  d.model_provider,
  CASE d.client_name
    WHEN 'antigravity_hub' THEN 'Antigravity Hub'
    WHEN 'antigravity_cli' THEN 'Antigravity CLI (agy)'
    WHEN 'antigravity_ide' THEN 'Antigravity IDE'
    WHEN 'vertex_ai' THEN 'Vertex AI API'
    WHEN 'gemini_api' THEN 'Gemini API (AI Studio)'
    ELSE INITCAP(REPLACE(d.client_name, '_', ' '))
  END AS surface,
  d.client_version,
  d.experience,
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'(-max|\(max\)|\bmax\b)$') THEN 'Max Effort'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'(-xhigh|-high|\(high\)|\bhigh\b|\bxhigh\b)$') THEN 'High Effort'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'(-medium|\(medium\)|\bmedium\b)$') THEN 'Medium Effort'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'(-lite|-low|-minimal|\(low\)|\(lite\))$') THEN 'Lite Effort'
    ELSE 'Standard'
  END AS effort_level,
  d.quota_type,
  CASE COALESCE(d.quota_type, '')
    WHEN 'OVERAGE_QUOTA' THEN 'OVERAGE_QUOTA'
    ELSE 'REGULAR_QUOTA'
  END AS quota_tier,
  d.request_count,
  IF(SAFE_DIVIDE(d.prompt_tokens, GREATEST(1, d.request_count)) > 200000, 1, 0) AS is_long_context,
  d.tool_calls_count,
  d.prompt_tokens,
  GREATEST(0, d.prompt_tokens - d.cached_tokens) AS uncached_prompt_tokens,
  d.cached_tokens,
  d.output_tokens,
  d.thinking_tokens,
  d.total_tokens,
  ROUND(
    (
      (GREATEST(0, d.prompt_tokens - d.cached_tokens) * COALESCE(r.input_usd_per_1m, 1.50) / 1000000.0)
      + (d.cached_tokens * COALESCE(r.cached_input_usd_per_1m, 0.20) / 1000000.0)
    ) * IF(SAFE_DIVIDE(d.prompt_tokens, GREATEST(1, d.request_count)) > 200000, 2.0, 1.0)
    + (d.output_tokens * COALESCE(r.output_usd_per_1m, 8.00) / 1000000.0)
    + (d.thinking_tokens * COALESCE(r.thinking_usd_per_1m, 8.00) / 1000000.0),
    6
  ) AS estimated_cost_usd,
  ROUND(
    (
      d.cached_tokens
      * GREATEST(0, COALESCE(r.input_usd_per_1m, 1.50) - COALESCE(r.cached_input_usd_per_1m, 0.20))
      * IF(SAFE_DIVIDE(d.prompt_tokens, GREATEST(1, d.request_count)) > 200000, 2.0, 1.0)
      / 1000000.0
    ),
    6
  ) AS cache_savings_usd
FROM deduped d
LEFT JOIN `${PROJECT_ID}.${MONITORING_DATASET}.model_pricing_rates` r
  ON d.model_id = r.model_id;

CREATE OR REPLACE VIEW `${PROJECT_ID}.${MONITORING_DATASET}.v_daily_org_metrics` AS
WITH daily_users AS (
  SELECT DISTINCT event_date, user_email
  FROM `${PROJECT_ID}.${MONITORING_DATASET}.v_antigravity_events`
),
dates AS (
  SELECT DISTINCT event_date
  FROM `${PROJECT_ID}.${MONITORING_DATASET}.v_antigravity_events`
),
rolling AS (
  SELECT
    d.event_date,
    COUNT(DISTINCT IF(u.event_date = d.event_date, u.user_email, NULL)) AS dau,
    COUNT(DISTINCT IF(u.event_date BETWEEN DATE_SUB(d.event_date, INTERVAL 6 DAY) AND d.event_date, u.user_email, NULL)) AS wau_7d,
    COUNT(DISTINCT IF(u.event_date BETWEEN DATE_SUB(d.event_date, INTERVAL 27 DAY) AND d.event_date, u.user_email, NULL)) AS mau_28d
  FROM dates d
  JOIN daily_users u
    ON u.event_date BETWEEN DATE_SUB(d.event_date, INTERVAL 27 DAY) AND d.event_date
  GROUP BY d.event_date
),
daily_agg AS (
  SELECT
    event_date,
    SUM(request_count) AS requests,
    COUNT(DISTINCT NULLIF(session_id, '')) AS sessions,
    SUM(tool_calls_count) AS tool_calls,
    SUM(IF(quota_tier = 'OVERAGE_QUOTA', request_count, 0)) AS overage_requests,
    SUM(IF(quota_tier = 'REGULAR_QUOTA', request_count, 0)) AS regular_requests,
    SUM(IF(is_long_context = 1, request_count, 0)) AS long_context_turns,
    SUM(uncached_prompt_tokens) AS uncached_prompt_tokens,
    SUM(cached_tokens) AS cached_tokens,
    SUM(output_tokens) AS output_tokens,
    SUM(thinking_tokens) AS thinking_tokens,
    SUM(total_tokens) AS total_tokens,
    COALESCE(ROUND(SAFE_DIVIDE(SUM(cached_tokens), SUM(prompt_tokens)) * 100, 1), 0) AS cache_hit_rate_pct,
    ROUND(SUM(estimated_cost_usd), 2) AS estimated_cost_usd,
    ROUND(SUM(cache_savings_usd), 2) AS cache_savings_usd
  FROM `${PROJECT_ID}.${MONITORING_DATASET}.v_antigravity_events`
  GROUP BY event_date
)
SELECT
  a.event_date,
  r.dau,
  r.wau_7d,
  r.mau_28d,
  COALESCE(ROUND(SAFE_DIVIDE(r.dau, r.mau_28d) * 100, 1), 0) AS stickiness_pct,
  a.requests,
  a.sessions,
  a.tool_calls,
  a.overage_requests,
  a.regular_requests,
  a.long_context_turns,
  a.uncached_prompt_tokens,
  a.cached_tokens,
  a.output_tokens,
  a.thinking_tokens,
  a.total_tokens,
  a.cache_hit_rate_pct,
  a.estimated_cost_usd,
  a.cache_savings_usd
FROM daily_agg a
JOIN rolling r
  ON a.event_date = r.event_date;
