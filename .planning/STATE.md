# PAN-282: Replace native JS confirm/alert dialogs with styled dialogs

## Current Status
Implementation complete. All native `confirm()` and `alert()` calls in the dashboard frontend have been replaced with styled React dialog components.

## What Was Done

### 1. Created `DialogProvider` context system
- **File:** `src/dashboard/frontend/src/components/DialogProvider.tsx`
- Provides `useConfirm()` and `useAlert()` hooks
- Promise-based API: `await confirm({...})` returns boolean, `await showAlert({...})` resolves on close
- Styled modal dialogs using existing Tailwind theme (surface/content/divider CSS variables)
- Support for `variant: 'destructive'` (red styling) and `variant: 'default'` (blue styling)
- Alert variants: `info`, `error`, `success` with appropriate icons
- Keyboard accessible: Escape to close, auto-focus confirm/OK button
- Click-outside-to-dismiss on overlay
- Proper ARIA attributes (`role="alertdialog"`, `aria-modal`, labels)

### 2. Wired provider into app root
- `DialogProvider` wraps `<App />` in `main.tsx`

### 3. Replaced all native dialog calls
Files modified:
- `IssueAgentCard.tsx` — 3 alert + 1 confirm
- `HandoffPanel.tsx` — 2 alert + 2 confirm
- `GraceCountdown.tsx` — 1 confirm
- `AgentList.tsx` — 1 alert + 1 confirm
- `SpecialistAgentCard.tsx` — 5 alert + 2 confirm
- `ProjectSpecialistPanel.tsx` — 1 confirm
- `IssueDetailPanel.tsx` — 1 alert
- `Settings/SettingsPage.tsx` — 1 alert
- `KanbanBoard.tsx` — 1 alert + 6 confirm (across IssueCard, DeepWipeButton, ReopenSection, CloseOutSection)
- `WorkspacePanel.tsx` — 7 confirm

**Total: ~15 alert + ~20 confirm calls replaced**

## Review Feedback Addressed (Round 1)

1. **Promise leak fix** — Added `pendingRef` + `dismissPending()` pattern: when a new dialog is opened while one is pending, the old promise resolves with `false` before the new dialog mounts.
2. **Destructive focus fix** — Destructive confirms now auto-focus the Cancel button instead of the Confirm button, preventing accidental destructive actions.
3. **Test file created** — `DialogProvider.test.tsx` with 14 tests covering: confirm/cancel flow, alert close, destructive variant focus, default variant focus, custom labels, Escape key handling, hook-outside-provider errors, and promise leak prevention.

## Remaining Work
None — implementation complete.

## Verification
- TypeScript compiles clean (`tsc --noEmit` — no errors)
- Vite build succeeds
- All 90 tests pass (76 existing + 14 new)
- Zero native `confirm()` or `alert()` calls remain in dashboard frontend code

## Specialist Feedback

- **[2026-03-01T05:19Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
