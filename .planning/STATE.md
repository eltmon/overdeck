# PAN-485: Add workspace lifecycle events to fix stale UI after wipe/cleanup/abort

## Status: In Progress

## Current Phase
Running quality gates (typecheck, lint, test) for bead pan-460-5gd

## Completed Work
- [x] pan-460-jcw: Added 5 new event schemas to contracts/events.ts + rebuilt contracts (commit: 62dc897)
- [x] pan-460-amn: Added reducer cases for all 5 workspace lifecycle events (commit: 868f67f)
- [x] pan-460-w94: Emitted workspace events in 4 route handlers (commit: e87ff11)

## Remaining Work
- [ ] pan-460-5gd: Pass all quality gates (typecheck, lint, test)

## Key Decisions
- D1: workspace.created is a no-op in the reducer (planning.started already handles agent state)
- D2: workspace.destroyed and workspace.deleted both remove agents and reset canonicalStatus to "todo"
- D3: workspace.wipe_started sets canonicalStatus/state to "wiping" on issue for UI spinner
- D4: workspace.aborted removes the planning agent from agentsById (by sessionName if available)
- D5: cleanup-workspace did not have eventStore previously; added it as first yield* in the handler

## Specialist Feedback
(none yet)
