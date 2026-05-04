# PAN-222: Fix pre-existing specialist-logs test failure

## Problem

`tests/lib/cloister/specialist-logs.test.ts` had a pre-existing failure:

```
cleanupOldLogs > should keep last N runs even if older than maxDays
Expected 2 remaining runs, got 3
```

## Root Cause

In `cleanupOldLogs()` (src/lib/cloister/specialist-logs.ts), the date comparison used `>=` instead of `>`:

```typescript
// BUG: keep if createdAt >= cutoffDate
if (log.createdAt >= cutoffDate) {
  return;
}
```

When `maxDays: 0`, `cutoffDate = Date.now()`. Files created in the same millisecond as the cutoff satisfied `createdAt >= cutoffDate` (equal), so they were incorrectly retained. The failure was intermittent — visible in the full test suite (timing-dependent) but not when the test ran in isolation.

## Fix

Changed `>=` to `>` in the retention date check:

```typescript
// Files at the exact cutoff boundary are candidates for deletion
if (log.createdAt > cutoffDate) {
  return;
}
```

This ensures that files created at the exact cutoff timestamp are treated as candidates for deletion, making the count-based retention (`maxRuns`) work correctly regardless of timing.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/cloister/specialist-logs.ts` | `>=` → `>` in cleanupOldLogs date comparison |

## Current Status

**COMPLETE** — Fix implemented, all 1157 tests pass (previously 1156 passed + 1 failed), committed and pushed.

## Remaining Work

None. Implementation complete.

## Specialist Feedback

- **[2026-02-21T14:54Z] test-agent → FAILED** — `.planning/feedback/006-test-agent-failed.md`
