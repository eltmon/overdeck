# PAN-1257 specialist role-population audit

Result: no gaps found, all specialist spawn paths populate role.

## Common writer

- `src/lib/agents.ts:2467-2482` is the common `spawnRun(issueId, role, options)` state writer for non-work role runs. It constructs the initial `AgentState` with `role` and immediately persists it through `saveAgentState(state)`. Review, review sub-roles, test, and ship all enter through this writer, so their initial `state.json` files include `role`.

## Review writers

- `src/lib/cloister/review-agent.ts:506-518` spawns the review synthesis role with `spawnRun(opts.issueId, 'review', ...)`, then persists review metadata on the returned state. The initial `state.json` is written by `spawnRun` with `role: 'review'`, and the later save preserves that role.
- `src/lib/cloister/review-agent.ts:311-327` spawns each review sub-role with `spawnRun(opts.issueId, 'review', { subRole: opts.subRole, ... })`, then adds `reviewSubRole`, `reviewRunId`, output path, synthesis agent id, and deadline before saving again. The initial `state.json` is written with `role: 'review'`; sub-role identity is stored separately in `reviewSubRole`.
- Covered review sub-role values include `correctness`, `security`, `performance`, and `requirements`, producing sessions such as `agent-<issue>-review-correctness` and `agent-<issue>-review-security` while retaining `role: 'review'`.

## Test writers

- `src/lib/cloister/test-agent-queue.ts:76-80` dispatches the Promise test path with `spawnRun(issueId, 'test', { workspace, prompt })`, so the initial `state.json` includes `role: 'test'`.
- `src/lib/cloister/test-agent-queue.ts:160-164` dispatches the Effect test path with `spawnRun(issueId, 'test', { workspace, prompt })`, so the initial `state.json` includes `role: 'test'`.
- `src/dashboard/server/routes/workspaces.ts:3863-3867` handles manual test re-dispatch after review approval with `spawnRun(issueId, 'test', { workspace })`, so the initial `state.json` includes `role: 'test'`.
- `src/lib/cloister/deacon.ts:1771-1775` re-dispatches orphaned tests with `spawnRun(issueId, 'test', { workspace, prompt })`, so the initial `state.json` includes `role: 'test'`.
- `src/lib/cloister/deacon.ts:1948-1954` retries failed tests with `spawnRun(issueId, 'test', { workspace, prompt })`, so the initial `state.json` includes `role: 'test'`.

## Ship writer

- `src/lib/cloister/merge-agent.ts:1116-1128` starts the ship role with `spawnRun(options.issueId, 'ship', { workspace, prompt, allowHost: true })`, so the initial `state.json` includes `role: 'ship'`.

## Conclusion

No separate follow-up issue is needed. The audit found no specialist `state.json` writer that bypasses `spawnRun` or omits the role field during initial state creation. This bead made no silent patches to state writers or `saveAgentState` call sites.
