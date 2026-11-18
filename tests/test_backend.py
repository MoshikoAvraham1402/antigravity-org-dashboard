from __future__ import annotations

import collections
import types
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.telemetry_utils import (
    DEFAULT_PRICING_RATES,
    extract_effort_level,
    is_valid_dns_domain,
    parse_semver_key,
)
from backend.vertex_sync import collect_project_vertex_rows
from scripts import install as installer


def test_semver_sorting_orders_minor_and_patch_numerically():
    versions = ["2.9.0", "2.10.0", "1.12.0", "2.10.1-rc1", "unknown", "2.10.1"]
    sorted_desc = sorted(versions, key=parse_semver_key, reverse=True)
    assert sorted_desc[0] == "2.10.1"
    assert sorted_desc[1] == "2.10.1-rc1"
    assert sorted_desc[2] == "2.10.0"
    assert sorted_desc[3] == "2.9.0"
    assert sorted_desc[4] == "1.12.0"
    assert sorted_desc[-1] == "unknown"


def test_effort_level_extraction_covers_suffixes_and_parentheses():
    assert extract_effort_level("antigravity-max") == "Max Effort"
    assert extract_effort_level("Gemini 4 Carbon (Medium)") == "Medium Effort"
    assert extract_effort_level("Gemini 3.8 Flash (High)") == "High Effort"
    assert extract_effort_level("agent-xhigh") == "High Effort"
    assert extract_effort_level("quick-lite") == "Lite Effort"
    assert extract_effort_level("agent_chat") == "Standard"
    assert extract_effort_level("") == "Standard"


def test_dns_domain_validation_rejects_company_display_names():
    assert is_valid_dns_domain("acme.com") is True
    assert is_valid_dns_domain("eng.acme-corp.co.uk") is True
    assert is_valid_dns_domain("Acme Corp") is False
    assert is_valid_dns_domain("My Company") is False
    assert is_valid_dns_domain("") is False


def test_pricing_catalog_excludes_duplicates_and_covers_current_models():
    ids = [r["model_id"] for r in DEFAULT_PRICING_RATES]
    assert len(ids) == len(set(ids))
    for required in ("gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.8-flash-n", "gemini-nano-banana-2.1"):
        assert required in ids


def test_rate_limit_evicts_expired_without_resetting_active_clients():
    buckets: dict[str, collections.deque[float]] = collections.defaultdict(collections.deque)
    # Seed 4097 stale keys from an hour ago
    for i in range(4097):
        buckets[f"stale-{i}"].append(0.0)
    with patch("backend.main.time.monotonic", return_value=10_000.0):
        # Active user hits limit=2
        assert main._check_rate_limit(buckets, "active-user", limit=2, window_sec=60.0) is True
        assert main._check_rate_limit(buckets, "active-user", limit=2, window_sec=60.0) is True
        assert main._check_rate_limit(buckets, "active-user", limit=2, window_sec=60.0) is False
        assert "active-user" in buckets
        assert "stale-0" not in buckets


def test_input_validators():
    assert main.validate_days(30) == 30
    with pytest.raises(main.HTTPException):
        main.validate_days(15)

    assert main.validate_filter("Gemini 3.8 Flash", "model") == "Gemini 3.8 Flash"
    with pytest.raises(main.HTTPException):
        main.validate_filter("bad; DROP TABLE", "model")

    assert main.validate_user_email("Alice@Example.com") == "alice@example.com"
    assert main.validate_user_email("vertex-api@demo-proj.gcp.internal") == "vertex-api@demo-proj.gcp.internal"
    with pytest.raises(main.HTTPException):
        main.validate_user_email("not-an-email")


def test_security_headers_and_csrf_guard():
    client = TestClient(main.app)
    h = client.get("/api/health")
    assert h.status_code == 200
    assert h.json()["status"] == "ok"
    assert h.headers["x-frame-options"] == "DENY"

    # Missing X-Requested-With header is rejected
    r_missing = client.get("/api/dashboard")
    assert r_missing.status_code == 403

    # Cross-origin POST is rejected
    r_origin = client.post(
        "/api/sync",
        headers={
            "X-Requested-With": "AntigravityDashboard",
            "Origin": "https://evil.example",
            "Host": "dashboard.internal",
        },
    )
    assert r_origin.status_code == 403


