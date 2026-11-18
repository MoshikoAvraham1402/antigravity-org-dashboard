# Contributing to Antigravity Organization Intelligence & FinOps Dashboard

Thank you for helping improve this open-source project!

## Privacy & Security Principles (Non-Negotiable)
1. **Zero Prompt or Code Exposure:** Never extract, log, persist, or render raw user prompts, code completions, conversation titles/previews, or `step_payload` protobuf fields.
2. **Parameterize All BigQuery SQL:** Never interpolate user input or filter parameters into BigQuery SQL strings. Use `bigquery.ScalarQueryParameter` and strict input validation.
3. **Zero Hardcoded Identifiers:** Never commit project IDs, organization IDs, domains, billing account IDs, or personal emails.

## Local Development Setup

### Backend
```bash
python -m venv .venv
# Linux / macOS:
source .venv/bin/activate
# Windows PowerShell:
# .venv\Scripts\Activate.ps1

pip install -r requirements-dev.txt
pytest -v
uvicorn backend.main:app --reload --port 8080
```

### Frontend
```bash
cd frontend
npm install
npm test
npm run dev
```

## Pull Request Checklist
- `pytest -v` passes with all backend and sync tests green.
- `cd frontend && npm test && npm run build` passes cleanly.
- No secrets, `.env`, or customer-specific GCP identifiers are included in the diff.
