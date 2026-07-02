# Incident: complete-planning race + bead thrash during PAN-2153 re-finalize (2026-07-02)

Observed while re-finalizing planning for PAN-2153. GitHub API was rate-limited at
write-up time, so these need to be filed as issues when the limit resets.

## Bug 1 — complete-planning is not serialized or idempotent per issue

`POST /api/issues/:id/complete-planning` (src/dashboard/server/routes/issues.ts:1289)
has no per-issue in-flight guard. Two concurrent executions for the same issue:

1. **Race on the canonical spec atomic write.** Both run `completePlanningArtifacts`,
   both write `<spec>.vbrief.json.tmp` then rename; the loser's rename throws
   `PlatformError: NotFound: FileSystem.rename (...vbrief.json.tmp)` → unhandled
   FsError → HTTP 500. Seen repeatedly in `~/.overdeck/logs/dashboard.log`
   (search "Unhandled error on POST /api/issues/PAN-2153/complete-planning").
2. **Bead thrash via delete-all-recreate.** Each execution clears and recreates the
   issue's beads. Overlapping executions produced live transient states of 2, 1,
   then back to 3 beads for pan-2153 (observed 2026-07-02 ~15:49-15:55 local).
   A work agent starting mid-window would see missing beads.

Fix shape: reuse the `createInFlightGuard()` pattern already protecting
`firePostMergeLifecycle` (src/lib/cloister/in-flight-guard.ts) keyed by issue id.

## Bug 2 — unidentified duplicate caller fires complete-planning (skipKill=true) twice every ~2 min

While the planning session `planning-pan-2153` survived, PAIRS of
`[complete-planning] CALLED for PAN-2153 (skipKill=true)` landed every ~2 minutes
(19+ total calls). `skipKill: true` appears in exactly one src call site —
`PlanDialog.tsx:388` (`stopPlanningMutation`) — but that is click-driven and its
preceding `DELETE /api/planning/:id` would have killed the tmux session, which
stayed alive. So either the DELETE fails silently and something retries the pair,
or another caller exists. Because skipKill=true never kills the session, the
trigger condition persists → PAN-682-style perpetual loop.

## Bug 3 — CLI promotePlanning 90s abort vs handler runtime

`promotePlanning` (src/cli/commands/plan-finalize.ts) aborts at 90s and reports
failure, but the handler legitimately runs longer under bd-process-lock contention
(bead materialization held the global lock: `~/.overdeck/locks/bd-*.lock`,
caller "create beads from vBRIEF"). Server-side work completes AFTER the CLI
gives up → operator sees ✖ Failed while the promotion actually landed, and the
deferred session kill (post-response-flush) may never fire for the aborted request.
`pan plan finalize` for PAN-2153 hit exactly this: beads + spec landed, CLI exited 1.

## Bug 4 — recurring `[pan-dir/auto-commit] failed for main: Cause([Fail(GitError)])`

Fires continuously in dashboard.log. Main worktree has a half-staged file:
`MM .pan/specs/2026-07-02-PAN-2151-...vbrief.json` (PAN-2151, the sibling planning
issue the briefing flagged as blocked). Likely the auto-commit chokes on it; this
also plausibly explains why the project-level continue mirror for pan-2153
(`.pan/continues/pan-2153.vbrief.json`) never appeared on main.

## Environment notes

- Dashboard restarted 5x via systemd-user SIGTERM during the window; one restart
  killed a complete-planning handler mid-flight.
- The three long-lived extra `dist/dashboard/server.js` processes are workspace
  Docker container peers (containerd-shim parents) — not dueling hosts.
- Session env `DASHBOARD_URL=https://overdeck.localhost` failed (fetch failed/502);
  `OVERDECK_DASHBOARD_URL=http://localhost:3011` reached the server.
