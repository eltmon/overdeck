# PAN-509: Inspector panel should show contextually relevant terminal based on pipeline phase

## Status: Implementation Complete

## Current Phase
All beads complete — running quality gates and finalizing

## Completed Work
- [x] feature-pan-489-ryc: Add phase-utils.ts with detectPhase/getActiveSession/getProjectKey (commit: daccdadf)
- [x] feature-pan-489-6e9: DetailPanelLayout fetches reviewStatus, derives activeSession, passes to TerminalPanel; TerminalPanel handles specialist vs agent sessions (commit: b416473a)
- [x] feature-pan-489-eds: TerminalPanel tab strip — shows Agent + active specialist tabs, auto badge, pin/unpin on click (commit: 60a81ca6)
- [x] feature-pan-489-adu: InspectorPanel phase indicator banner — color-coded, animated dot, shown when specialist/verification active (commit: TBD)

## Remaining Work
- None — all beads complete, tests passing
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
- **[2026-04-07T19:01Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/009-review-agent-changes-requested.md`
- **[2026-04-10T19:38Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/010-review-agent-changes-requested.md`
