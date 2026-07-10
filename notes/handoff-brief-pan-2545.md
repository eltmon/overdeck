# Brief: implement PAN-2545 directly on main (operator-authorized bypass)

Read https://github.com/eltmon/overdeck/issues/2545 INCLUDING ALL COMMENTS first — they carry the incident audit and two scope additions (freeze-bypass gap, watchdog `spawn pan ENOENT`).

## Mode
- You work **directly on the primary `main` worktree** (`/home/eltmon/Projects/overdeck`). This is explicitly operator-directed (2026-07-09) because the change hardens the supervisor/deacon machinery itself. Do NOT create a feature branch; do NOT run `pan done`; do NOT open a PR.
- Commit early and often, one coherent unit per commit, **path-scoped** (`git commit -- <files>`), never `--amend`, never `git stash`. Other agents share this worktree.
- The deacon is globally frozen and must stay frozen. NEVER restart the dashboard, the supervisor, or any server — the operator handles restarts. Your changes are code + tests only; runtime verification of the watchdog happens after an operator-driven restart.

## The five fixes (all required — single delivery)
1. **Identity-gate the escape hatch**: `OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY=1` must refuse to bind primary mode when `OVERDECK_AGENT_ID` matches a pipeline-role id (`agent-*`, `planning-*`, `flywheel-*`); mirror the identity logic in `scripts/guard-agent-main-push.sh` (conv-* and no-agent-id remain allowed). Loud, actionable refusal message.
2. **Watchdog evict-or-escalate**: when the port is held by a server whose `/api/health` reports a `repoRoot` outside the primary checkout (or `mode !== 'primary'` expectations fail), the watchdog must evict it (SIGTERM the holder PID after verifying via health probe) and restart the real primary — or, if eviction is disabled/fails, emit a needs-you escalation. Never "give up" with only a log line.
3. **Fix watchdog restart exec**: `spawn pan ENOENT` — the watchdog shells `pan` bare; resolve an absolute binary path (or invoke `node dist/dashboard/server.js` directly) so its restart actually executes in daemon environments without the user PATH.
4. **Freeze gates orphan adoption**: the deacon's orphan-adoption/auto-resume path ("Auto-resumed <agent> (was orphaned by system event)") must respect `deacon.globally_paused` — a frozen deacon adopts nothing. Find the reconciler that bypassed it (see issue comment evidence) and route it through the same global-pause gate as patrols.
5. **Role prohibition**: `roles/test.md` (and work/review if absent) gains an explicit rule: never start/stop/restart host-level dashboard or supervisor processes; verification targets the workspace's own containers (`api-feature-<issue>.pan.localhost`). Belt-and-suspenders to fix #1.

## Repo rules that intersect (do not skip)
- Fake timers (`vi.useFakeTimers()` + `advanceTimersByTimeAsync`) for any retry/delay test; never real timers.
- No `execSync` in server-reachable code; async only.
- Never spawn agents; never run `pan up`/`pan restart`/`pan tell`.
- Quality gates before you declare done: `npm run typecheck && npm run lint && npm test` — all green, no new failures.
- Every fix ships with a named regression test (identity-gate refusal, watchdog evict fixture, ENOENT-proof exec resolution, frozen-deacon-adopts-nothing, roles-lint).

## Done means
All five fixes implemented + tested + committed on main (NOT pushed — the operator reviews and pushes), then reply in this conversation with a summary listing each fix's commit SHA and test name. If any fix requires a design decision not covered here, STOP and ask in this conversation instead of guessing.
