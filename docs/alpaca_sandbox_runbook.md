# Alpaca Sandbox Runbook (paper environment)

Purpose: quick steps to validate Alpaca sandbox credentials and run safe integration checks.

1) Prepare environment (local dev):

  - Create `backend/.env` from `backend/.env.example` and fill `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` with your paper (sandbox) credentials.
  - Activate your Python virtual environment and install dependencies:

```powershell
& ".\.venv\Scripts\Activate.ps1"
cd backend
pip install -r requirements.txt
```

2) Validate credentials via small script (from repo root):

```powershell
cd backend
setx ALPACA_API_KEY "<your_key>"
setx ALPACA_SECRET_KEY "<your_secret>"
setx ALPACA_BASE_URL "https://paper-api.alpaca.markets"
python -c "import os; from app.services.alpaca_service import validate_credentials; print(validate_credentials(os.environ.get('ALPACA_API_KEY'), os.environ.get('ALPACA_SECRET_KEY'), os.environ.get('ALPACA_BASE_URL')) )"
```

3) API-based validation (optional):

- You can use the existing route that validates account credentials: `POST /accounts/{account_id}/credentials/validate` from the backend API. Ensure your account record exists and contains encrypted credentials before calling the route.

4) Sandbox best practices:

- Use paper keys only for development/testing; never use live keys in local dev or CI.
- If a key may have been exposed, rotate it immediately from the Alpaca dashboard.
- Keep paper and live keys separate and never share them in PRs, issue trackers, or docs.

5) Running integration tests against sandbox (optional):

- Tests that hit the sandbox should be gated and only run when `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` are set as environment variables in the runner. See `backend/tests/test_alpaca_sandbox_validate.py` for an example that will skip if env vars are not present.
