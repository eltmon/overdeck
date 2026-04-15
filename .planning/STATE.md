# PAN-722: Remove Queues for All Specialists Except Merge Agent

**Status:** Plan Approved
**Planned by:** Claude Opus 4.6
**Date:** 2026-04-15

---

## Discovery Summary

### Queue System Architecture (as-found)

Panopticon has two distinct queue mechanisms:

**1. FPP Hook Queue (file-based, per-agent)**
- `src/lib/hooks.ts` — `~/.panopticon/agents/<name>/hook.json` per agent
- Functions: `pushToHook`, `popFromHook`, `checkHook`, `clearHook`, `reorderHookItems`
- Used by `SpecialistQueueItem` / `submitToSpecialistQueue` etc. in `specialists.ts`
- **ALSO used by non-queue FPP system**: `initHook`, `checkHook`, `generateFixedPointPrompt`, `sendMail`, `collectMail` — imported by `agents.ts`, `fpp-violations.ts`, `fpp-handler.ts`
- **CRITICAL**: Cannot delete `hooks.ts`. Only remove queue callers for non-merge specialists.

**2. SQLite Merge Queue (persistent, per-project)**
- `src/lib/database/merge-queue-db.ts` — `merge_queue` table
- `src/dashboard/server/services/merge-queue-service.ts` — startup resume
- Merge queue handling in `workspaces.ts` `triggerMerge()` / `dequeueNextMerge()`
- **MUST be preserved in full.**

### Specialist Queue Call Sites (to remove/change)

| File | Location | Change |
|------|----------|--------|
| `src/lib/cloister/specialists.ts` | Lines 2551–2669 | Delete `SpecialistQueueItem`, `submitToSpecialistQueue`, `checkSpecialistQueue`, `getNextSpecialistTask`, `completeSpecialistTask` + their `hooks.js` import |
| `src/lib/cloister/test-agent-queue.ts` | Lines 39–93 | Remove `specialist_busy` branches → set `dispatch_failed` on busy; rename to `dispatchTestAgentAndNotify` |
| `src/lib/review-status.ts` | Lines 257–287 | Replace `submitToSpecialistQueue('test-agent')` with `spawnEphemeralSpecialist` directly |
| `src/lib/cloister/service.ts` | Lines 337–368 | Replace `submitToSpecialistQueue('review-agent')` with `spawnEphemeralSpecialist` in startup orphan recovery |
| `src/lib/cloister/deacon.ts` | Lines 1282–1332 | Remove `alreadyQueued` check + `submitToSpecialistQueue` busy fallback in review orphan section |
| `src/lib/cloister/deacon.ts` | Lines 1364–1422 | Remove `alreadyQueued` check + `submitToSpecialistQueue` busy fallback in test orphan section |
| `src/lib/cloister/deacon.ts` | Lines 2247–2323 | Delete `checkSpecialistQueues()` function entirely |
| `src/lib/cloister/deacon.ts` | Line 2669 | Remove `checkSpecialistQueues()` call |
| `src/dashboard/server/routes/workspaces.ts` | Lines 2719–2730 | Remove `submitToSpecialistQueue` fallback in request-review busy handler |
| `src/dashboard/server/routes/workspaces.ts` | Lines 2793–2804 | Remove review/test queue clearing in reset-review (keep merge-agent only) |
| `src/dashboard/server/routes/workspaces.ts` | Lines 1963–1988 | Remove review/test queue lookups in GET /api/review/:issueId/status |
| `src/dashboard/server/routes/workspaces.ts` | Line 73 | Remove `checkSpecialistQueue` import |
| `src/dashboard/server/routes/specialists.ts` | Lines 337–353 | Remove queue clearing in done handler |
| `src/dashboard/server/routes/specialists.ts` | Lines 630–1163 | Remove 5 queue routes + compositions (queues, :name/queue GET/POST/DELETE, reorder) |
| `src/dashboard/server/routes/issues.ts` | Lines 1252–1263 | Remove review/test queue clearing on issue destroy |
| `src/lib/reopen.ts` | Lines 102–117 | Remove queue clearing for review/test agents |
| `src/lib/cloister/specialist-handoff-logger.ts` | Lines 17–48 | Update `KNOWN_SPECIALISTS` to `['merge-agent']` only |

### Files to Delete
- `src/cli/commands/specialists/queue.ts`
- `src/cli/commands/specialists/clear-queue.ts`
- `tests/lib/cloister/specialists-queue.test.ts`

### CLI Command Registration (to update)
- `src/cli/commands/specialists/index.ts` — remove `queue` and `clear-queue` command registrations

