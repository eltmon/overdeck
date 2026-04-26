# PAN-820: Add data-testid attributes to dashboard interactive elements

## Status: In Progress

## Current Phase
pan-53xq closed. Picking up pan-i15e next (ActionsSection.tsx).

## Completed Work
- [x] pan-0hfc: Added optional `'data-testid'?: string` prop to StopAgentButton + RecoverButton, spread onto the rendered button in both card and inspector variants. (commit: adf2a419)
- [x] pan-miz5: Added `inspector-panel-{issueId}` (on a `display:contents` wrapper to preserve layout while keeping `workspace-sidebar` on the scrollable element), `inspector-open-terminal-{issueId}`, and `inspector-close` to InspectorPanel.tsx. (commit: 2b61a379)
- [x] pan-yr25: Added `inspector-phase-{issueId}`, `inspector-tab-{sessionType}` (planning/work/review/test/merge mapping for known PipelinePhases, raw `tab.id` fallback otherwise), and `inspector-pin-toggle` to TerminalTabs.tsx. Required adding `issueId: string` to `TerminalTabsProps` and threading it through DetailPanelLayout.tsx. (commit: 8fce417f)
- [x] pan-53xq: Added 12 card-* and `kanban-column-{key}` testids to KanbanBoard.tsx — `card-select-{id}` (per-card bulk checkbox), `kanban-column-{key}` (column wrapper, `_`→`-` for `in-progress`/`in-review`), `card-pause-deacon-{id}` (both DeaconIgnoreButton states), `card-review-test-{id}` (pipelineCallToAction badge), `card-cost-{id}`, `card-tell-{id}`, `card-recover-{id}` (RecoverButton prop, both running and in_review usages), `card-stop-{id}` (StopAgentButton prop), `card-tell-form-{id}`, `card-tell-input-{id}`, `card-start-agent-{id}` (both backlog/todo and in_progress usages), `card-resume-session-{id}` (both in_progress and in_review usages).

## Remaining Work
- [ ] pan-i15e: Step 5 — Add inspector-* testids to ActionsSection.tsx
- [ ] pan-g67r: Step 6 — Add sidebar-* testids to Sidebar.tsx
- [ ] pan-ld6t: Step 7 — Add testids to StoppedAgentsBanner.tsx
- [ ] pan-lnbq: Step 8 — Add merge-* testids to AwaitingMergePage.tsx

## Key Decisions
- D1: One bead per file (or shared-component group). Per the Inspect Specialist contract, each bead must be a separate commit so the diff can be verified independently against the spec table in the issue body.
- D2: Steps 2 (KanbanBoard) and 5 (ActionsSection) consume the prop added in Step 1, so they are linked `blocks` on pan-0hfc.
- D3: All testids use the exact attribute strings from the PAN-820 issue body — `{identifier}` resolves to `issue.identifier` (e.g. `PAN-539`); `{columnKey}` is the internal kanban column key (`todo`, `in-progress`, `in-review`, `done`); `{sessionType}` is the lowercase phase name (`planning`, `work`, `review`, `test`, `merge`).
- D4: Existing testids (`issue-card-{id}`, `action-plan-{id}`, `workspace-actions`, `merge-btn`, `review-test-btn`, `workspace-sidebar`) are NOT renamed — backward compatibility is part of the acceptance criteria.
- D5 (pan-53xq): `card-pause-deacon-{id}` is added to BOTH button states inside `DeaconIgnoreButton` (paused/unpaused) using the existing `issueIdentifier` prop, so tests can target it regardless of state. `card-review-test-{id}` lands on the `pipelineCallToAction` badge `<span>` (the visible "Next: Review & Test" indicator), since that's the user-facing badge described in the spec.

## Specialist Feedback
- (none yet)