def test_vertex_monitoring_collection_creates_deterministic_rows():
    tok_payload = {
        "timeSeries": [
            {
                "metric": {"labels": {"type": "input"}},
                "resource": {"labels": {"model_user_id": "gemini-4-hydrogen", "location": "global"}},
                "points": [{"interval": {"endTime": "2026-11-18T05:00:00Z"}, "value": {"int64Value": "1200"}}],
            },
            {
                "metric": {"labels": {"type": "output"}},
                "resource": {"labels": {"model_user_id": "gemini-4-hydrogen", "location": "global"}},
                "points": [{"interval": {"endTime": "2026-11-18T05:00:00Z"}, "value": {"int64Value": "350"}}],
            },
        ]
    }
    inv_payload = {
        "timeSeries": [
            {
                "metric": {"labels": {}},
                "resource": {"labels": {"model_user_id": "gemini-4-hydrogen", "location": "global"}},
                "points": [{"interval": {"endTime": "2026-11-18T05:00:00Z"}, "value": {"int64Value": "9"}}],
            }
        ]
    }
    aistudio_payload = {
        "timeSeries": [
            {
                "metric": {"labels": {"response_code_class": "2xx"}},
                "resource": {"labels": {"method": "google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent"}},
                "points": [{"interval": {"endTime": "2026-11-18T05:00:00Z"}, "value": {"int64Value": "14"}}],
            },
            {
                "metric": {"labels": {"response_code_class": "2xx"}},
                "resource": {"labels": {"method": "google.ai.generativelanguage.v1beta.ModelService.ListModels"}},
                "points": [{"interval": {"endTime": "2026-11-18T05:00:00Z"}, "value": {"int64Value": "50"}}],
            },
        ]
    }

    class FakeResp:
        def __init__(self, body):
            self.status_code = 200
            self._body = body

        def json(self):
            return self._body

    def fake_get(url, headers=None, params=None, timeout=12):
        flt = params.get("filter", "")
        if "token_count" in flt:
            return FakeResp(tok_payload)
        if "model_invocation_count" in flt:
            return FakeResp(inv_payload)
        return FakeResp(aistudio_payload)

    with patch("backend.vertex_sync.requests.get", side_effect=fake_get):
        rows = collect_project_vertex_rows(
            token="fake-token",
            project_id="demo-proj",
            start_iso="2026-11-18T00:00:00Z",
            end_iso="2026-11-18T06:00:00Z",
            existing_ids=set(),
        )

    assert len(rows) == 2
    by_id = {r["request_id"]: r for r in rows}
    row = by_id["vertex:demo-proj:gemini-4-hydrogen:global:2026-11-18T05:00:00Z"]
    assert row["prompt_tokens"] == 1200
    assert row["output_tokens"] == 350
    assert row["total_tokens"] == 1550
    assert row["request_count"] == 9
    assert row["client_name"] == "vertex_ai"
    assert main.validate_user_email(row["user_email"]) == "vertex-api@demo-proj.gcp.internal"

    ai_row = by_id["aistudio:demo-proj:GenerateContent:2026-11-18T05:00:00Z"]
    assert ai_row["request_count"] == 14
    assert ai_row["client_name"] == "gemini_api"
    assert main.validate_user_email(ai_row["user_email"]) == "gemini-api@demo-proj.gcp.internal"


def test_get_gcp_credentials_falls_back_to_gcloud_cli_locally(monkeypatch):
    from google.auth.exceptions import DefaultCredentialsError

    from backend.telemetry_utils import get_gcp_credentials

    monkeypatch.delenv("K_SERVICE", raising=False)

    class FakeProc:
        def __init__(self, stdout: str, returncode: int = 0):
            self.stdout = stdout
            self.returncode = returncode

    def fake_run(cmd, **kwargs):
        if "print-access-token" in cmd:
            return FakeProc("fake-cli-token\n")
        return FakeProc("demo-proj\n")

    with (
        patch("google.auth.default", side_effect=DefaultCredentialsError("missing adc")),
        patch("shutil.which", return_value="/usr/bin/gcloud"),
        patch("subprocess.run", side_effect=fake_run),
    ):
        creds, proj = get_gcp_credentials()
        assert creds.token == "fake-cli-token"
        assert proj == "demo-proj"


def test_extract_client_ip_uses_rightmost_xff_on_cloud_run(monkeypatch):
    req = types.SimpleNamespace(
        headers={"x-forwarded-for": "198.51.100.99, 203.0.113.10"},
        client=types.SimpleNamespace(host="127.0.0.1"),
    )
    monkeypatch.setattr(main, "IS_CLOUD_RUN", True)
    assert main._extract_client_ip(req) == "203.0.113.10"

    monkeypatch.setattr(main, "IS_CLOUD_RUN", False)
    assert main._extract_client_ip(req) == "198.51.100.99"


