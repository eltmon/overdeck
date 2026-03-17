# PAN-343: Test-agent task delivery failure silently treated as success

## Current Status: COMPLETE

## Summary

Fixed the review-status POST handler so that test-agent delivery failures
no longer silently advance the pipeline.

## Root Cause

When `wakeSpecialistOrQueue` returned `success: false` (delivery failed
after the internal retry in `wakeSpecialistWithTask`), the handler:
1. Only logged the failure
2. Fell through unconditionally to notify the work agent "REVIEW PASSED"
3. Had a pre-existing type bug: set `testStatus: 'queued'` (not in the union)

## Fix

In `src/dashboard/server/index.ts` (POST /api/workspaces/:issueId/review-status):
- Introduced `testTaskDelivered` flag
- On wake failure: fall back to `submitToSpecialistQueue` so deacon can retry
- Set `testStatus: 'testing'` in both success and fallback paths
- Gated the "REVIEW PASSED" work-agent notification on `testTaskDelivered`
- Fixed pre-existing `'queued'` → `'testing'` type bug

## Files Changed

- `src/dashboard/server/index.ts` — review-passed block refactored
- `tests/unit/dashboard/pan-343-test-delivery.test.ts` — 8 new tests

## Remaining Work

None
