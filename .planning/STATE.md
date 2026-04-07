# PAN-464: Workspace containers silently die — no health monitoring or auto-restart

## Status: Implementation Complete

## Current Phase
All beads implemented and tested. Committing bead 3 (tests) and calling pan work done.

## Completed Work
- [x] feature-pan-489-ipe: Add restart backoff + tracking + orphaned process cleanup to checkWorkspaceContainerHealth() (commit: 5719bccf)
- [x] feature-pan-489-2ug: Alert agent via tmux on crash (restart notification + gave-up warning + restart-failed alert) (commit: 18e0181e)
- [x] feature-pan-489-38u: 12 unit tests for backoff calculation + container health all scenarios (commit: afee0300)

## Remaining Work
(none)

## Key Decisions
- D1: Items 1 (patrol check) and 3 (dashboard display) from the issue are ALREADY implemented — ContainerSection.tsx shows container status, checkWorkspaceContainerHealth() in deacon.ts already does basic crash detection + restart
- D2: Combine root cause fix (orphaned Vite process cleanup before restart) with backoff bead — they belong together in the restart flow
- D3: Use resolveProjectFromIssue + findWorkspacePath to get workspace path for orphaned process cleanup (same pattern as other deacon code)
- D4: Container restart state persisted in DeaconState (health-state.json) for crash recovery

## Specialist Feedback
(none yet)
- **[2026-04-07T04:53Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
