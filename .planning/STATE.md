# PAN-309: Evidence-Based Completion Detection & Lifecycle Badges

## Current Status: COMPLETE

## Summary

Implemented all 5 phases of PAN-309. Build passes, no new test regressions.

## Implementation

### Phase 1+2: Evidence checks in stop-hook + resolution field
- `scripts/work-agent-stop-hook`: Before LLM call, checks STATE.md, git push status, beads
- Decision matrix: STATE.md=complete + branch=pushed → FORGOT_COMPLETION nudge (no LLM)
- Writes `resolution`, `resolutionCount`, `resolutionUpdatedAt` to runtime.json
- LLM fallback: UNCLEAR → 'stuck' after 2+ occurrences; STOPPED_FOR_INPUT → 'needs_input'

### Phase 3: Kanban lifecycle badges (KanbanBoard.tsx)
- DONE badge (green, CheckCircle): resolution=done
- STUCK badge (red, XCircle, pulsing): resolution=stuck
- BLOCKED badge (amber, AlertCircle): resolution=needs_input without AskUserQuestion
- `hasPendingQuestion` now also true when resolution=needs_input (server-side)

### Phase 4: Deacon work agent patrol (deacon.ts)
- `patrolWorkAgentResolutions()`: auto-completes agents with resolution=done+count≥2,
  pokes agents with resolution=stuck+count≥3
- Wired into `runPatrol()` cycle

### Phase 5: Dashboard API (server/index.ts, types.ts, agents.ts)
- `AgentRuntimeState` interface: added resolution, resolutionCount, resolutionUpdatedAt
- `Agent` frontend type: added resolution, resolutionCount
- `/api/agents`: includes resolution + resolutionCount for all agent types

## Files Changed
- `src/lib/agents.ts` — AgentRuntimeState + AgentResolution type
- `src/lib/cloister/deacon.ts` — patrolWorkAgentResolutions()
- `src/dashboard/server/index.ts` — resolution in API response
- `src/dashboard/frontend/src/types.ts` — Agent type update
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` — lifecycle badges
- `scripts/work-agent-stop-hook` — evidence-based detection + resolution writes

## Remaining Work
None
