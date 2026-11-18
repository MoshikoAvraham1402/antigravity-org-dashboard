#!/usr/bin/env python3
"""
Bootstraps the BigQuery datasets, partitioned historical table, model pricing reference table,
organization project directory, and analytical SQL views for the Antigravity Usage Dashboard.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import google.auth
import google.auth.transport.requests
import requests
from google.api_core.exceptions import NotFound
from google.cloud import bigquery

DEFAULT_PRICING_RATES = [
    {
        "model_id": "claude-opus-5-5",
        "display_name": "Claude Opus 5.5",
        "provider": "Anthropic",
        "input_usd_per_1m": 5.00,
        "cached_input_usd_per_1m": 0.50,
        "output_usd_per_1m": 25.00,
        "thinking_usd_per_1m": 25.00,
    },
    {
        "model_id": "claude-sonnet-5-5",
        "display_name": "Claude Sonnet 5.5",
        "provider": "Anthropic",
        "input_usd_per_1m": 3.00,
        "cached_input_usd_per_1m": 0.30,
        "output_usd_per_1m": 15.00,
        "thinking_usd_per_1m": 15.00,
    },
    {
        "model_id": "gemini-4-carbon",
        "display_name": "Gemini 4 Carbon",
        "provider": "Google",
        "input_usd_per_1m": 2.00,
        "cached_input_usd_per_1m": 0.25,
        "output_usd_per_1m": 12.00,
        "thinking_usd_per_1m": 12.00,
    },
    {
        "model_id": "gemini-4-argon",
        "display_name": "Gemini 4 Argon",
        "provider": "Google",
        "input_usd_per_1m": 1.50,
        "cached_input_usd_per_1m": 0.20,
        "output_usd_per_1m": 8.00,
        "thinking_usd_per_1m": 8.00,
    },
    {
        "model_id": "gemini-4-hydrogen",
        "display_name": "Gemini 4 Hydrogen",
        "provider": "Google",
        "input_usd_per_1m": 1.50,
        "cached_input_usd_per_1m": 0.20,
        "output_usd_per_1m": 8.00,
        "thinking_usd_per_1m": 8.00,
    },
    {
        "model_id": "gemini-3.8-flash",
        "display_name": "Gemini 3.8 Flash",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.04,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3.5-flash-lite",
        "display_name": "Gemini 3.5 Flash Lite",
        "provider": "Google",
        "input_usd_per_1m": 0.10,
        "cached_input_usd_per_1m": 0.025,
        "output_usd_per_1m": 0.40,
        "thinking_usd_per_1m": 0.40,
    },
    {
        "model_id": "gemini-2.5-pro",
        "display_name": "Gemini 2.5 Pro",
        "provider": "Google",
        "input_usd_per_1m": 1.25,
        "cached_input_usd_per_1m": 0.125,
        "output_usd_per_1m": 10.00,
        "thinking_usd_per_1m": 10.00,
    },
    {
        "model_id": "gemini-2.5-flash",
        "display_name": "Gemini 2.5 Flash",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.03,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3-pro-image",
        "display_name": "Gemini 3 Pro Image",
        "provider": "Google",
        "input_usd_per_1m": 2.00,
        "cached_input_usd_per_1m": 0.25,
        "output_usd_per_1m": 12.00,
        "thinking_usd_per_1m": 12.00,
    },
]


def ensure_dataset(bq: bigquery.Client, project_id: str, dataset_id: str, location: str, description: str) -> None:
    fqn = f"{project_id}.{dataset_id}"
    try:
        bq.get_dataset(fqn)
        print(f"    Dataset {fqn} already exists.")
    except NotFound:
        ds = bigquery.Dataset(fqn)
        ds.location = location
        ds.description = description
        ds.labels = {"datacloud": "antigravity"}
        bq.create_dataset(ds, timeout=30)
        print(f"    Created dataset {fqn} ({location}).")


def ensure_historical_table(bq: bigquery.Client, project_id: str, dataset_id: str) -> None:
    fqn = f"{project_id}.{dataset_id}.real_historical_inference_logs"
    try:
        bq.get_table(fqn)
        print(f"    Table {fqn} already exists.")
        return
    except NotFound:
        pass

    schema = [
        bigquery.SchemaField("insert_id", "STRING"),
        bigquery.SchemaField("request_id", "STRING"),
        bigquery.SchemaField("event_ts", "TIMESTAMP"),
        bigquery.SchemaField("project_id", "STRING"),
        bigquery.SchemaField("resource_container", "STRING"),
        bigquery.SchemaField("user_email", "STRING"),
        bigquery.SchemaField("trajectory_id", "STRING"),
        bigquery.SchemaField("model_id", "STRING"),
        bigquery.SchemaField("model_provider", "STRING"),
        bigquery.SchemaField("client_name", "STRING"),
        bigquery.SchemaField("client_version", "STRING"),
        bigquery.SchemaField("experience", "STRING"),
        bigquery.SchemaField("quota_type", "STRING"),
        bigquery.SchemaField("prompt_tokens", "INT64"),
        bigquery.SchemaField("cached_tokens", "INT64"),
        bigquery.SchemaField("output_tokens", "INT64"),
        bigquery.SchemaField("thinking_tokens", "INT64"),
        bigquery.SchemaField("total_tokens", "INT64"),
        bigquery.SchemaField("tool_calls_count", "INT64"),
    ]
    table = bigquery.Table(fqn, schema=schema)
    table.time_partitioning = bigquery.TimePartitioning(
        type_=bigquery.TimePartitioningType.DAY,
        field="event_ts",
    )
    table.clustering_fields = ["user_email", "model_id", "client_name"]
    table.labels = {"datacloud": "antigravity"}
    bq.create_table(table)
    print(f"    Created partitioned & clustered table {fqn}.")


def seed_pricing_rates(bq: bigquery.Client, project_id: str, dataset_id: str) -> None:
    fqn = f"{project_id}.{dataset_id}.model_pricing_rates"
    schema = [
        bigquery.SchemaField("model_id", "STRING"),
        bigquery.SchemaField("display_name", "STRING"),
        bigquery.SchemaField("provider", "STRING"),
        bigquery.SchemaField("input_usd_per_1m", "FLOAT64"),
        bigquery.SchemaField("cached_input_usd_per_1m", "FLOAT64"),
        bigquery.SchemaField("output_usd_per_1m", "FLOAT64"),
        bigquery.SchemaField("thinking_usd_per_1m", "FLOAT64"),
    ]
    try:
        bq.get_table(fqn)
    except NotFound:
        t = bigquery.Table(fqn, schema=schema)
        t.labels = {"datacloud": "antigravity"}
        bq.create_table(t)
        print(f"    Created reference table {fqn}.")

    values_sql = ",\n      ".join(
        f"('{r['model_id']}', '{r['display_name']}', '{r['provider']}', "
        f"{r['input_usd_per_1m']}, {r['cached_input_usd_per_1m']}, "
        f"{r['output_usd_per_1m']}, {r['thinking_usd_per_1m']})"
        for r in DEFAULT_PRICING_RATES
    )
    merge_sql = f"""
    MERGE `{fqn}` T
    USING (
      SELECT * FROM UNNEST([
        STRUCT<
          model_id STRING,
          display_name STRING,
          provider STRING,
          input_usd_per_1m FLOAT64,
          cached_input_usd_per_1m FLOAT64,
          output_usd_per_1m FLOAT64,
          thinking_usd_per_1m FLOAT64
        >
        {values_sql}
      ])
    ) S
    ON T.model_id = S.model_id
    WHEN NOT MATCHED THEN
      INSERT (model_id, display_name, provider, input_usd_per_1m, cached_input_usd_per_1m, output_usd_per_1m, thinking_usd_per_1m)
      VALUES (S.model_id, S.display_name, S.provider, S.input_usd_per_1m, S.cached_input_usd_per_1m, S.output_usd_per_1m, S.thinking_usd_per_1m)
    """
    bq.query(merge_sql, job_config=bigquery.QueryJobConfig(labels={"datacloud": "antigravity"})).result()
    print(f"    Seeded default token pricing rates into {fqn} (existing custom rates preserved).")


def sync_project_directory(bq: bigquery.Client, project_id: str, dataset_id: str) -> None:
    fqn = f"{project_id}.{dataset_id}.project_directory"
    schema = [
        bigquery.SchemaField("project_number", "STRING"),
        bigquery.SchemaField("project_id", "STRING"),
    ]
    rows: list[dict[str, Any]] = []
    try:
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        resp = requests.get(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            headers={"Authorization": f"Bearer {creds.token}"},
            params={"filter": "lifecycleState:ACTIVE", "pageSize": 500},
            timeout=15,
        )
        if resp.status_code == 200:
            for p in resp.json().get("projects", []):
                pid = p.get("projectId")
                pnum = str(p.get("projectNumber") or "")
                if pid and pnum:
                    rows.append({"project_number": pnum, "project_id": pid})
    except Exception as exc:
        print(f"    Note: Automatic project directory scan skipped ({exc}).")

    if not rows:
        try:
            bq.get_table(fqn)
        except NotFound:
            t = bigquery.Table(fqn, schema=schema)
            t.labels = {"datacloud": "antigravity"}
            bq.create_table(t)
        return

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        labels={"datacloud": "antigravity"},
    )
    bq.load_table_from_json(rows, fqn, job_config=job_config).result()
    print(f"    Synced {len(rows)} accessible GCP projects into {fqn}.")


def deploy_analytical_views(
    bq: bigquery.Client,
    project_id: str,
    monitoring_dataset: str,
    raw_dataset: str,
) -> None:
    resp_fqn = f"{project_id}.{raw_dataset}.businessaicode_googleapis_com_inference_response"
    tel_fqn = f"{project_id}.{raw_dataset}.businessaicode_googleapis_com_client_telemetry"

    has_live_resp = False
    has_live_tel = False
    try:
        bq.get_table(resp_fqn)
        has_live_resp = True
    except NotFound:
        pass
    try:
        bq.get_table(tel_fqn)
        has_live_tel = True
    except NotFound:
        pass

    if has_live_resp and has_live_tel:
        sql_path = Path(__file__).resolve().parent / "bigquery_views.sql"
        rendered = (
            sql_path.read_text(encoding="utf-8")
            .replace("${PROJECT_ID}", project_id)
            .replace("${MONITORING_DATASET}", monitoring_dataset)
            .replace("${RAW_LOGS_DATASET}", raw_dataset)
        )
        for stmt in [s.strip() for s in rendered.split(";") if s.strip()]:
            bq.query(stmt, job_config=bigquery.QueryJobConfig(labels={"datacloud": "antigravity"})).result()
        print("    Created/updated full analytical views (historical + live org sink).")
    else:
        # Bootstrap views over real_historical_inference_logs first (backend dynamically unions live sink as soon as it arrives)
        v_events_sql = f"""
        CREATE OR REPLACE VIEW `{project_id}.{monitoring_dataset}.v_antigravity_events` AS
        WITH deduped AS (
          SELECT *
          FROM `{project_id}.{monitoring_dataset}.real_historical_inference_logs`
          QUALIFY ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY tool_calls_count DESC, event_ts DESC) = 1
        )
        SELECT
          d.request_id,
          d.event_ts,
          DATE(d.event_ts) AS event_date,
          d.project_id,
          d.user_email,
          d.trajectory_id AS session_id,
          d.model_id,
          COALESCE(r.display_name, INITCAP(REPLACE(d.model_id, '-', ' '))) AS model_display_name,
          d.model_provider,
          CASE d.client_name
            WHEN 'antigravity_hub' THEN 'Antigravity Hub'
            WHEN 'antigravity_cli' THEN 'Antigravity CLI (agy)'
            WHEN 'antigravity_ide' THEN 'Antigravity IDE'
            ELSE INITCAP(REPLACE(d.client_name, '_', ' '))
          END AS surface,
          d.client_version,
          d.experience,
          CASE
            WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'-max$') THEN 'Max Effort'
            WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'-high$') THEN 'High Effort'
            WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'-medium$') THEN 'Medium Effort'
            WHEN REGEXP_CONTAINS(LOWER(COALESCE(d.experience, '')), r'-lite$|-low$') THEN 'Lite Effort'
            ELSE 'Standard'
          END AS effort_level,
          d.quota_type,
          CASE COALESCE(d.quota_type, '')
            WHEN 'OVERAGE_QUOTA' THEN 'OVERAGE_QUOTA'
            ELSE 'REGULAR_QUOTA'
          END AS quota_tier,
          IF(d.prompt_tokens > 200000, 1, 0) AS is_long_context,
          d.tool_calls_count,
          d.prompt_tokens,
          GREATEST(0, d.prompt_tokens - d.cached_tokens) AS uncached_prompt_tokens,
          d.cached_tokens,
          d.output_tokens,
          d.thinking_tokens,
          d.total_tokens,
          ROUND(
            (GREATEST(0, d.prompt_tokens - d.cached_tokens) * COALESCE(r.input_usd_per_1m, 1.50) / 1000000.0)
            + (d.cached_tokens * COALESCE(r.cached_input_usd_per_1m, 0.20) / 1000000.0)
            + (d.output_tokens * COALESCE(r.output_usd_per_1m, 8.00) / 1000000.0)
            + (d.thinking_tokens * COALESCE(r.thinking_usd_per_1m, 8.00) / 1000000.0),
            6
          ) AS estimated_cost_usd,
          ROUND(
            (d.cached_tokens * GREATEST(0, COALESCE(r.input_usd_per_1m, 1.50) - COALESCE(r.cached_input_usd_per_1m, 0.20)) / 1000000.0),
            6
          ) AS cache_savings_usd
        FROM deduped d
        LEFT JOIN `{project_id}.{monitoring_dataset}.model_pricing_rates` r
          ON d.model_id = r.model_id
        """
        bq.query(v_events_sql, job_config=bigquery.QueryJobConfig(labels={"datacloud": "antigravity"})).result()
        print("    Created initial analytical view (backend will automatically include live sink tables once first log arrives).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap BigQuery datasets & tables for Antigravity Dashboard.")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", ""), required=False, help="Host GCP Project ID")
    parser.add_argument("--location", default=os.getenv("BQ_LOCATION", "US"), help="BigQuery dataset location (e.g. US, EU)")
    parser.add_argument("--monitoring-dataset", default=os.getenv("MONITORING_DATASET", "antigravity_monitoring"))
    parser.add_argument("--raw-dataset", default=os.getenv("RAW_LOGS_DATASET", "antigravity_raw_logs"))
    args = parser.parse_args()

    project_id = args.project.strip()
    if not project_id:
        _, detected = google.auth.default()
        project_id = detected or ""
    if not project_id:
        raise SystemExit("Error: --project or GCP_PROJECT_ID is required.")

    print(f"==> Bootstrapping BigQuery analytics foundation in project '{project_id}' ({args.location})...")
    bq = bigquery.Client(project=project_id)

    ensure_dataset(
        bq,
        project_id,
        args.raw_dataset,
        args.location,
        "Cloud Logging sink destination for Antigravity InferenceResponseLog & ClientTelemetryLog",
    )
    ensure_dataset(
        bq,
        project_id,
        args.monitoring_dataset,
        args.location,
        "Antigravity Organization Usage & FinOps curated tables and views",
    )
    ensure_historical_table(bq, project_id, args.monitoring_dataset)
    seed_pricing_rates(bq, project_id, args.monitoring_dataset)
    sync_project_directory(bq, project_id, args.monitoring_dataset)
    deploy_analytical_views(bq, project_id, args.monitoring_dataset, args.raw_dataset)
    print("BigQuery foundation ready.")


if __name__ == "__main__":
    main()
