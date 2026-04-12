# Alpaca keys removed from repository

Security note: A file containing Alpaca API keys was found in the repository and has been removed to avoid accidental credential leakage.

What changed:
- The file `docs/Alpaca API Keys.md` has been deleted from the repository history in the workspace.

What you should do next:
- Store Alpaca API keys securely (environment variables, secrets manager, or CI secret store).
- Add keys to `backend/.env` (local only) or to your platform secret store — do NOT commit them.
- Rotate the removed keys if they have been exposed publicly.

See `backend/.env.example` and `docs/alpaca_sandbox_runbook.md` for safe usage and sandbox testing instructions.
