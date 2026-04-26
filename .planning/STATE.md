# PAN-820: Add data-testid attributes to dashboard interactive elements

## Status: In Progress

## Current Phase
pan-miz5 closed. Picking up pan-yr25 next (TerminalTabs.tsx).

## Completed Work
- [x] pan-0hfc: Added optional `'data-testid'?: string` prop to StopAgentButton + RecoverButton, spread onto the rendered button in both card and inspector variants. (commit: adf2a419)
- [x] pan-miz5: Added `inspector-panel-{issueId}` (on a `display:contents` wrapper to preserve layout while keeping `workspace-sidebar` on the scrollable element), `inspector-open-terminal-{issueId}`, and `inspector-close` to InspectorPanel.tsx.

## Remaining Work
- [ ] pan-53xq: Step 2 — Add card-* testids to KanbanBoard.tsx
- [ ] pan-yr25: Step 4 — Add inspector-* testids to TerminalTabs.tsx
- [ ] pan-i15e: Step 5 — Add inspector-* testids to ActionsSection.tsx
- [ ] pan-g67r: Step 6 — Add sidebar-* testids to Sidebar.tsx
- [ ] pan-ld6t: Step 7 — Add testids to StoppedAgentsBanner.tsx
- [ ] pan-lnbq: Step 8 — Add merge-* testids to AwaitingMergePage.tsx

## Key Decisions
- D1: One bead per file (or shared-component group). Per the Inspect Specialist contract, each bead must be a separate commit so the diff can be verified independently against the spec table in the issue body.
- D2: Steps 2 (KanbanBoard) and 5 (ActionsSection) consume the prop added in Step 1, so they are linked `blocks` on pan-0hfc.
- D3: All testids use the exact attribute strings from the PAN-820 issue body — `{identifier}` resolves to `issue.identifier` (e.g. `PAN-539`); `{columnKey}` is the internal kanban column key (`todo`, `in-progress`, `in-review`, `done`); `{sessionType}` is the lowercase phase name (`planning`, `work`, `review`, `test`, `merge`).
- D4: Existing testids (`issue-card-{id}`, `action-plan-{id}`, `workspace-actions`, `merge-btn`, `review-test-btn`, `workspace-sidebar`) are NOT renamed — backward compatibility is part of the acceptance criteria.

## Specialist Feedback
- (none yet)
