# PAN-946: Adopt deft vBRIEF Lifecycle Model for Scope vBRIEFs

## Status: Complete

## Current Phase
All beads complete. Ready for verification and merge.

## Completed Work
- [x] workspace-0k8: vBRIEF lifecycle foundation — types, filename convention, directory helpers in `src/lib/vbrief/lifecycle.ts` with 14 unit tests (commit 7ae8315fa)
- [x] workspace-8tz: Continue state module — `src/lib/vbrief/continue-state.ts` with ContinueState type, writeContinueState, readContinueState, appendSessionEntry. 13 unit tests passing (commit 214a0fbf0)
- [x] workspace-2gb: vBRIEF lifecycle IO — `src/lib/vbrief/lifecycle-io.ts` with findVBriefByIssue, moveVBrief (async, git-staging), moveVBriefFilesOnly (sync), updatePlanStatus, deleteVBrief. 16 unit tests passing.
- [x] workspace-9y5: plan-finalize stamps proposed status + canonical filename — added typed `metadata.canonicalFilename` to VBriefPlan; new `stampPlanForFinalization()` exports preserves existing canonical filename so date stays immutable across re-finalizations. 9 unit tests passing.
- [x] workspace-q1e: Replaced `.planning-complete` marker reads with `plan.status` checks. Added `isPlanningProposed()` (strict, gates Done button) and `isPlanningComplete()` (broad, gates "tasks generated") helpers in `src/lib/vbrief/io.ts`, both with legacy marker fallback for vBRIEFs without status fields. Updated 4 read sites (misc.ts, agents.ts, issues.ts, issue-data-service.ts). 39 io.test.ts tests passing (13 new for the helpers).
- [x] workspace-b2q: complete-planning endpoint promotes vBRIEF to ./vbrief/proposed/ on main. Extracted `promoteVBriefToProposed()` to `src/lib/vbrief/lifecycle-io.ts`. Removed old `docs/prds/active/` copy step for plan artifacts (PRD discovery from `docs/prds/planned/` retained). Path-scoped commit `scope: propose <ID> vBRIEF` only when project root is on main. 24 lifecycle-io tests passing (8 new for promote).
- [x] workspace-tq9: Approval transition wired into start-agent flow. Added `transitionVBriefOnMain()` to `src/lib/vbrief/lifecycle-io.ts` — generic helper for moving a vBRIEF between lifecycle dirs on main, updating `plan.status`, and committing with a custom message. Idempotent (no commit if already in target dir with target status), branch-aware (only commits when projectRoot is on main). Called from POST /api/agents flow with `scope: approve PAN-XXX vBRIEF`. 30 lifecycle-io tests passing (6 new for the transition helper).
- [x] workspace-3pq: Set plan.status to running on pan start. After the approval transition on main, `updatePlanStatus(planPath, 'running')` is called on the workspace's `.planning/plan.vbrief.json` before the agent spawns. Sequence incremented and timestamps refreshed. Non-fatal — agent starts even if the update fails.
- [x] workspace-qe9: Post-merge transition in `postMergeLifecycle` (merge-agent.ts) — `transitionVBriefOnMain()` moves vBRIEF from active/ to completed/ on main with `scope: complete <ID> vBRIEF` commit. Handles both move + continue file + status update. Non-fatal.
- [x] workspace-bdc: Close/cancel transition in `runDestructiveIssueLifecycle` (issues.ts) — `transitionVBriefOnMain()` moves vBRIEF to cancelled/ on main with `scope: cancel <ID> vBRIEF` commit when mode='cancel'. Non-fatal.
- [x] workspace-57b: Dashboard plan endpoint GET /api/workspaces/:issueId/plan now uses `findVBriefByIssue()` to resolve from lifecycle dirs first, falling back to workspace `.planning/plan.vbrief.json` for in-progress planning. Response includes `lifecycleDir` field.
- [x] workspace-0ka: `findPlan()` in `src/lib/vbrief/io.ts` now checks lifecycle dirs on the project root (via `findVBriefByIssue`) before falling back to workspace `.planning/plan.vbrief.json`. `readWorkspacePlan()` inherits this transparently since it calls `findPlan()`. All callers (task-readiness, beads sync, work-agent-prompt, etc.) work without modification.
- [x] workspace-7il: `pan scope` command group skeleton — `src/cli/commands/scope.ts` exports `registerScopeCommands()` following the admin command pattern. Registered in `src/cli/index.ts`.
- [x] workspace-czx: `pan scope list` — scans all lifecycle dirs (`proposed/`, `active/`, `completed/`, `cancelled/`) and prints issue ID, title, status, and lifecycle directory. Groups by lifecycle dir.
- [x] workspace-5a0: `pan scope show <issueId>` — uses `findVBriefByIssue()` to resolve a vBRIEF, displays title, lifecycle dir, status, sequence, file path, and item count.
- [x] workspace-1u5: `pan scope propose <issueId>` — manual override to move vBRIEF to `proposed/` and set `plan.status` to `proposed`. Commits on main via `transitionVBriefOnMain()`.
- [x] workspace-waf: `pan scope approve <issueId>` — manual override to move vBRIEF to `active/` and set `plan.status` to `approved`. Commits on main via `transitionVBriefOnMain()`.
- [x] workspace-7zx: `pan scope complete <issueId>` — manual override to move vBRIEF to `completed/` and set `plan.status` to `completed`. Commits on main via `transitionVBriefOnMain()`.
- [x] workspace-7nz: `pan scope cancel <issueId>` — manual override to move vBRIEF to `cancelled/` and set `plan.status` to `cancelled`. Commits on main via `transitionVBriefOnMain()`.
- [x] workspace-cho: `pan scope restore <issueId>` — restores vBRIEF from `completed/` or `cancelled/` back to `active/` and sets `plan.status` to `approved`. Commits on main via `transitionVBriefOnMain()`.
- [x] workspace-ujl: Planning prompt updated — `src/lib/cloister/prompts/planning.md` instructs agents to write `.planning/continue-{issueId}.vbrief.json` instead of `STATE.md`. Removed obsolete `docs/prds/active/` copy instruction. Added continue.vbrief.json JSON format template. `spawn-planning-session.ts` clears stale continue files on session start.
- [x] workspace-61m: Work agent prompt updated — `src/lib/cloister/prompts/work.md` instructs agents to read `./vbrief/active/continue-{issue}.vbrief.json` for planning context. Bead workflow updated to update continue file instead of STATE.md. `work-agent-prompt.ts` reads continue file from lifecycle dirs first, falling back to workspace `.planning/` and finally `STATE.md` (legacy). `getTrackerContext` uses continue file mtime for comment filtering.

