# PAN-509: Inspector panel should show contextually relevant terminal based on pipeline phase

## Status: In Progress

## Current Phase
Implementing bead feature-pan-489-ryc: Add phase detection logic and active session derivation

## Completed Work
(none yet)

## Remaining Work
- [ ] feature-pan-489-ryc: Add phase detection logic and active session derivation
- [ ] feature-pan-489-6e9: Extend DetailPanelLayout to derive and pass active session to TerminalPanel
- [ ] feature-pan-489-eds: Add phase tab strip and manual pin to TerminalPanel
- [ ] feature-pan-489-adu: Update InspectorPanel header with active phase indicator

## Key Decisions
- D1: Phase detection uses `reviewStatus` fields (verificationStatus, reviewStatus, testStatus, mergeStatus) already fetched in InspectorPanel. Moving fetch to DetailPanelLayout to share with TerminalPanel.
- D2: Session naming: `specialist-${projectKey}-${specialistType}` where projectKey = issueId prefix before the number (e.g. "pan" from "pan-509").
- D3: DetailPanelLayout will derive active session name and pass as `sessionName` prop to TerminalPanel (overriding agent.id).
- D4: Phase logic in a shared utility file `src/dashboard/frontend/src/components/inspector/phase-utils.ts`.
- D5: Manual pin stored in React state (not persisted) — user can click any tab to switch, auto-switch resumes when phase changes.

## Specialist Feedback
(none yet)
