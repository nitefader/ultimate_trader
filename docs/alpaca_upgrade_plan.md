# Alpaca SDK Upgrade Plan

Goal: safely upgrade `alpaca-py` to a supported, tested version while preserving existing behavior.

Steps:

1. Pin current working version in `backend/requirements.txt` to the version used in CI/dev (discover via `pip show alpaca-py`).
2. Run full test suite to establish a baseline.
3. Upgrade to a target version (e.g. `pip install --upgrade "alpaca-py>=0.28.0,<1.0.0"`) in an isolated branch.
4. Run unit, integration (sandbox) and smoke tests. Fix API surface mismatches.
5. Add backward-compatible shims in `app.services.alpaca_service` if the SDK renames or changes request models.
6. Require `AlpacaLead` and `QA` signoff; run live promotion only after `SafetyOps` approval.

Notes:
- Do not promote to live until paper/sandbox tests and acceptance criteria pass.
- Keep a rollback plan (pin previous working version and a tag to revert to).
