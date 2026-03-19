# PAN-366: Review & Test / Merge buttons should be per-issue, not globally locked

## Status: PLANNING COMPLETE

## Decisions Made

### 1. INPUT Tag — Suppress During Specialist Phases
- **Approach**: In the server-side `hasPendingQuestion` computation (`index.ts:1823`), suppress INPUT when the issue has an active specialist phase
- **Logic**: If `reviewStatus === 'reviewing'` OR `testStatus === 'testing'` OR `mergeStatus === 'merging'`, force `hasPendingQuestion = false` regardless of idle state
- **Why**: The work agent IS idle during specialist phases — that's expected. INPUT badge should only show when human attention is genuinely needed
- **Files**: `src/dashboard/server/index.ts` (agent status endpoint, ~line 1823)

### 2. Queue Position — Server-Side in Review Status API
- **Approach**: Add `queuePosition` and `activeSpecialist` fields to `GET /api/workspaces/:issueId/review-status`
- **`queuePosition`**: null (not queued), 0 (currently being processed), 1+ (position in queue)
- **`activeSpecialist`**: Which specialist is actively processing this issue (`'review'`, `'test'`, `'merge'`, or null)
- **Frontend states**:
  - `queuePosition === null` → Normal button
  - `queuePosition >= 1` → "Queued" or "Queued (2nd)"
  - `queuePosition === 0` → Spinner + "Reviewing..." / "Testing..." / "Merging..."
  - Status `passed`/`failed` → Result display
- **Files**: `src/dashboard/server/index.ts` (review-status GET endpoint), `src/dashboard/frontend/src/components/InspectorPanel.tsx` (button rendering), `src/dashboard/frontend/src/types.ts` (ReviewStatus type)

### 3. Stale State Recovery — Both Startup + Patrol
- **Startup**: On server boot, scan all review statuses. If `reviewing`/`testing` but no corresponding specialist tmux session exists, reset to `pending`
- **Patrol**: In deacon patrol, if an issue has been `reviewing`/`testing` for >10 minutes AND no specialist session is active for that issue, reset to `pending`
- **Timeout**: 10 minutes (generous to avoid false positives during long reviews)
- **Files**: `src/dashboard/server/index.ts` (startup section), `src/lib/cloister/deacon.ts` (patrol cycle)

## Architecture Notes

### INPUT Tag Suppression
The `hasPendingQuestion` field is computed at `index.ts:1823`:
```typescript
hasPendingQuestion: pendingQuestions.length > 0 || isIdle || runtimeState?.resolution === 'needs_input'
```
We need to load the issue's review status and add a guard:
```typescript
const hasActiveSpecialist = reviewStatus?.reviewStatus === 'reviewing'
  || reviewStatus?.testStatus === 'testing'
  || reviewStatus?.mergeStatus === 'merging';

hasPendingQuestion: !hasActiveSpecialist && (pendingQuestions.length > 0 || isIdle || runtimeState?.resolution === 'needs_input')
```

### Queue Position Computation
In the review-status GET handler, query the specialist queues to determine position:
1. Check each specialist queue (review-agent, test-agent) for items matching this issueId
2. Check specialist runtime state to see if it's currently processing this issueId
3. Return position info alongside existing review status

### Stale State Recovery
Pattern follows existing `checkReadyForMergeStuck()` in deacon.ts:
- New function `checkStaleSpecialistStatuses()`
- Check if specialist tmux session exists via existing session detection
- Reset status to `pending` with a note explaining auto-reset
- Log the recovery for debugging

## Files to Modify

| File | Changes | Difficulty |
|------|---------|-----------|
| `src/dashboard/server/index.ts` | INPUT suppression in agent status, queue position in review-status API, startup stale cleanup | medium |
| `src/dashboard/frontend/src/components/InspectorPanel.tsx` | Queue position display, button state machine | medium |
| `src/dashboard/frontend/src/types.ts` | Add queuePosition/activeSpecialist to ReviewStatus | trivial |
| `src/lib/cloister/deacon.ts` | Stale reviewing/testing patrol check | medium |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Verify INPUT badge works correctly with new suppression (may need no changes) | simple |

## Out of Scope
- Global lock behavior (already fixed in 7237ac4)
- Specialist queue reordering UI
- Review/test history display
