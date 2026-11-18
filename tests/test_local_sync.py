from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from scripts.sync_local_antigravity import parse_local_db_turns
from backend.telemetry_utils import parse_protobuf_fields
import pytest


def _varint(val: int) -> bytes:
    out = bytearray()
    while True:
        b = val & 0x7F
        val >>= 7
        if val:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def _field_varint(fn: int, val: int) -> bytes:
    return _varint((fn << 3) | 0) + _varint(val)


def _field_bytes(fn: int, data: bytes) -> bytes:
    return _varint((fn << 3) | 2) + _varint(len(data)) + data


def _kv_msg(k: str, v: str) -> bytes:
    return _field_bytes(1, k.encode("utf-8")) + _field_bytes(2, v.encode("utf-8"))


def test_parse_local_db_turns_extracts_metadata_without_reading_payload(tmp_path: Path):
    db_path = tmp_path / "11111111-2222-3333-4444-555555555555.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, step_payload BLOB)"
    )
    conn.execute("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER)")

    ts_epoch = int(datetime(2026, 11, 17, 14, 0, 0, tzinfo=timezone.utc).timestamp())
    step0_meta = _field_bytes(1, _field_varint(1, ts_epoch))
    step1_meta = _field_bytes(1, _field_varint(1, ts_epoch + 5)) + _field_bytes(4, _field_bytes(2, b"run_command"))

    conn.execute(
        "INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)",
        (0, 15, 2, step0_meta, b"SECRET_PROMPT_TEXT_MUST_NEVER_BE_READ"),
    )
    conn.execute(
        "INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)",
        (1, 132, 2, step1_meta, b"SECRET_CODE_OUTPUT_MUST_NEVER_BE_READ"),
    )

    usage_blob = (
        _field_varint(2, 2000)  # uncached prompt
        + _field_varint(5, 8000)  # cached prompt
        + _field_varint(9, 400)  # output
        + _field_varint(10, 100)  # thinking
        + _field_varint(3, 500)
    )
    inner_gen = (
        _field_bytes(4, usage_blob)
        + _field_bytes(19, b"gemini-3.8-flash-n")
        + _field_bytes(21, b"Gemini 3.8 Flash (High)")
        + _field_bytes(20, _kv_msg("request_id", "req-abc-0"))
        + _field_bytes(20, _kv_msg("trajectory_id", "traj-abc"))
        + _field_bytes(20, _kv_msg("last_step_index", "0"))
    )
    outer_gen = _field_bytes(1, inner_gen)
    conn.execute("INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)", (0, outer_gen, len(outer_gen)))
    conn.commit()
    conn.close()

    rows = parse_local_db_turns(
        db_path=db_path,
        client_name="antigravity_ide",
        client_version="2.32.1",
        user_email="dev@example.com",
        project_id="my-gcp-proj",
        cutoff_dt=datetime(2026, 11, 1, tzinfo=timezone.utc),
    )

    assert len(rows) == 1
    r = rows[0]
    assert r["request_id"] == "local:req-abc-0"
    assert r["trajectory_id"] == "traj-abc"
    assert r["model_id"] == "gemini-3.8-flash-n"
    assert r["experience"] == "Gemini 3.8 Flash (High)"
    assert r["prompt_tokens"] == 10000
    assert r["cached_tokens"] == 8000
    assert r["output_tokens"] == 400
    assert r["thinking_tokens"] == 100
    assert r["total_tokens"] == 10500
    assert r["tool_calls_count"] == 1
    assert r["client_version"] == "2.32.1"
    assert "SECRET" not in str(r)


def test_protobuf_decoder_rejects_truncated_varints_and_zero_field_tag():
    with pytest.raises(ValueError):
        parse_protobuf_fields(b"\x80")  # unterminated varint tag
    with pytest.raises(ValueError):
        parse_protobuf_fields(b"\x08\x80")  # unterminated varint value
    with pytest.raises(ValueError):
        parse_protobuf_fields(b"\x00\x01")  # invalid field number 0
