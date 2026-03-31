# PAN-402: Dashboard — Planning Agent Spawn Failures Are Invisible to the UI

## Status: Planned

## Problem

When the dashboard "Plan" button triggers `POST /api/issues/:id/start-planning`, the endpoint returns `planningAgent.started: true` immediately, then spawns the agent in a background async task. If the background task fails (workspace creation error, tmux spawn failure, remote VM issues), the agent state file is updated to `status: failed` but the UI never learns about it. The user sees a success state while nothing is actually running.

## Decision: Socket.io Events

**Chosen approach:** Emit `planning:started` and `planning:failed` Socket.io events from the background async task in the start-planning endpoint.

**Why:** Consistent with how `agents:changed` works for work agents. Provides immediate notification without polling delay. The status polling endpoint already exists as a fallback.

**Rejected alternatives:**
- **Polling-only:** Only works when "Watch planning" is checked; misses failures when dialog is closed.
- **Both socket + enhanced polling:** Unnecessary complexity; socket events are sufficient and polling already exists as a natural fallback via the status endpoint.

## Decision: Kanban Card Failure Indicator

**Chosen approach:** Show a failure badge on the issue's kanban card when planning spawn fails, similar to the existing "Stuck" badge pattern.

**Why:** User sees the failure without needing to open the PlanDialog. Matches existing badge patterns (Ready, Stuck, Blocked, Input).

## Decision: Full Recovery Controls

**Chosen approach:** When a planning spawn failure is detected, show:
1. Error details from `state.json` error field
2. Retry button (calls start-planning again)
3. Abort button (calls abort-planning to revert issue state)

**Why:** Covers all scenarios — transient failures (retry), persistent config issues (read error, fix, retry), and "I need to fix something else first" (abort).

## Architecture

### Backend Changes (`src/dashboard/server/index.ts`)

In the background async IIFE of `POST /api/issues/:id/start-planning` (~line 9432):

1. On successful spawn (after writing `status: 'running'` to state.json):
   ```
   socketIo.emit('planning:started', { issueId: issue.identifier, sessionName })
   ```

2. In the catch block (after writing `status: 'failed'` to state.json):
   ```
   socketIo.emit('planning:failed', { issueId: issue.identifier, error: err.message })
   ```

### Frontend Changes

#### `useSocketIssues.ts` — Add planning event listeners
- Listen for `planning:started` → invalidate planning status query
- Listen for `planning:failed` → invalidate planning status query, store failure in React Query cache or Zustand

#### `KanbanBoard.tsx` — Planning failure badge
- Query planning agent state (from `/api/agents` data, which already includes planning agents)
- When a planning agent has `status: 'failed'`, show a red "Plan Failed" badge on the card
- Badge uses the same pattern as existing "Stuck" badge (red pulse, XCircle icon)

#### `PlanDialog.tsx` — Error state with recovery
- Listen for `planning:failed` socket event when `step === 'starting'` or `step === 'planning'`
- Transition to new `step: 'error'` state
- Error state shows: error message, Retry button, Abort button
- Retry calls `startPlanningMutation` again
- Abort calls existing `abort-planning` endpoint

### Data Flow

```
Background async task fails
  → writes status: 'failed' + error to state.json
  → emits socketIo.emit('planning:failed', { issueId, error })
  → useSocketIssues receives event
    → invalidates ['planningStatus', issueId] query
    → invalidates ['agents'] query (for kanban badge)
  → PlanDialog (if open): transitions to error step
  → KanbanBoard: shows "Plan Failed" badge on card
```

## Files to Modify

| File | Change | Difficulty |
|------|--------|-----------|
| `src/dashboard/server/index.ts` | Emit `planning:started` and `planning:failed` socket events | simple |
| `src/dashboard/frontend/src/hooks/useSocketIssues.ts` | Add `planning:started` and `planning:failed` listeners | simple |
| `src/dashboard/frontend/src/components/PlanDialog.tsx` | Add error step with retry/abort UI | medium |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Add "Plan Failed" badge to IssueCard | simple |

## Edge Cases

1. **Dialog closed when failure occurs:** Socket event still fires → agents query invalidated → kanban card shows badge. User sees failure on next glance at the board.
2. **Multiple rapid retries:** Each start-planning call overwrites state.json. Socket events are idempotent — latest state wins.
3. **Remote workspace failures:** Same socket events emitted regardless of local/remote. Error message from state.json contains the specific failure reason.
4. **Socket reconnection:** If the client misses the socket event, the next agents query refetch (every 5s) will pick up the failed state for the kanban badge. PlanDialog re-checks status on open.
5. **Status: 'starting' race:** The status endpoint already treats `status: 'starting'` as active. The `planning:failed` event only fires after the background task completes, so there's no race.
