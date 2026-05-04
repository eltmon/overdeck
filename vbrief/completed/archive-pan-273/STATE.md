# Agent State: PAN-273

## Specialist Feedback

- **[2026-02-27T01:52Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/006-review-agent-changes-requested.md`
  - All 3 blocking issues have been fixed:
    1. **Rules of Hooks violation** - Moved `useMemo(() => groupByLabels(filteredIssues))` before conditional returns (lines 942-994)
    2. **Server-side cycle filter bug** - Added `getCanonicalStatus()` function to properly map Triage/Unknown to backlog
    3. **Missing tests** - Added comprehensive tests for `groupByLabels()` and `ListIssueRow` component
- **[2026-02-27T02:06Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/007-review-agent-changes-requested.md`

## Changes Made

### 1. KanbanBoard.tsx - Rules of Hooks Fix
- Moved `groupedByLabels` useMemo hook to before the conditional early returns (issuesLoading, issuesError)
- This fixes the runtime crash that would occur due to varying hook call counts

### 2. issue-data-service.ts - Cycle Filter Fix
- Added `getCanonicalStatus()` helper function that properly maps raw status strings to canonical states
- Updated cycle filter logic to use canonical status instead of raw string comparison
- Triage, Unknown, and Backlog now correctly map to 'backlog' and are filtered properly

### 3. New Test Files
- `src/dashboard/frontend/src/components/KanbanBoard.test.tsx` - 19 tests covering:
  - `groupByLabels()`: single labels, multiple labels, uncategorized, sorting, edge cases
  - `ListIssueRow`: rendering, priority display, agent indicators, specialist counts, costs, click handlers
- `tests/dashboard/issue-data-service.test.ts` - 9 tests covering:
  - Canonical status mapping for Backlog, Triage, Unknown
  - Current cycle filter (excludes backlog items)
  - Backlog view filter (includes only backlog items)
  - Case-insensitive matching
  - Various todo and planning states

## Status
- All new tests passing (28 total new tests)
- Ready for review resubmission
