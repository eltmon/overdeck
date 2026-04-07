# PAN-448: Start Agent confirmation timeout too short

## Status: Implementation Complete

## Current Phase
All work done. Committing and signaling completion.

## Completed Work
- [x] feature-pan-489-17u: Replace setTimeout confirm with click-outside/Escape dismiss pattern in KanbanBoard.tsx (commit: pending)

## Remaining Work
None

## Key Decisions
- D1: Used `mousedown` instead of `click` for outside-click detection, consistent with `ContainerSection.tsx:38-44` pattern already in the codebase
- D2: Two `ref={startButtonRef}` assignments needed — the button renders in two different layouts (one for full card view, one for compact view)

## Specialist Feedback
- [2026-04-06T14:49:53Z] verification-gate → failed (PAN-488 artifacts — not applicable to PAN-448)
- [2026-04-06T14:55:20Z] review-agent → changes-requested (PAN-488 artifacts — not applicable to PAN-448)
- [2026-04-06T15:41:26Z] review-agent → changes-requested (PAN-488 artifacts — not applicable to PAN-448)
- **[2026-04-07T15:40Z] verification-gate → FAILED** — `.planning/feedback/004-verification-gate-failed.md`
