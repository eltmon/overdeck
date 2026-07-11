---
issue: PAN-2388
---

### Live Cost Reconcile Verification

This runbook verifies the same path covered by
`src/lib/overdeck/__tests__/cost-reconcile-harnesses.integration.test.ts` against
the operator's live dashboard.

1. Build and boot the dashboard normally. For boot-path changes, use a
   throwaway instance first; do not hot-patch the live server.
2. Reconcile Codex and oh-my-pi sessions:
   `curl -sS -X POST https://pan.localhost/api/costs/reconcile`
3. Open the per-issue drill:
   `curl -sS https://pan.localhost/api/costs/issue/PAN-2383`
4. Expected result: the response includes non-zero total spend and both `codex`
   and `ohmypi` stage entries for real model ids.
5. Re-run steps 2 and 3. Expected result: reconcile returns `imported: 0` for
   both harnesses after the first import for already-seen session events.

Observed in this workspace: live-server verification is operator-deferred. This
slot added the integration test and did not restart the live dashboard.
