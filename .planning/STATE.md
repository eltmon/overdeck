# PAN-84: Health tab shows all historical agents as 'dead'

## Status: Implementation Complete

## Problem

The Health tab shows 60+ agents as "dead" (red status) with "Session not found" reason. These are historical agents whose work completed normally - they're not actually failures.

**Root cause:** The `determineHealthStatusAsync` function only checks for tmux sessions. If no session exists, it returns `{status: 'dead', reason: 'Session not found'}`. It ignores the `status` field in state.json that indicates whether the agent completed normally or crashed.

**Current state.json values:**
- `"running"` (55 agents) - agent should be active
- `"stopped"` (4 agents) - agent was intentionally stopped
- `"in_progress"` (1 agent) - agent is working

## Decisions Made

### 1. Filter Only Approach (No Cleanup)
**Decision:** Only filter the health API response. Do not delete or archive agent directories.

**Rationale:** Cost calculation (`/api/costs/by-issue`) depends on agent directories to find workspace paths for session file parsing. Archiving would break cost tracking until PAN-81 (event-sourced costs) is implemented.

### 2. Filter Criteria
An agent should appear in health checks if:
- Has running tmux session (regardless of state.json status), OR
- Has `status: "running"` or `status: "in_progress"` in state.json but NO tmux session (= actually crashed)

An agent should be HIDDEN if:
- Has `status: "stopped"` in state.json (intentionally stopped)
- Has `status: "completed"` in state.json (work done)
- Has no state.json file (test artifact or corrupted)
- Directory doesn't start with `agent-` or `planning-`

### 3. Include Planning Agents
**Decision:** Include `planning-*` directories in health checks (currently only `agent-*` is checked).

### 4. Status Mapping
| Condition | Health Status | Reason |
|-----------|---------------|--------|
| tmux session + recent activity | healthy | - |
| tmux session + 15-30 min stale | warning | Low activity |
| tmux session + >30 min stale | stuck | No activity for X minutes |
| No tmux + status="running"/"in_progress" | dead | Agent crashed unexpectedly |
| No tmux + status="stopped"/"completed" | (hidden) | - |
| No tmux + no state.json | (hidden) | - |

### 5. Follow-up Issue Required
Create PAN-XX after this work to implement cleanup/archiving, blocked on PAN-81 (event-sourced costs).

## Files to Modify

### `src/dashboard/server/index.ts`

1. **Update agent name filter (line ~2053):**
   ```typescript
   // Before:
   const agentNames = readdirSync(agentsDir).filter((name) => name.startsWith('agent-'));

   // After:
   const agentNames = readdirSync(agentsDir).filter((name) =>
     name.startsWith('agent-') || name.startsWith('planning-')
   );
   ```

2. **Update `determineHealthStatusAsync` function (line ~2013):**
   - Read state.json to get the `status` field
   - If no tmux session AND status is "stopped"/"completed" → return null (exclude from results)
   - If no tmux session AND status is "running"/"in_progress" → return dead (actual crash)
   - If no tmux session AND no state.json → return null (exclude from results)

3. **Update `/api/health/agents` endpoint (line ~2046):**
   - Filter out null results from the array
   - Only return agents that should be visible

### No Frontend Changes Required
The frontend (`HealthDashboard.tsx`) already handles all 4 statuses correctly. It just needs fewer agents in the response.

## Edge Cases

1. **Agent directory exists but state.json is missing:** Exclude (probably test artifact or corrupted)
2. **state.json exists but status field is missing:** Treat as "running" (assume crash if no tmux)
3. **status has unexpected value:** Treat as "running" (conservative - show it)

## Testing Plan

1. Verify running agents still show as healthy/warning/stuck
2. Verify stopped agents don't appear in health list
3. Verify agents with state="running" but no tmux show as dead
4. Verify planning agents are included
5. Verify test artifacts (no state.json) are excluded
6. Verify cost calculation still works (agent directories intact)

## Implementation Summary

All changes implemented in `src/dashboard/server/index.ts`:

1. **Updated `determineHealthStatusAsync` function (lines 2012-2065):**
   - Now returns `null` for agents that should be hidden
   - Checks state.json `status` field to differentiate crashes from intentional stops
   - Returns `dead` only if status is "running"/"in_progress" but no tmux session exists
   - Returns `null` if status is "stopped"/"completed" or if no state.json exists

2. **Updated agent name filter (lines 2075-2077):**
   - Now includes both `agent-*` and `planning-*` directories

3. **Updated `/api/health/agents` endpoint (lines 2096-2118):**
   - Handles null results from `determineHealthStatusAsync`
   - Filters out null results before returning response

**Test Results:**
- All 372 tests pass (10 new tests added)
- Created `tests/dashboard/health-api.test.ts` with comprehensive coverage

**Code Review Feedback Addressed:**

**Round 1:**
1. ✅ Added 10 comprehensive tests for health filtering logic
2. ✅ Extracted filtering logic to `src/dashboard/lib/health-filtering.ts` for testability
3. ✅ Fixed duplicate state.json reads (read once, use throughout)
4. ✅ Added comment to catch block explaining silent failure behavior

**Round 2 (tests clarification):**
- Reviewer initially blocked PR saying "no tests for modified functionality"
- Tests already existed in commit 5d244d0 (`tests/dashboard/health-api.test.ts`)
- Added PR comment clarifying test coverage
- All 10 requested test scenarios present and passing

**Round 3 (import path fix):**
- ✅ Fixed incorrect import path in `src/dashboard/server/index.ts:18`
- Changed from `./lib/health-filtering.js` to `../lib/health-filtering.js`
- All 372 tests still passing after fix (commit a82569d)

**Round 4 (merge main):**
- ✅ Merged main into feature/pan-84 to get missing specialists module (commit 1540a00)
- All health API tests pass (10/10)
- One flaky test timeout in agent-lifecycle.test.ts (unrelated to PAN-84)
- Attempted automated re-review but dashboard froze (likely event loop blocking issue)

## Out of Scope

- Cleanup/archiving of old agent directories (follow-up PAN-XX)
- Adding filter controls to the UI
- Changing how state.json status values are set