def test_dashboard_auth_token_enforcement_and_bruteforce_limit(monkeypatch):
    monkeypatch.setattr(main, "DASHBOARD_AUTH_TOKEN", "top-secret-passphrase")
    monkeypatch.setattr(main, "IS_CLOUD_RUN", True)
    main._auth_fail_buckets.clear()
    main._read_buckets.clear()

    client = TestClient(main.app)

    # /api/health remains open for load balancer / Cloud Run health probes
    health = client.get("/api/health")
    assert health.status_code == 200

    # Missing token returns 401 + Bearer challenge + no-store
    r_no_tok = client.get(
        "/api/dashboard",
        headers={"X-Requested-With": "AntigravityDashboard", "X-Forwarded-For": "198.51.100.5"},
    )
    assert r_no_tok.status_code == 401
    assert r_no_tok.headers.get("www-authenticate") == "Bearer"
    assert r_no_tok.headers.get("cache-control") == "no-store, max-age=0"

    # Brute-force 9 more wrong attempts -> total 10 failures -> 11th returns 429 pre-auth
    for _ in range(9):
        r_bad = client.get(
            "/api/dashboard",
            headers={
                "X-Requested-With": "AntigravityDashboard",
                "Authorization": "Bearer wrong-guess",
                "X-Forwarded-For": "198.51.100.5",
            },
        )
        assert r_bad.status_code == 401

    r_locked = client.get(
        "/api/dashboard",
        headers={
            "X-Requested-With": "AntigravityDashboard",
            "Authorization": "Bearer top-secret-passphrase",
            "X-Forwarded-For": "198.51.100.5",
        },
    )
    assert r_locked.status_code == 429

    # Clean IP with valid token succeeds
    with patch.object(main, "_compute_dashboard_payload", return_value={"meta": {"token_auth_enabled": True}}):
        r_ok = client.get(
            "/api/dashboard",
            headers={
                "X-Requested-With": "AntigravityDashboard",
                "Authorization": "Bearer top-secret-passphrase",
                "X-Forwarded-For": "203.0.113.42",
            },
        )
    assert r_ok.status_code == 200
    assert r_ok.json()["meta"]["token_auth_enabled"] is True
    main._auth_fail_buckets.clear()
    main._read_buckets.clear()


def test_iap_audience_rejects_foreign_project_service_name(monkeypatch):
    monkeypatch.setattr(main, "PROJECT_ID", "host-proj")
    monkeypatch.setattr(main, "PROJECT_NUMBER", "")
    monkeypatch.setattr(main, "_resolved_project_number", None)
    monkeypatch.setattr(main, "EXPLICIT_IAP_AUDIENCE", "")
    monkeypatch.setattr(main, "IS_CLOUD_RUN", False)
    monkeypatch.setattr(main, "DASHBOARD_AUTH_TOKEN", "")

    req = types.SimpleNamespace(
        url=types.SimpleNamespace(path="/api/dashboard"),
        headers={"x-goog-iap-jwt-assertion": "fake.jwt.token"},
    )
    foreign_claims = {
        "iss": "https://cloud.google.com/iap",
        "aud": f"/projects/999999999/locations/{main.REGION}/services/{main.SERVICE_NAME}",
        "email": "attacker@other.example",
    }
    with patch("backend.main.id_token.verify_token", return_value=foreign_claims):
        with pytest.raises(main.HTTPException) as exc_info:
            main.verify_iap_assertion(req)
    assert exc_info.value.status_code == 403


def test_discover_projects_filters_invalid_env_ids(monkeypatch):
    main._proj_discovery_cache = None
    monkeypatch.setattr(main, "PROJECT_ID", "host-proj")
    monkeypatch.setenv("ORG_PROJECTS", "host-proj, valid-proj-2, bad;proj, bad/proj")
    with patch("backend.main.http_requests.get", side_effect=RuntimeError("skip crm")):
        ids, _ = main.discover_accessible_projects(token="fake")
    assert ids == ["host-proj", "valid-proj-2"]
    main._proj_discovery_cache = None


def test_installer_choose_access_security_no_org_and_token_options(monkeypatch):
    mode, tok, auto = installer.choose_access_security(
        org_id="",
        explicit_access="public",
        explicit_token="",
        generate_token=True,
        no_prompt=False,
    )
    assert mode == "public"
    assert len(tok) >= 20
    assert auto is True

    mode, tok, auto = installer.choose_access_security(
        org_id="",
        explicit_access=None,
        explicit_token="custom-pass-99",
        generate_token=False,
        no_prompt=False,
    )
    assert mode == "public"
    assert tok == "custom-pass-99"
    assert auto is False

    # Interactive without org: user selects [1] Password-protected and enters custom password
    monkeypatch.setattr(installer.sys.stdin, "isatty", lambda: True)
    with (
        patch("builtins.input", return_value="1"),
        patch("scripts.install.getpass.getpass", return_value="my-secure-password"),
    ):
        mode, tok, auto = installer.choose_access_security(
            org_id="",
            explicit_access=None,
            explicit_token="",
            generate_token=False,
            no_prompt=False,
        )
    assert mode == "public"
    assert tok == "my-secure-password"
    assert auto is False

    # Interactive with explicit --access public: still offers password choice, auto-generates on empty Enter
    with (
        patch("builtins.input", return_value="1"),
        patch("scripts.install.getpass.getpass", return_value=""),
    ):
        mode, tok, auto = installer.choose_access_security(
            org_id="",
            explicit_access="public",
            explicit_token="",
            generate_token=False,
            no_prompt=False,
        )
    assert mode == "public"
    assert len(tok) >= 20
    assert auto is True

    # Interactive without org: user explicitly picks open public [2]
    with patch("builtins.input", return_value="2"):
        mode, tok, auto = installer.choose_access_security(
            org_id="",
            explicit_access=None,
            explicit_token="",
            generate_token=False,
            no_prompt=False,
        )
    assert mode == "public"
    assert tok == ""
    assert auto is False
