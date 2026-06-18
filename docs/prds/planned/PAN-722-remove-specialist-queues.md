# PAN-722: Remove Specialist Queues (Except Merge)

## Problem

Overdeck currently has a queue system for every specialist agent (review, test, inspect, uat, merge). For review and test specialists, the queue exists only as a fallback when the specialist is already busy with another workspace — work is otherwise dispatched immediately. The queue adds significant complexity (file-based hooks, deacon drain loops, status-tracking states, CLI commands, API endpoints, dashboard UI) for a problem that no longer needs to exist: review and test specialists are now ephemeral and can be spawned in parallel per workspace.

The **merge queue** is fundamentally different — it is a persistent, SQLite-backed, per-project serialization mechanism because humans approve merges serially. It must stay.

## Goal

Delete the queue concept entirely for all specialist agents **except merge**. Review, test, inspect, and UAT runs should always dispatch immediately against their target workspace, spawning ephemeral specialists as needed. The merge queue remains untouched.

## Non-Goals

- Changing the merge queue (`merge_queue` table, `merge-queue-db.ts`, `merge-queue-service.ts`, dequeu-next logic, merge UI).
- Changing how review/test are *triggered* by upstream events (hook into same trigger points, just dispatch directly).
- Changing Cloister model routing or specialist lifecycle beyond queue removal.

## Current Architecture

### Specialist Queue Types

**1. Hook-Based Queues** (review-agent, test-agent, inspect-agent, uat-agent):
- Storage: `~/.overdeck/agents/<name>/hook.json` (file-based)
- Implementation: `src/lib/hooks.ts` - `HookItem`, `pushToHook()`, `checkHook()`, `popFromHook()`
- Key functions in `src/lib/cloister/specialists.ts`:
  - `submitToSpecialistQueue()` (lines ~2581-2631) - adds task to specialist's hook
  - `checkSpecialistQueue()` (lines ~2639-2645) - checks if specialist has work
  - `getNextSpecialistTask()` (lines ~2666-2669) - gets next (highest priority) task
  - `completeSpecialistTask()` (lines ~2654-2656) - removes task from queue
- `wakeSpecialistOrQueue()` (lines ~2425-2542) - queues if specialist busy, otherwise wakes directly
- Deacon patrol `checkSpecialistQueues()` (lines ~2247-2323) - drains queues and dispatches

**2. Database-Based Merge Queue** (merge-agent only):
- Storage: SQLite `merge_queue` table
- Implementation: `src/lib/database/merge-queue-db.ts`
- Operations: `enqueueMerge()`, `dequeueMerge()`, `markMergeProcessing()`, `getCurrentMerge()`, etc.
- Service: `src/dashboard/server/services/merge-queue-service.ts`

### Key Files to Remove/Modify

**Delete entirely:**
- `src/lib/cloister/test-agent-queue.ts` - replaced by direct dispatch
- `src/cli/commands/specialists/queue.ts` - `pan specialists queue <name>`
- `src/cli/commands/specialists/clear-queue.ts` - `pan specialists clear-queue <name>`
- `tests/lib/cloister/specialists-queue.test.ts` - non-merge queue tests

**Delete functions from existing files:**
- `src/lib/cloister/specialists.ts`:
  - Remove: `submitToSpecialistQueue()`, `checkSpecialistQueue()`, `getNextSpecialistTask()`, `completeSpecialistTask()`
  - Modify: `wakeSpecialistOrQueue()` - always spawn directly, never queue
- `src/lib/hooks.ts`:
  - Remove: hook/queue functions (or gut to merge-only if shared helpers exist)
- `src/lib/cloister/deacon.ts`:
  - Remove: `checkSpecialistQueues()` (lines ~2244-2323)
  - Remove: queue-fallback branches inside review (lines ~1283-1332) and test (lines ~1365-1423) dispatch logic
- `src/cli/commands/request-review.ts`:
  - Drop requeue/circuit-breaker logic; make `pan review request` directly dispatch

**Dashboard API endpoints to remove:**
- `src/dashboard/server/routes/specialists.ts`:
  - Remove `GET/POST/DELETE/PUT /api/specialists/:name/queue*` endpoints for non-merge

**Update:**
- `src/lib/review-status.ts` - simplify state machine: drop "queued" state; keep `pending → running → passed/failed`
- Dashboard frontend:
  - `SpecialistAgentCard.tsx` - remove queue counters/lists for non-merge
  - `HandoffsPage.tsx` - remove queue visualization for review/test

## Code to Preserve (Merge Queue)

- `src/lib/database/merge-queue-db.ts` and `merge_queue` schema
- `src/dashboard/server/services/merge-queue-service.ts` (`resumeQueuedMerges`)
- `src/dashboard/server/routes/workspaces.ts` merge enqueue/dequeue logic
- Merge queue UI in Kanban and Awaiting Merge page

## New Dispatch Pattern

Instead of:
```
if (specialist busy) → submitToSpecialistQueue()
else → wakeSpecialistWithTask()
```

Always:
```
if (workspace already has running specialist) → no-op (duplicate guard)
else → spawnEphemeralSpecialist() directly
```

The duplicate-dispatch guard checks `reviewStatus === 'reviewing'` / `testStatus === 'testing'` before spawning.

## Restart Recovery

On dashboard/server startup:
1. Load all workspaces with status `running` but no live specialist session
2. Reset status to `pending`
3. Re-dispatch specialist (or rely on existing trigger mechanisms)

This replaces the queue as the recovery mechanism for crashed in-flight specialists.

## Acceptance Criteria

- [ ] No queue reads/writes for review, test, inspect, or uat specialists anywhere in the codebase
- [ ] Review and test always run via an ephemeral specialist dispatched directly against the target workspace
- [ ] Merge queue continues to work: enqueue on trigger, dequeue on complete, resume on restart, UI shows queue position
- [ ] `pan specialists queue` / `clear-queue` removed (or scoped to merge only)
- [ ] Dashboard no longer shows queue counts/lists for non-merge specialists
- [ ] Duplicate-dispatch guard: triggering review while one is already running is a no-op
- [ ] Restart recovery: review/test `running` without a live session gets reset and re-dispatched
- [ ] Existing merge queue tests still pass; non-merge queue tests deleted

## Risks

- **Resource contention**: If many workspaces trigger review/test simultaneously, we spawn N ephemeral specialists in parallel. Mitigation: rely on existing Cloister concurrency limits; add a global soft cap if empirically needed.
- **Duplicate dispatch**: Without the "already queued" check, a double-trigger could spawn two specialists for the same workspace. Mitigation: gate dispatch on workspace review/test status (`running` means don't re-dispatch).
- **Recovery on restart**: Losing the queue means in-flight review/test that die with the server are not resumed. Mitigation: on startup, any workspace with status `running` but no live specialist is reset to `pending` and re-dispatched.

## Rollout

Single PR. Delete-heavy refactor; no feature flag. Verify with an end-to-end run through the specialist pipeline on a test workspace before merging.
