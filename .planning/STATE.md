# PAN-282: Replace native JS confirm/alert dialogs with styled Dialog components

## Issue
Replace all browser-native `confirm()` and `alert()` calls in dashboard frontend with styled dialog components that respect the existing Panopticon theme system (light/dark mode).

## Current Status
**Phase: Implementation complete**

## Architecture Decision
- Project uses custom Tailwind design system (classes like `bg-surface-raised`, `text-content`, `border-divider`)
- No shadcn/ui installed; will use Radix UI primitives (@radix-ui/react-alert-dialog) for accessibility
- Existing `ConfirmationDialog.tsx` is for agent tmux session confirmations (different use case)
- Will create a `useConfirmDialog` hook + context for async confirm() replacement
- Will create a toast/notification system for alert() replacement

## Audit Results

### confirm() calls (20 total):
1. **IssueAgentCard.tsx:187** — Kill agent
2. **KanbanBoard.tsx:1794** — Kill agent
3. **KanbanBoard.tsx:1841** — Start agent
4. **KanbanBoard.tsx:2140** — Deep wipe
5. **KanbanBoard.tsx:2182** — Reset
6. **KanbanBoard.tsx:2242** — Reopen
7. **KanbanBoard.tsx:2299** — Close out
8. **HandoffPanel.tsx:45** — Hand off agent
9. **HandoffPanel.tsx:52** — Handoff suggestion
10. **SpecialistAgentCard.tsx:322** — Approve merge
11. **SpecialistAgentCard.tsx:332** — Kill specialist
12. **GraceCountdown.tsx:101** — Terminate specialist
13. **AgentList.tsx:183** — Reset ALL specialists
14. **WorkspacePanel.tsx:597** — Sync main
15. **WorkspacePanel.tsx:619** — Clean corrupted workspace
16. **WorkspacePanel.tsx:637** — Generic confirm
17. **WorkspacePanel.tsx:643** — Merge to main
18. **WorkspacePanel.tsx:649** — Close without merge
19. **WorkspacePanel.tsx:722** — Kill agent
20. **WorkspacePanel.tsx:1840** — Drop and reload database
21. **ProjectSpecialistPanel.tsx:124** — Terminate specialist

### alert() calls (14 total):
1. **IssueAgentCard.tsx:168** — Poke success
2. **IssueAgentCard.tsx:171** — Poke failure
3. **IssueAgentCard.tsx:181** — Resume failure
4. **HandoffPanel.tsx:37** — Handoff success
5. **HandoffPanel.tsx:40** — Handoff failure
6. **KanbanBoard.tsx:1835** — Start agent failure
7. **IssueDetailPanel.tsx:329** — Workspace backup info
8. **AgentList.tsx:178** — Reset specialists failure
9. **SpecialistAgentCard.tsx:261** — Wake failure
10. **SpecialistAgentCard.tsx:271** — Reset failure
11. **SpecialistAgentCard.tsx:290** — Resume failure
12. **SpecialistAgentCard.tsx:300** — Remove queue item failure
13. **SpecialistAgentCard.tsx:310** — Reorder queue failure
14. **Settings/SettingsPage.tsx:284** — Load defaults failure

## Implementation Plan
1. Install @radix-ui/react-alert-dialog dependency
2. Create `ConfirmDialogProvider` context with async `confirm()` function
3. Create styled `AlertDialog` component matching existing design system
4. Create `useNotification` hook + `NotificationProvider` for alert() replacement (toast-style)
5. Replace all confirm() calls across 8 components
6. Replace all alert() calls across 7 components
7. Wire providers into App.tsx
8. Run tests

## Remaining Work
None — implementation complete.

## Implementation Summary
1. Created `ConfirmDialogProvider.tsx` — context-based async confirm() with styled dialog matching existing design system
2. Created `NotificationProvider.tsx` — toast notification system for success/error/warning/info messages
3. Wired both providers in `main.tsx` wrapping the App
4. Replaced all 21 `confirm()` calls across 8 components with `await confirm({...})`
5. Replaced all 14 `alert()` calls across 7 components with `notify({...})`
6. All dialogs support light/dark mode via existing CSS variable theme system
7. Destructive actions use red variant, warnings use orange, info uses blue
8. TypeScript compiles cleanly, all 76 tests pass
