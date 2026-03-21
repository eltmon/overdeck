# PAN-379: Kanban search auto-scroll to selected issue

## Status: Implementation Complete

## Summary
Added `scrollIntoView` behavior to both `IssueCard` (kanban view) and `ListIssueRow` (list view) components so that when an issue is selected via `/` search, the board automatically scrolls to make the selected card visible.

## Changes Made
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`:
  - `IssueCard`: Added `cardRef` + `useEffect` that calls `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` when `isSelected` becomes true
  - `ListIssueRow`: Added `rowRef` + `useEffect` with the same scroll behavior

## Remaining Work
None — implementation complete.
