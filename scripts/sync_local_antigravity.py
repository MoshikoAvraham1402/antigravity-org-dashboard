#!/usr/bin/env python3
"""
Privacy-First Local Antigravity Workstation Telemetry Sync.

Reads ONLY non-sensitive metadata (token counts, model IDs, effort labels, timestamps,
client version, tool call counts, and UUIDs) from local Antigravity SQLite files under
~/.gemini/antigravity*, ~/.gemini/antigravity-ide*, ~/.gemini/antigravity-cli* and
uploads deduplicated turn events to BigQuery.

Strictly NEVER reads prompt text, code completions, conversation titles, previews,
or `step_payload` blobs.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.telemetry_utils import (  # noqa: E402
    get_gcp_credentials,
    infer_provider_for_model,
    parse_protobuf_fields,
)


def detect_local_email(gemini_dir: Path) -> str:
    acc_file = gemini_dir / "google_accounts.json"
    if acc_file.is_file():
        try:
            data = json.loads(acc_file.read_text(encoding="utf-8"))
            active = str(data.get("active") or "").strip().lower()
            if "@" in active:
                return active
        except Exception:
            pass
    return "local-developer@workstation.local"


def detect_client_version(app_dir: Path) -> str:
    daemon_dir = app_dir / "daemon"
    if not daemon_dir.is_dir():
        return ""
    best = ""
    best_mtime = -1.0
    for p in daemon_dir.glob("hub_*.json"):
        try:
            st = p.stat()
            data = json.loads(p.read_text(encoding="utf-8"))
            ver = str(data.get("lsVersion") or "").strip()
            if ver and st.st_mtime > best_mtime:
                best = ver
                best_mtime = st.st_mtime
        except Exception:
            continue
    return best


def _extract_step_metadata(conn: sqlite3.Connection) -> tuple[dict[int, str], list[tuple[int, int]]]:
    """Read ONLY timestamp + tool-call presence from steps.metadata (never step_payload)."""
    step_ts: dict[int, str] = {}
    tool_steps: list[tuple[int, int]] = []
    try:
        rows = conn.execute("SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx")
    except sqlite3.Error:
        return step_ts, tool_steps

    for idx, blob in rows:
        if not isinstance(blob, (bytes, bytearray)):
            continue
        try:
            fields = parse_protobuf_fields(bytes(blob), max_depth=2)
        except Exception:
            continue
        ts_msg = next((v for k, t, v in fields if k == 1 and t == "msg"), None)
        if ts_msg:
            sec = next((v for k, t, v in ts_msg if k == 1 and t == "varint"), 0)
            if sec > 1_600_000_000:
                step_ts[int(idx)] = datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
        has_tool = any(k == 4 and t == "msg" for k, t, _ in fields)
        if has_tool:
            tool_steps.append((int(idx), 1))
    return step_ts, tool_steps


def parse_local_db_turns(
    db_path: Path,
    client_name: str,
    client_version: str,
    user_email: str,
    project_id: str,
    cutoff_dt: datetime,
) -> list[dict[str, Any]]:
    """Extract turn metadata rows from a single local Antigravity conversation SQLite DB."""
    if not db_path.is_file():
        return []

    uri = f"file:{db_path.as_posix()}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5)
    except sqlite3.Error:
        return []

    try:
        has_gen = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='gen_metadata'"
        ).fetchone()
        if not has_gen:
            return []

        step_ts_map, tool_steps = _extract_step_metadata(conn)
        fallback_ts = datetime.fromtimestamp(db_path.stat().st_mtime, tz=timezone.utc).isoformat()
        conv_id = db_path.stem

        raw_rows = conn.execute("SELECT idx, data FROM gen_metadata ORDER BY idx").fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    parsed_turns: list[tuple[int, dict[str, Any]]] = []
    last_model_id = ""
    last_experience = ""
    for g_idx, blob in raw_rows:
        if not isinstance(blob, (bytes, bytearray)):
            continue
        try:
            outer = parse_protobuf_fields(bytes(blob), max_depth=3)
        except Exception:
            continue

        inner = next((v for k, t, v in outer if k == 1 and t == "msg"), None)
        if not inner:
            continue

        usage_msg = next((v for k, t, v in inner if k == 4 and t == "msg"), [])
        u_nums = {k: v for k, t, v in usage_msg if t == "varint"}
        uncached_in = int(u_nums.get(2, 0))
        cached_in = int(u_nums.get(5, 0))
        out_tok = int(u_nums.get(9, 0))
        think_tok = int(u_nums.get(10, 0))
        if out_tok == 0 and think_tok == 0 and 3 in u_nums:
            out_tok = int(u_nums[3])

        prompt_tok = uncached_in + cached_in
        total_tok = prompt_tok + out_tok + think_tok

        str_19 = next((v for k, t, v in inner if k == 19 and t == "str"), "")
        str_21 = next((v for k, t, v in inner if k == 21 and t == "str"), "")
        kv: dict[str, str] = {}
        for k, t, v in inner:
            if k == 20 and t == "msg" and len(v) >= 2 and v[0][1] == "str" and v[1][1] == "str":
                kv[v[0][2]] = v[1][2]

        model_id = str_19.strip()
        if not model_id and str_21:
            base = str_21.split("(")[0].strip().lower().replace(" ", "-")
            model_id = base
        if model_id:
            last_model_id = model_id
        else:
            model_id = last_model_id or "unknown"

        experience = str_21.strip()
        if experience:
            last_experience = experience
        elif model_id == last_model_id:
            experience = last_experience

        if total_tok <= 0:
            continue

        trajectory_id = kv.get("trajectory_id") or kv.get("cascade_id") or conv_id
        req_id = f"local:{kv.get('request_id') or f'{trajectory_id}-{g_idx}'}"
        step_idx_raw = kv.get("last_step_index")
        step_idx = int(step_idx_raw) if step_idx_raw and step_idx_raw.isdigit() else -1

        ts_iso = step_ts_map.get(step_idx)
        if not ts_iso and step_ts_map:
            earlier = [t for si, t in step_ts_map.items() if si <= step_idx]
            ts_iso = earlier[-1] if earlier else next(iter(step_ts_map.values()))
        if not ts_iso:
            ts_iso = fallback_ts

        try:
            ev_dt = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
            if ev_dt.tzinfo is None:
                ev_dt = ev_dt.replace(tzinfo=timezone.utc)
        except Exception:
            ev_dt = datetime.now(timezone.utc)

        if ev_dt < cutoff_dt:
            continue

        parsed_turns.append(
            (
                step_idx,
                {
                    "insert_id": req_id,
                    "request_id": req_id,
                    "event_ts": ev_dt.isoformat(),
                    "project_id": project_id,
                    "resource_container": project_id,
                    "user_email": user_email,
                    "trajectory_id": trajectory_id,
                    "model_id": model_id,
                    "model_provider": infer_provider_for_model(model_id),
                    "client_name": client_name,
                    "client_version": client_version,
                    "experience": experience or "",
                    "quota_type": "REGULAR_QUOTA",
                    "prompt_tokens": prompt_tok,
                    "cached_tokens": cached_in,
                    "output_tokens": out_tok,
                    "thinking_tokens": think_tok,
                    "total_tokens": total_tok,
                    "tool_calls_count": 0,
                    "request_count": 1,
                },
            )
        )

    # Attribute tool calls between consecutive gen_metadata turns
    for i, (s_idx, row) in enumerate(parsed_turns):
        if s_idx < 0:
            continue
        next_idx = parsed_turns[i + 1][0] if i + 1 < len(parsed_turns) else 10**9
        if next_idx < s_idx:
            next_idx = 10**9
        row["tool_calls_count"] = sum(
            cnt for ts_i, cnt in tool_steps if s_idx < ts_i <= next_idx
        )

    return [row for _, row in parsed_turns]


def collect_local_rows(
    gemini_dir: Path,
    project_id: str,
    user_email: str,
    days: int,
) -> list[dict[str, Any]]:
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    surfaces = [
        ("antigravity", "antigravity_ide"),
        ("antigravity-ide", "antigravity_ide"),
        ("antigravity-cli", "antigravity_cli"),
    ]
    all_rows: list[dict[str, Any]] = []
    seen_req: set[str] = set()
    hub_ver = detect_client_version(gemini_dir / "antigravity")

    for subdir, client_name in surfaces:
        app_dir = gemini_dir / subdir
        conv_dir = app_dir / "conversations"
        if not conv_dir.is_dir():
            continue
        ver = detect_client_version(app_dir) or hub_ver
        for db_file in conv_dir.glob("*.db"):
            for row in parse_local_db_turns(db_file, client_name, ver, user_email, project_id, cutoff_dt):
                if row["request_id"] not in seen_req:
                    seen_req.add(row["request_id"])
                    all_rows.append(row)
    return all_rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync privacy-safe local Antigravity metadata into BigQuery.")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", ""), help="Destination BigQuery GCP Project ID")
    parser.add_argument("--dataset", default=os.getenv("MONITORING_DATASET", "antigravity_monitoring"))
    parser.add_argument("--table", default="real_historical_inference_logs")
    parser.add_argument("--days", type=int, default=30, help="Lookback window in days (default: 30)")
    parser.add_argument("--email", default="", help="Override developer email attribution")
    parser.add_argument("--gemini-dir", default="~/.gemini", help="Path to local .gemini directory")
    parser.add_argument("--dry-run", action="store_true", help="Inspect counts locally without writing to BigQuery")
    args = parser.parse_args()

    gemini_dir = Path(os.path.expanduser(args.gemini_dir)).resolve()
    project_id = args.project.strip()
    if not project_id and not args.dry_run:
        _, detected = get_gcp_credentials()
        project_id = detected or ""
    if not project_id:
        project_id = "local-workstation"

    user_email = args.email.strip().lower() or detect_local_email(gemini_dir)
    rows = collect_local_rows(gemini_dir, project_id, user_email, args.days)

    total_tok = sum(r["total_tokens"] for r in rows)
    total_cached = sum(r["cached_tokens"] for r in rows)
    models = sorted({r["model_id"] for r in rows})
    print(
        f"==> Local Antigravity scan ({gemini_dir}): {len(rows)} turns, "
        f"{total_tok:,} tokens ({total_cached:,} cached), models={models}"
    )

    if args.dry_run or not rows:
        return

    from google.api_core.exceptions import NotFound
    from google.cloud import bigquery

    creds, _ = get_gcp_credentials(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    bq = bigquery.Client(project=project_id, credentials=creds)
    table_fqn = f"{project_id}.{args.dataset}.{args.table}"
    try:
        tbl = bq.get_table(table_fqn)
    except NotFound as exc:
        raise SystemExit(f"Error: BigQuery table {table_fqn} not found. Run bootstrap_bigquery.py first.") from exc

    has_req_count = any(f.name == "request_count" for f in (tbl.schema or []))
    existing_rows = bq.query(
        f"SELECT DISTINCT request_id FROM `{table_fqn}` WHERE STARTS_WITH(request_id, 'local:')",
        job_config=bigquery.QueryJobConfig(labels={"datacloud": "antigravity"}),
    ).result()
    existing = {str(r["request_id"]) for r in existing_rows}

    to_insert = [r for r in rows if r["request_id"] not in existing]
    if not has_req_count:
        for r in to_insert:
            r.pop("request_count", None)

    if not to_insert:
        print("    All local turns are already synced in BigQuery (0 new rows).")
        return

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
    if has_req_count:
        schema.append(bigquery.SchemaField("request_count", "INT64"))

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        time_partitioning=bigquery.TimePartitioning(type_=bigquery.TimePartitioningType.DAY, field="event_ts"),
        clustering_fields=["user_email", "model_id", "client_name"],
        labels={"datacloud": "antigravity"},
    )
    bq.load_table_from_json(to_insert, table_fqn, job_config=job_config).result()
    print(f"[OK] Synced {len(to_insert)} new local Antigravity turns into {table_fqn}.")


if __name__ == "__main__":
    main()
