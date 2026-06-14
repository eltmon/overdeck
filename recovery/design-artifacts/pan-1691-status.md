## Implementation status — foundation landed on `main` (2026-06-09)

**Landed** (commits `d4c830063`, `ab74470ec` on `main`, fast-forward, build/typecheck/lint/tests green):
- `autoMerge?: boolean` routing key on `ReviewStatus` — tri-state: `undefined` = project default, `true` = auto-merge (fast lane), `false` = hold for UAT (manual lane). Persisted via schema **v50** migration. Round-trip tested.
- `setAutoMerge` helper + `POST /api/workspaces/:id/auto-merge` endpoint, emitting `status_changed` for live dashboard sync.
- `autoMerge` threaded through the `ReviewStatusSnapshot` contract + read-model.

**Not yet implemented** — the merge-critical engine, deliberately *not* rushed solo overnight on a shared `main`:
- Conflict-aware ordering: make `computeMergeQueue` actually **drive** the executor (today it's display-only, sorts by issue number).
- Rolling auto-rebase-onto-updated-main + re-verify loop.
- On-demand UAT-candidate branch assembly + "merge next N".

Because that engine is the part that actually fixes the rebase-cascade, the subsumed bugs — PAN-1240, PAN-1215, PAN-1213, PAN-1658 — remain **OPEN**. They are not resolved by the foundation alone, so I did not close them.
