# PAN-369: Test specialist not spawned after review passes

## Status: Implementation Complete

## Problem

When review-agent passes an issue, `testStatus` is set to `'testing'` but the test specialist silently fails to spawn. The issue gets permanently stuck with a testing spinner.

## Root Cause

Three interacting failures in the review→test handoff:

### 1. `autoQueueTestAgentAndNotify` error swallowing (test-agent-queue.ts:85-88)
When `wakeSpecialistOrQueue` throws an exception, the catch block logs the error but:
- `testStatus` may already be set to `'testing'` (lines 61, 78) inside the try block before the throw
- The error is swallowed — no status revert, no queue item created
- Result: `testStatus: 'testing'` persists with no test-agent running and no queue item

### 2. Fallback queue + orphan detector conflict (test-agent-queue.ts:67-83, deacon.ts:1190-1194)
When wake returns `{success: false}` (not an exception), the code:
- Submits to specialist queue (good)
- Sets `testStatus: 'testing'` (premature)
- But the deacon's orphan detector sees `testStatus === 'testing'` with no active test-agent
- Orphan detector resets `testStatus` to `'pending'` — but **does NOT re-queue the test task**
- The queue item exists but nothing re-triggers dispatch because testStatus is now `'pending'`

### 3. No retry on immediate dispatch failure
`wakeSpecialistOrQueue` is called once. If it fails (e.g., tmux session creation fails after reboot), there's no retry before falling back to the queue path, which has the orphan detector conflict above.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fix strategy | Both: reliable dispatch + deacon recovery | Belt and suspenders — deacon should be able to recover if dispatch ever fails again |
| Error state | New `'dispatch_failed'` testStatus | More informative than silent revert to pending; dashboard can show actionable error |
| Retry logic | 1 immediate retry before queue fallback | Handles transient failures (post-reboot tmux not ready) without deacon latency |

## Architecture

### New testStatus value: `'dispatch_failed'`
- Added to `ReviewStatus.testStatus` union type in `src/lib/review-status.ts`
- Dashboard UI shows error indicator with "Test dispatch failed" message
- Deacon orphan detector treats `'dispatch_failed'` as retriable — re-queues and resets to `'testing'`

### Fix 1: Reliable dispatch in `autoQueueTestAgentAndNotify`
- Add 1 retry with 2s delay if first `wakeSpecialistOrQueue` fails
- Only set `testStatus: 'testing'` AFTER confirming queue submission or wake success
- On total failure (both attempts + queue submission fail): set `testStatus: 'dispatch_failed'` with error in `testNotes`

### Fix 2: Deacon orphan detector re-queues
- When orphan detector finds `testStatus === 'testing'` or `'dispatch_failed'` with no active test-agent:
  - Check if test-agent queue already has this issue (dedup)
  - If not queued: re-submit to specialist queue with source `'deacon-orphan-recovery'`
  - Set `testStatus: 'testing'` (re-queued, will be processed)
  - Log the recovery action

### Fix 3: No try-catch around server endpoint call
- Wrap the `autoQueueTestAgentAndNotify` call in server/index.ts:6801-6802 in try-catch
- On failure: set `testStatus: 'dispatch_failed'` and log error
- Prevents unhandled promise rejection from crashing the endpoint

## Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/lib/review-status.ts` | Add `'dispatch_failed'` to testStatus union | Low |
| `src/lib/cloister/test-agent-queue.ts` | Retry logic, move testStatus set after confirmation, dispatch_failed on total failure | Medium |
| `src/dashboard/server/index.ts` | Wrap autoQueueTestAgentAndNotify in try-catch | Low |
| `src/lib/cloister/deacon.ts` | Orphan detector re-queues instead of just resetting | Medium |
| `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx` | Display dispatch_failed state | Low |
| `src/dashboard/frontend/src/components/inspector/types.ts` | Update testStatus type if separate from backend | Low |
| `src/dashboard/frontend/src/components/WorkspacePanel.tsx` | Handle dispatch_failed in status display | Low |

## Out of Scope
- Refactoring the entire specialist queue system
- Adding a general retry framework
- Changing the review→test handoff architecture (just making the existing one reliable)
