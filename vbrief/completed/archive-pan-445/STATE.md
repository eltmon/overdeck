# PAN-445: Planning Abort button uses native JS confirm() instead of styled dialog

## Status: Planning Complete

## Problem
Two issues with the Planning Abort flow:
1. The Abort button in `PlanDialog.tsx` uses native `window.confirm()` instead of the styled `useConfirm()` dialog from `DialogProvider` that all other dashboard confirmation actions use.
2. The abort-planning endpoint's label removal has a silent catch block that swallows all errors, making failures impossible to diagnose.

## Decisions
- **Dialog variant**: Use `variant: 'destructive'` (not `'danger'` as the issue suggested — `'danger'` is not a valid variant in `ConfirmOptions`).
- **Scope**: Both the main abort handler (`handleAbortPlanning`, line 292) AND the error-state abort button (line 846) will get styled confirm dialogs.
- **Label removal**: The code path exists and looks correct. The fix is adding error logging to the silent catch block so failures are diagnosable.

## Implementation Plan

### Task 1: Replace native confirm() with useConfirm() in PlanDialog.tsx
**Difficulty: simple** | **Files: 1** (`src/dashboard/frontend/src/components/PlanDialog.tsx`)

Changes:
1. Add `import { useConfirm } from './DialogProvider'` to imports
2. Add `const confirm = useConfirm()` at top of PlanDialog component
3. Convert `handleAbortPlanning` from sync to async, replace `window.confirm()` with:
   ```typescript
   const confirmed = await confirm({
     title: 'Abort Planning',
     message: 'Abort planning and return to Todo?\n\nThis will:\n• Stop the planning agent\n• Move the issue back to "Todo"\n• Keep the workspace (can be deleted separately)\n\nAny planning artifacts in the workspace will be preserved.',
     confirmLabel: 'Abort Planning',
     variant: 'destructive',
   });
   ```
4. Add styled confirm to error-state abort button (line 846) — wrap the `abortPlanningMutation.mutate()` call with the same confirm pattern.

### Task 2: Improve label removal error handling in abort-planning endpoint
**Difficulty: simple** | **Files: 1** (`src/dashboard/server/routes/issues.ts`)

Changes:
1. Replace the silent `catch { /* Label might not exist */ }` (line 811) with a catch that logs the error:
   ```typescript
   catch (labelErr) {
     console.log('[abort-planning] Warning: Could not remove planning label:', labelErr);
   }
   ```

## Architecture Notes
- `PlanDialog` is rendered inside `KanbanBoard`, which is inside `DialogProvider` (in `main.tsx`), so `useConfirm()` is available.
- The existing `useConfirm()` pattern is well-established across 9+ components (KanbanBoard, InspectorPanel, IssueAgentCard, etc.).
- `handleAbortPlanning` must become `async` since `useConfirm()` returns `Promise<boolean>`.

## Out of Scope
- No changes to the actual abort-planning business logic
- No changes to Linear issue state reversion (already working)
- No new tests (the DialogProvider already has tests; the change is a mechanical pattern swap)

## Specialist Feedback

- **[2026-04-05T02:38Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-05T02:41Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
