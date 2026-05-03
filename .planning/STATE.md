# PAN-946: Adopt deft vBRIEF Lifecycle Model for Scope vBRIEFs

## Status: In Progress

## Current Phase
Approval transition wired into start-agent flow. Next: workspace-3pq (set plan.status to running on pan start).

## Completed Work
- [x] workspace-0k8: vBRIEF lifecycle foundation — types, filename convention, directory helpers in `src/lib/vbrief/lifecycle.ts` with 14 unit tests (commit 7ae8315fa)
- [x] workspace-8tz: Continue state module — `src/lib/vbrief/continue-state.ts` with ContinueState type, writeContinueState, readContinueState, appendSessionEntry. 13 unit tests passing (commit 214a0fbf0)
- [x] workspace-2gb: vBRIEF lifecycle IO — `src/lib/vbrief/lifecycle-io.ts` with findVBriefByIssue, moveVBrief (async, git-staging), moveVBriefFilesOnly (sync), updatePlanStatus, deleteVBrief. 16 unit tests passing.
- [x] workspace-9y5: plan-finalize stamps proposed status + canonical filename — added typed `metadata.canonicalFilename` to VBriefPlan; new `stampPlanForFinalization()` exports preserves existing canonical filename so date stays immutable across re-finalizations. 9 unit tests passing.
- [x] workspace-q1e: Replaced `.planning-complete` marker reads with `plan.status` checks. Added `isPlanningProposed()` (strict, gates Done button) and `isPlanningComplete()` (broad, gates "tasks generated") helpers in `src/lib/vbrief/io.ts`, both with legacy marker fallback for vBRIEFs without status fields. Updated 4 read sites (misc.ts, agents.ts, issues.ts, issue-data-service.ts). 39 io.test.ts tests passing (13 new for the helpers).
- [x] workspace-b2q: complete-planning endpoint promotes vBRIEF to ./vbrief/proposed/ on main. Extracted `promoteVBriefToProposed()` to `src/lib/vbrief/lifecycle-io.ts`. Removed old `docs/prds/active/` copy step for plan artifacts (PRD discovery from `docs/prds/planned/` retained). Path-scoped commit `scope: propose <ID> vBRIEF` only when project root is on main. 24 lifecycle-io tests passing (8 new for promote).
- [x] workspace-tq9: Approval transition wired into start-agent flow. Added `transitionVBriefOnMain()` to `src/lib/vbrief/lifecycle-io.ts` — generic helper for moving a vBRIEF between lifecycle dirs on main, updating `plan.status`, and committing with a custom message. Idempotent (no commit if already in target dir with target status), branch-aware (only commits when projectRoot is on main). Called from POST /api/agents flow with `scope: approve PAN-XXX vBRIEF`. 30 lifecycle-io tests passing (6 new for the transition helper).

## Remaining Work
- [ ] workspace-3pq: Set plan.status to running on pan start
- [ ] workspace-44p: Write/update continue.vbrief.json during agent sessions
- [ ] workspace-qe9: Post-merge — move vBRIEF from active/ to completed/ on main
- [ ] workspace-bdc: Close/cancel — move vBRIEF to cancelled/ on main
- [ ] workspace-0ka: Update workspace plan resolution to read from ./vbrief/active/
- [ ] workspace-57b: Update dashboard plan endpoint to resolve from lifecycle dirs
- [ ] workspace-ujl: Update planning prompt to write continue.vbrief.json instead of STATE.md
- [ ] workspace-61m: Update work agent to read continue.vbrief.json for context
- [ ] workspace-475: Remove all STATE.md references from codebase
- [ ] workspace-7il: Create pan scope command group skeleton
- [ ] workspace-czx: pan scope list — show all vBRIEFs with lifecycle status
- [ ] workspace-5a0: pan scope show <issue> — display plan details
- [ ] workspace-1u5: pan scope propose <issue> — manual move to proposed/
- [ ] workspace-waf: pan scope approve <issue> — manual move to active/
- [ ] workspace-7zx: pan scope complete <issue> — manual move to completed/
- [ ] workspace-7nz: pan scope cancel <issue> — manual move to cancelled/
- [ ] workspace-cho: pan scope restore <issue> — restore from completed/cancelled to active/
- [ ] workspace-9ny: Extend pan sync with vBRIEF state disagreement detection

## Key Decisions
- **D1**: Filename regex requires `[A-Za-z][A-Za-z0-9]*-\d+` for issue IDs so prefixes like `PAN`, `MIN`, `KRUX` all match. Slug uses `[a-z0-9-]+`. Dates always interpreted as UTC so filenames are stable across timezones.
- **D2**: `slugify()` returns `'plan'` for empty/all-special input rather than throwing — keeps planning agents from blowing up on edge-case titles.
- **D3**: New module `src/lib/vbrief/lifecycle.ts` (separate from existing `io.ts`) so the existing in-workspace plan IO stays untouched until the migration beads land.

## Specialist Feedback
(none yet)
