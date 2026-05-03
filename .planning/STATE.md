# PAN-946: Adopt deft vBRIEF Lifecycle Model for Scope vBRIEFs

## Status: In Progress

## Current Phase
Foundation modules done. Next: workspace-2gb (vBRIEF lifecycle IO — find by issue, move between dirs).

## Completed Work
- [x] workspace-0k8: vBRIEF lifecycle foundation — types, filename convention, directory helpers in `src/lib/vbrief/lifecycle.ts` with 14 unit tests (commit 7ae8315fa)
- [x] workspace-8tz: Continue state module — `src/lib/vbrief/continue-state.ts` with ContinueState type, writeContinueState, readContinueState, appendSessionEntry. 13 unit tests passing.

## Remaining Work
- [ ] workspace-2gb: vBRIEF lifecycle IO — find by issue, move between dirs, update status
- [ ] workspace-9y5: Update plan-finalize to set proposed status and generate canonical filename
- [ ] workspace-b2q: Update complete-planning to copy vBRIEF to main's ./vbrief/proposed/
- [ ] workspace-q1e: Replace .planning-complete marker with plan.status check
- [ ] workspace-tq9: Approval transition — move vBRIEF from proposed/ to active/ on main
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
