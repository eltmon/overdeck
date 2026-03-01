# PAN-288: Dashboard - Separate Canceled Issues from Done

## Status: COMPLETE - Ready for Merge

## Issue
Canceled issues (Canceled, Duplicate, Won't Do) are currently lumped into the Done column on the kanban board. This makes Done misleading.

## Solution
Treat canceled issues like Backlog issues: give them their own filter view and exclude them from the kanban board.

## Tasks

- [x] **Task 1**: Stop groupByStatus from pushing canceled into Done (panopticon-h1l3) - DONE
- [x] **Task 2**: Add canceled cycle filter to server-side getIssues (panopticon-rt1k) - DONE
- [x] **Task 3**: Add Canceled button to cycle filter bar and canceled list view (panopticon-tr1z) - DONE

## Implementation Plan

### Changes Overview

1. **KanbanBoard.tsx**:
   - Update `CycleFilter` type to include 'canceled'
   - Add 'canceled' button to cycle filter UI
   - Modify `groupByStatus` to skip canceled issues (like backlog)
   - Add `groupByStatus` function to group canceled issues by status (canceled/duplicate/won't do)
   - Add conditional rendering for 'canceled' view (similar to backlog view)
   - Add dimmed/strikethrough styling for canceled issues in ListIssueRow

2. **issue-data-service.ts**:
   - Add 'canceled' case to getIssues cycle filter

3. **types.ts**: No changes needed - 'canceled' already exists in CanonicalState

## Acceptance Criteria

- [ ] Canceled issues no longer appear in the Done column
- [ ] New "Canceled" filter option in the cycle filter bar (next to Current/All/Backlog)
- [ ] Canceled view shows issues in a list with dimmed/strikethrough styling
- [ ] "Include closed-out" toggle does NOT resurface canceled issues in Done
- [ ] Existing Done column only shows truly completed issues

## Specialist Feedback

- **[2026-03-01T16:32Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/016-review-agent-changes-requested.md`
  - Issue: Missing tests for `groupByCanceledType()` function
  - Fixed: Added 8 comprehensive test cases covering all status variants

- **[2026-03-01T16:35Z] review-agent → PASSED** — All code and tests approved

- **[2026-03-01T16:37Z] test-agent → PASSED** — Zero new regressions, 1358 tests pass
  - 14 pre-existing failures on main (migration.test.ts, session-rotation.test.ts, skills-merge.test.ts)
  - All PAN-288 changes verified working

## PR
- https://github.com/eltmon/panopticon-cli/pull/289
