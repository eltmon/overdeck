# PAN-569: Bulk-Close Issues from Kanban Board

## Status: In Progress

## Current Phase
Implementing bead pan-569-2tt (useBulkSelection hook) — foundational frontend multi-select state management.

## Completed Work
- [x] pan-569-2tt: Created useBulkSelection hook (commit: 1faa8d57)
- [x] pan-569-gsj: Added POST /api/issues/bulk-close-out endpoint (commit: 4d5c77c4)
- [x] pan-569-eww: Added selection checkbox and selected styling to IssueCard (commit: ed884a93)
- [x] pan-569-fqr: Created floating BulkActionBar component (commit: 3f27794b)
- [x] pan-569-hsw: Added select-all checkbox to kanban column headers (commit: 1d6f5125)
- [x] pan-569-1wb: Created BulkAgentWarningDialog component (commit: f65f2f9a)
- [x] pan-569-7ce: Created BulkCloseOutProgress modal component (commit: f03c0f3c)
- [x] pan-569-qly: Wired bulk close-out mutation into KanbanBoard (commit: 24a3d107)
- [x] pan-569-kl3: Added selection checkboxes to list view rows (commit: fe126e50)

## Remaining Work
None — all beads implemented.

## Current Phase
Implementation complete. Waiting for inspections and tests to pass.

## Key Decisions
- (from plan) Close action runs full closeOut lifecycle per issue, not lightweight status move
- (from plan) Sequential execution since each closeOut touches filesystem/git
- (from plan) Reuse existing issue.statusChanged events, no new bulk event type

## Key Decisions
- (from plan) Close action runs full closeOut lifecycle per issue, not lightweight status move
- (from plan) Sequential execution since each closeOut touches filesystem/git
- (from plan) Reuse existing issue.statusChanged events, no new bulk event type

## Specialist Feedback
- None currently
- **[2026-04-22T19:58Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
- **[2026-04-22T20:06Z] verification-gate → FAILED** — `.planning/feedback/004-verification-gate-failed.md`
- **[2026-04-22T20:18Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-04-22T20:31Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`

## Problem

Closing issues on the kanban board is one-at-a-time. Sprint cleanup with 10+ done issues is tedious.

## Decisions

1. **Close action: close-out lifecycle** — Bulk close runs `closeOut()` per issue (full lifecycle: verify merge, archive planning, teardown workspace, close on tracker, clear review status). Not a lightweight status move.

2. **Scope: close/done only** — No generic bulk status transitions. The action bar has a single "Close Out" action. Other transitions are a follow-up.

3. **Select-all: included** — Column header checkbox selects all visible issues in that column.

4. **Endpoint: `POST /api/issues/bulk-close-out`** — Deviates from the issue spec's `bulk-move-status` name because we're running close-out lifecycle, not a generic status move. Sequential execution (not parallel) since each closeOut touches filesystem/git.

5. **Event emission: reuse per-issue events** — Each closeOut already emits `issue.statusChanged`. No new bulk event type needed. Existing reducers handle it unchanged.

6. **Active-agent guardrail: warn and let user choose** — If any selected issues have running agents, show a warning dialog listing them. User can proceed (skips those) or cancel. This mirrors the existing single-issue AgentWarningDialog pattern.

7. **Execution model: sequential with progress** — closeOut is heavy (filesystem, git, tracker API). Run sequentially. Show a progress modal with per-issue status (pending/running/done/failed/skipped).

8. **Frontend architecture** — Extract `useBulkSelection` hook (not inline in 3373-line KanbanBoard.tsx). Floating action bar as a separate component.

## Architecture

### Backend

New route in `src/dashboard/server/routes/issues.ts`:
```
POST /api/issues/bulk-close-out
Body: { issueIds: string[] }
Response: { results: Array<{ issueId: string, success: boolean, error?: string, skipped?: boolean }> }
```

Iterates issueIds sequentially, calling `closeOut(ctx)` for each. Emits per-issue `issue.statusChanged` events (already done by existing close-out route logic). Returns aggregated results.

### Frontend

- `useBulkSelection(issues)` hook — manages `Set<string>` of selected issue IDs, provides toggle/selectAll/clear
- Checkbox on each `IssueCard` (top-left corner, visible in selection mode)
- Column header checkbox for select-all per column
- `BulkActionBar` floating component at bottom — "N selected", "Close Out", "Cancel"
- Confirmation dialog with active-agent warning if applicable
- Progress modal during execution showing per-issue status

### Key Files Modified

| File | Change |
|------|--------|
| `src/dashboard/server/routes/issues.ts` | New `POST /api/issues/bulk-close-out` endpoint |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Wire useBulkSelection, render BulkActionBar, column select-all |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` (IssueCard) | Add checkbox + selected styling |
| `src/dashboard/frontend/src/hooks/useBulkSelection.ts` | New hook for multi-select state |
| `src/dashboard/frontend/src/components/BulkActionBar.tsx` | New floating action bar component |

### No New Event Types

Reuse existing `issue.statusChanged` emitted per-issue by closeOut. No changes to `packages/contracts/src/events.ts` or `event-reducers.ts`.

## Browser Verification

Playwright/browser verification should use an isolated browser instance. Test:
1. Select multiple issues via checkboxes
2. Use select-all on a column
3. Click Close Out, confirm dialog
4. Verify issues move to done column
5. Verify active-agent warning appears when applicable
