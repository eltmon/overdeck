# PAN-282: Replace native JS confirm/alert dialogs with styled shadcn Dialog components

## Issue Summary
Replace all `window.confirm()`, `window.alert()`, and `window.prompt()` calls in the dashboard frontend with styled Radix UI AlertDialog components that respect the existing theme system.

## Current Status
**Phase: Implementation complete**

## What Was Done

### New files created:
1. **`src/dashboard/frontend/src/components/ui/alert-dialog.tsx`** - Radix UI AlertDialog component styled with project's semantic design tokens (surface, content, divider colors). Follows shadcn API patterns.
2. **`src/dashboard/frontend/src/hooks/useConfirmDialog.tsx`** - Imperative `ConfirmDialogProvider` + `useConfirmDialog` hook providing async `confirm()`, `alert()`, and `prompt()` functions that return Promises (matching `window.confirm()` semantics).

### Files modified:
- **`main.tsx`** - Wrapped app in `ConfirmDialogProvider`
- **`WorkspacePanel.tsx`** - Replaced 7 confirm() + 1 prompt() = 8 native dialogs
- **`KanbanBoard.tsx`** - Replaced 7 confirm() + 1 alert() = 8 native dialogs
- **`IssueAgentCard.tsx`** - Replaced 3 alert() + 1 confirm() = 4 native dialogs
- **`IssueDetailPanel.tsx`** - Replaced 1 alert()
- **`AgentList.tsx`** - Replaced 1 alert() + 1 confirm() = 2 native dialogs
- **`SpecialistAgentCard.tsx`** - Replaced 5 alert() + 2 confirm() = 7 native dialogs
- **`HandoffPanel.tsx`** - Replaced 2 alert() + 2 confirm() = 4 native dialogs
- **`ProjectSpecialistPanel.tsx`** - Replaced 1 confirm()

### Total: 35 native browser dialogs replaced

### Design decisions:
- Used `@radix-ui/react-alert-dialog` as the accessible primitive (keyboard nav, focus trapping, screen reader support)
- Created imperative context-based API (`useConfirmDialog()`) rather than declarative per-component state — matches the async nature of `window.confirm()` for minimal refactoring
- Destructive actions use red buttons (`variant: 'destructive'`), informational actions use blue
- Warning icon (orange AlertTriangle) for errors/warnings, Info icon (blue) for informational dialogs
- All dialogs render in both light and dark mode using existing CSS custom property system

## Remaining Work
None — implementation complete

## Specialist Feedback
None yet
- **[2026-03-01T04:49Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
