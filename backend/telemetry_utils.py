"""Shared telemetry normalization, SemVer, pricing catalog, and privacy-safe protobuf decoders."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from typing import Any

_SEMVER_RE = re.compile(r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+.]?(.*))?$")
_DNS_DOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")

DEFAULT_PRICING_RATES: list[dict[str, Any]] = [
    # Anthropic Claude models
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
        "model_id": "claude-opus-4-8",
        "display_name": "Claude Opus 4.8",
        "provider": "Anthropic",
        "input_usd_per_1m": 5.00,
        "cached_input_usd_per_1m": 0.50,
        "output_usd_per_1m": 25.00,
        "thinking_usd_per_1m": 25.00,
    },
    {
        "model_id": "claude-opus-4-6",
        "display_name": "Claude Opus 4.6",
        "provider": "Anthropic",
        "input_usd_per_1m": 5.00,
        "cached_input_usd_per_1m": 0.50,
        "output_usd_per_1m": 25.00,
        "thinking_usd_per_1m": 25.00,
    },
    {
        "model_id": "claude-sonnet-4-6",
        "display_name": "Claude Sonnet 4.6",
        "provider": "Anthropic",
        "input_usd_per_1m": 3.00,
        "cached_input_usd_per_1m": 0.30,
        "output_usd_per_1m": 15.00,
        "thinking_usd_per_1m": 15.00,
    },
    {
        "model_id": "claude-sonnet-4-5",
        "display_name": "Claude Sonnet 4.5",
        "provider": "Anthropic",
        "input_usd_per_1m": 3.00,
        "cached_input_usd_per_1m": 0.30,
        "output_usd_per_1m": 15.00,
        "thinking_usd_per_1m": 15.00,
    },
    {
        "model_id": "claude-haiku-4-5",
        "display_name": "Claude Haiku 4.5",
        "provider": "Anthropic",
        "input_usd_per_1m": 0.80,
        "cached_input_usd_per_1m": 0.08,
        "output_usd_per_1m": 4.00,
        "thinking_usd_per_1m": 4.00,
    },
    # Google Gemini 4 family
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
    # Google Gemini 3.x family & image/live models
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
        "model_id": "gemini-3.8-flash-n",
        "display_name": "Gemini 3.8 Flash (IDE)",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.04,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3.8-live",
        "display_name": "Gemini 3.8 Live",
        "provider": "Google",
        "input_usd_per_1m": 0.50,
        "cached_input_usd_per_1m": 0.05,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3.7-flash",
        "display_name": "Gemini 3.7 Flash",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.04,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3.6-flash",
        "display_name": "Gemini 3.6 Flash",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.04,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    {
        "model_id": "gemini-3.5-flash",
        "display_name": "Gemini 3.5 Flash",
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
        "model_id": "gemini-3.5-transcribe-live",
        "display_name": "Gemini 3.5 Transcribe Live",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.03,
        "output_usd_per_1m": 1.20,
        "thinking_usd_per_1m": 1.20,
    },
    {
        "model_id": "gemini-3.1-pro-preview",
        "display_name": "Gemini 3.1 Pro",
        "provider": "Google",
        "input_usd_per_1m": 2.00,
        "cached_input_usd_per_1m": 0.25,
        "output_usd_per_1m": 12.00,
        "thinking_usd_per_1m": 12.00,
    },
    {
        "model_id": "gemini-3-pro-preview",
        "display_name": "Gemini 3 Pro",
        "provider": "Google",
        "input_usd_per_1m": 2.00,
        "cached_input_usd_per_1m": 0.25,
        "output_usd_per_1m": 12.00,
        "thinking_usd_per_1m": 12.00,
    },
    {
        "model_id": "gemini-nano-banana-2.1",
        "display_name": "Nano Banana 2.1",
        "provider": "Google",
        "input_usd_per_1m": 2.00,
        "cached_input_usd_per_1m": 0.25,
        "output_usd_per_1m": 12.00,
        "thinking_usd_per_1m": 12.00,
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
    {
        "model_id": "gemini-3.1-flash-image",
        "display_name": "Gemini 3.1 Flash Image",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.03,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
    # Google Gemini 2.5 family
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
        "model_id": "gemini-2.5-flash-lite",
        "display_name": "Gemini 2.5 Flash Lite",
        "provider": "Google",
        "input_usd_per_1m": 0.10,
        "cached_input_usd_per_1m": 0.01,
        "output_usd_per_1m": 0.40,
        "thinking_usd_per_1m": 0.40,
    },
    {
        "model_id": "gemini-2.5-flash-image",
        "display_name": "Gemini 2.5 Flash Image",
        "provider": "Google",
        "input_usd_per_1m": 0.30,
        "cached_input_usd_per_1m": 0.03,
        "output_usd_per_1m": 2.50,
        "thinking_usd_per_1m": 2.50,
    },
]


def parse_semver_key(version: str | None) -> tuple[int, int, int, int, int, str]:
    """Return a sortable SemVer tuple so 2.10.0 sorts strictly newer than 2.9.0.

    Returns (is_known, major, minor, patch, is_stable, raw_suffix).
    Unknown/empty versions sort last.
    """
    raw = (version or "").strip()
    if not raw or raw.lower() == "unknown":
        return (0, 0, 0, 0, 0, "")
    match = _SEMVER_RE.match(raw)
    if not match:
        return (1, 0, 0, 0, 0, raw)
    major = int(match.group(1) or 0)
    minor = int(match.group(2) or 0)
    patch = int(match.group(3) or 0)
    suffix = (match.group(4) or "").strip()
    is_stable = 1 if not suffix else 0
    return (2, major, minor, patch, is_stable, suffix)


def extract_effort_level(experience: str | None) -> str:
    """Normalize Antigravity experience metadata into human-readable effort tiers."""
    s = (experience or "").strip().lower()
    if not s:
        return "Standard"
    if s.endswith("-max") or s.endswith("(max)") or " max" in s:
        return "Max Effort"
    if s.endswith("-xhigh") or s.endswith("-high") or s.endswith("(high)") or " high" in s or "xhigh" in s:
        return "High Effort"
    if s.endswith("-medium") or s.endswith("(medium)") or " medium" in s:
        return "Medium Effort"
    if s.endswith("-lite") or s.endswith("-low") or s.endswith("-minimal") or s.endswith("(low)") or s.endswith("(lite)"):
        return "Lite Effort"
    return "Standard"


def is_valid_dns_domain(domain: str | None) -> bool:
    """True when value is a clean DNS domain (e.g. acme.com), rejecting org display names with spaces."""
    if not domain:
        return False
    return bool(_DNS_DOMAIN_RE.match(domain.strip().lower()))


def infer_provider_for_model(model_id: str | None) -> str:
    m = (model_id or "").lower()
    if "claude" in m:
        return "Anthropic"
    if "llama" in m:
        return "Meta"
    if "mistral" in m:
        return "Mistral"
    return "Google"


def get_gcp_credentials(scopes: list[str] | None = None) -> tuple[Any, str | None]:
    """Return Application Default Credentials, falling back locally to `gcloud auth print-access-token`.

    On Cloud Run (K_SERVICE set), standard ADC metadata credentials always succeed.
    Locally, developers often run `gcloud auth login` without `application-default login`;
    falling back to `gcloud auth print-access-token` lets CLI scripts and local dev servers
    work seamlessly out of the box.
    """
    import google.auth
    from google.auth.exceptions import DefaultCredentialsError

    try:
        creds, project = google.auth.default(scopes=scopes)
        return creds, project
    except DefaultCredentialsError:
        if os.getenv("K_SERVICE"):
            raise
        gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
        if not gcloud:
            raise
        tok_res = subprocess.run(
            [gcloud, "auth", "print-access-token"],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        token = tok_res.stdout.strip()
        if tok_res.returncode != 0 or not token:
            raise
        proj_res = subprocess.run(
            [gcloud, "config", "get-value", "project"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        proj = proj_res.stdout.strip() or None
        from google.oauth2.credentials import Credentials

        return Credentials(token=token), proj


def parse_protobuf_fields(buf: bytes, max_depth: int = 3) -> list[tuple[int, str, Any]]:
    """Minimal zero-dependency protobuf wire-format decoder for metadata inspection.

    Only decodes varints, nested messages, and short ASCII label/UUID strings.
    Long arbitrary binary/prose payloads are returned strictly as byte lengths so no
    prompt or source-code content is ever surfaced.
    """
    i = 0
    n = len(buf)
    out: list[tuple[int, str, Any]] = []
    while i < n:
        tag = 0
        shift = 0
        while i < n:
            b = buf[i]
            i += 1
            tag |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
            if shift > 35:
                raise ValueError("varint overflow")
        fn = tag >> 3
        wt = tag & 7
        if wt == 0:
            val = 0
            s = 0
            while i < n:
                b = buf[i]
                i += 1
                val |= (b & 0x7F) << s
                if not (b & 0x80):
                    break
                s += 7
                if s > 63:
                    raise ValueError("varint overflow")
            out.append((fn, "varint", val))
        elif wt == 2:
            ln = 0
            s = 0
            while i < n:
                b = buf[i]
                i += 1
                ln |= (b & 0x7F) << s
                if not (b & 0x80):
                    break
                s += 7
                if s > 35:
                    raise ValueError("length overflow")
            if i + ln > n:
                raise ValueError("truncated length-delimited field")
            sub = buf[i : i + ln]
            i += ln
            try:
                txt = sub.decode("utf-8")
                if len(txt) <= 120 and all(32 <= ord(c) < 127 for c in txt):
                    out.append((fn, "str", txt))
                    continue
            except UnicodeDecodeError:
                pass
            if max_depth > 0 and len(sub) > 0:
                try:
                    out.append((fn, "msg", parse_protobuf_fields(sub, max_depth - 1)))
                    continue
                except Exception:
                    pass
            out.append((fn, "bytes", len(sub)))
        elif wt == 1:
            if i + 8 > n:
                raise ValueError("truncated 64-bit")
            out.append((fn, "64b", int.from_bytes(buf[i : i + 8], "little")))
            i += 8
        elif wt == 5:
            if i + 4 > n:
                raise ValueError("truncated 32-bit")
            out.append((fn, "32b", int.from_bytes(buf[i : i + 4], "little")))
            i += 4
        else:
            raise ValueError(f"unsupported wire type {wt}")
    return out
