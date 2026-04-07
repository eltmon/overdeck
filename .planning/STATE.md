# PAN-464: Workspace containers silently die — no health monitoring or auto-restart

## Status: In Progress

## Current Phase
Bead 1 implemented. Committing and closing bead, then moving to bead 2 (agent alerting).

## Completed Work
- [x] feature-pan-489-ipe: Add restart backoff + tracking + orphaned process cleanup to checkWorkspaceContainerHealth() (commit: TBD)

## Remaining Work
- [ ] feature-pan-489-2ug: Alert agent via tmux when its workspace container crashes
- [ ] feature-pan-489-38u: Add unit tests for container health backoff and agent alerting

## Key Decisions
- D1: Items 1 (patrol check) and 3 (dashboard display) from the issue are ALREADY implemented — ContainerSection.tsx shows container status, checkWorkspaceContainerHealth() in deacon.ts already does basic crash detection + restart
- D2: Combine root cause fix (orphaned Vite process cleanup before restart) with backoff bead — they belong together in the restart flow
- D3: Use resolveProjectFromIssue + findWorkspacePath to get workspace path for orphaned process cleanup (same pattern as other deacon code)
- D4: Container restart state persisted in DeaconState (health-state.json) for crash recovery

## Specialist Feedback
(none yet)
