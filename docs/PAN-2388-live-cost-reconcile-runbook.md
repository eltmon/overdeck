# PAN-2388 live cost reconcile runbook

This is the operator check for the live dashboard after the PAN-2388 parser and reconciler changes have been built and the dashboard has been restarted through the normal restart path.

1. Reconcile historical transcript costs:

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/api/costs/reconcile \
     -H 'content-type: application/json' \
     -d '{}'
   ```

2. Read the per-issue drill:

   ```bash
   curl -sS http://127.0.0.1:3000/api/costs/issue/PAN-2383
   ```

3. Confirm the issue response includes non-zero codex and ohmypi model rows, and review any `skipped` entries returned by the reconcile response.

Live-server verification is operator-deferred for this bead. The implementation was verified with an isolated temp `OVERDECK_HOME` and temp SQLite database; no live dashboard restart was performed from this work agent.
