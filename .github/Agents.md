Important working rules for this repo:
- Do not fabricate behavior or leave TODO placeholders.
- Do not say a workflow is async unless it truly runs outside the request-response path.
- Do not say events are audited unless they are durably persisted and retrievable from the database.
- Do not say a deployment is promoted unless the state is committed and visible after reload.
- Prefer small coherent changes over broad rewrites.
- After each implementation step, run relevant tests and report exact results.
- If you discover product contradictions, fix the code to match the PRD and explain the change.