### Frontend Files to Update
- `src/dashboard/frontend/src/components/HandoffsPage.tsx` — remove `queueDepth` display, update description text
- `src/dashboard/frontend/src/components/MetricsSummaryRow.tsx` — rename "Queue" to "Merge Queue" (reflects only merge depth)
- `src/dashboard/frontend/src/components/MetricsSummary.tsx` — same
- `src/dashboard/frontend/src/components/InspectorPanel.test.tsx` — remove "Queued (Nth)" test cases; only `queuePosition === 0` (active) still applies for non-merge

### Test Files to Update
- `tests/lib/cloister/deacon-orphan-recovery.test.ts` — remove alreadyQueued test cases
- `tests/unit/lib/cloister/pan-344-auto-merge.test.ts` — check for queue refs, update if present
- `tests/unit/dashboard/pan-343-test-delivery.test.ts` — update to reflect direct dispatch not queue

---

## Key Architectural Decisions

### D1: When `specialist_busy` is returned, do not queue — set `dispatch_failed`
**Decision:** When `spawnEphemeralSpecialist` returns `specialist_busy`, set `testStatus: 'dispatch_failed'` (for test) or keep `reviewStatus: 'pending'` (for review). Do NOT queue.
**Rationale:** The deacon's existing orphan recovery already handles these states: `reviewStatus === 'pending'` + no active session → re-dispatches on next patrol. `testStatus === 'dispatch_failed'` → re-dispatches. This gives us the equivalent of "retry" without a queue data structure.

### D2: `hooks.ts` survives unchanged
**Decision:** Do not modify `hooks.ts`.
**Rationale:** `hooks.ts` serves the FPP system (`initHook`, `checkHook`, `generateFixedPointPrompt`, `sendMail`, `collectMail`) which is used by `agents.ts`, `fpp-violations.ts`, `fpp-handler.ts`. The specialist queue was just a consumer of `pushToHook`/`popFromHook`. Removing those callers is sufficient; the hook file itself stays.

### D3: Merge queue usage stays in `queue-position.ts` + workspaces.ts
**Decision:** Keep `findPositionInQueue` in `src/lib/queue-position.ts`. In the review status endpoint, keep only the merge queue lookup branch.
**Rationale:** The merge queue is persistent SQLite-backed; its position is still meaningful for the UI ("Awaiting Merge — 2nd in line"). Review/test no longer have queue positions.

### D4: `getLiveQueueDepth` tracks merge-agent only
**Decision:** In `specialist-handoff-logger.ts`, narrow `KNOWN_SPECIALISTS` to `['merge-agent']` so `queueDepth` only counts merge queue items.
**Rationale:** The queueDepth metric is surfaced in MetricsSummary as a pending-work indicator. After this change, the only work that can pile up is in the merge queue, so the metric remains meaningful.

### D5: Frontend "Queue" metric becomes "Merge Queue"
**Decision:** Rename the Queue metric label in MetricsSummaryRow and MetricsSummary to "Merge Queue".
**Rationale:** Avoids confusing `0` as "nothing queued" when in reality review/test now never queue.

### D6: `autoQueueTestAgentAndNotify` becomes `dispatchTestAgentAndNotify`
**Decision:** Rename the exported function in `test-agent-queue.ts`.
**Rationale:** The word "queue" in the name is misleading after this change. All call sites use the import directly, so renaming is safe with a search-replace.

---

## Architecture

### What's Changing

| Component | Before | After |
|-----------|--------|-------|
| review dispatch | try spawn → if busy, `submitToSpecialistQueue` | try spawn → if busy, keep pending (deacon retries) |
| test dispatch (on review pass) | `submitToSpecialistQueue` in `setReviewStatus` | `spawnEphemeralSpecialist` directly |
| test dispatch (test-agent-queue.ts) | try spawn → if busy, queue | try spawn → if busy, `dispatch_failed` |
| startup recovery (service.ts) | `submitToSpecialistQueue('review-agent')` | `spawnEphemeralSpecialist` directly |
| deacon patrol | `checkSpecialistQueues()` drains FPP hook files | function deleted |
| deacon orphan recovery | check alreadyQueued, fallback to queue | just dispatch; on busy → skip (retry next patrol) |
| merge dispatch | always SQLite queue | unchanged |
| `GET /api/specialists/queues` | lists all specialist queues | DELETED |
| `GET /api/specialists/:name/queue` | shows queue items | DELETED |
| `POST /api/specialists/:name/queue` | enqueues if busy | DELETED |
| `DELETE /api/specialists/:name/queue/:itemId` | removes item | DELETED |
| `PUT /api/specialists/:name/queue/reorder` | reorders | DELETED |
| `pan specialists queue <name>` | shows queue | DELETED |
| `pan specialists clear-queue <name>` | clears queue | DELETED |
| queueDepth metric | all 5 specialists' hooks | merge-agent hook only |
| queuePosition in review status API | review + test + merge queues | merge queue only |

---

## Remaining Work
See plan.vbrief.json for the complete bead breakdown.