- [x] workspace-475: Removed primary STATE.md dependencies across the codebase. Dashboard routes (workspaces, issues, agents, misc, command-deck, projects, resource-discovery) now read continue files first with legacy STATE.md fallback during transition. Lifecycle code (clean-planning, archive-planning) updated to handle continue files. docs/VBRIEF.md documents continue.vbrief.json as the replacement for STATE.md.
- [x] workspace-44p: Agent session continue state integration — start-agent route writes initial continue state (git branch, sha, agent model) to `./vbrief/active/continue-{issue}.vbrief.json`. `pan work done` appends 'end' session entry. `resumeAgent` appends 'resume' session entry with agent model.
- [x] workspace-9ny: `pan sync` vBRIEF state disagreement detection — three checks: active vBRIEF but GitHub closed, completed vBRIEF but workspace exists, workspace exists but no active vBRIEF. Prints suggested `pan scope` fix commands.

## Key Decisions
- **D1**: Filename regex requires `[A-Za-z][A-Za-z0-9]*-\d+` for issue IDs so prefixes like `PAN`, `MIN`, `KRUX` all match. Slug uses `[a-z0-9-]+`. Dates always interpreted as UTC so filenames are stable across timezones.
- **D2**: `slugify()` returns `'plan'` for empty/all-special input rather than throwing — keeps planning agents from blowing up on edge-case titles.
- **D3**: New module `src/lib/vbrief/lifecycle.ts` (separate from existing `io.ts`) so the existing in-workspace plan IO stays untouched until the migration beads land.

## Specialist Feedback
(none yet)
- **[2026-05-03T16:34Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-05-03T16:35Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-05-03T16:37Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
- **[2026-05-03T16:41Z] verification-gate → FAILED** — `.planning/feedback/004-verification-gate-failed.md`
- **[2026-05-03T16:53Z] verification-gate → FAILED** — `.planning/feedback/005-verification-gate-failed.md`
- **[2026-05-03T16:57Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-05-03T16:57Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-05-03T17:01Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
- **[2026-05-03T17:12Z] verification-gate → FAILED** — `.planning/feedback/004-verification-gate-failed.md`
- **[2026-05-03T17:13Z] verification-gate → FAILED** — `.planning/feedback/005-verification-gate-failed.md`
- **[2026-05-03T17:21Z] verification-gate → FAILED** — `.planning/feedback/006-verification-gate-failed.md`
- **[2026-05-03T17:23Z] verification-gate → FAILED** — `.planning/feedback/007-verification-gate-failed.md`
- **[2026-05-03T17:26Z] verification-gate → FAILED** — `.planning/feedback/008-verification-gate-failed.md`
- **[2026-05-03T17:30Z] verification-gate → FAILED** — `.planning/feedback/009-verification-gate-failed.md`
- **[2026-05-03T17:33Z] verification-gate → FAILED** — `.planning/feedback/010-verification-gate-failed.md`
