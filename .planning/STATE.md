# PAN-81: Event-Sourced Cost Tracking

## Status: IN PROGRESS - Spin Locks Fixed, Tests Written, Needs Commit

## Summary

Eliminate redundant session file parsing by using hooks, event logs, and pre-computed aggregation cache. Subagent costs are now included.

## What's Done

### Core Implementation (Committed)
- `scripts/cost-hook` - Bash hook for real-time cost event collection
- `src/lib/costs/types.ts` - Type definitions
- `src/lib/costs/events.ts` - Append-only event log with file locking
- `src/lib/costs/aggregator.ts` - Pre-computed cache management
- `src/lib/costs/migration.ts` - Historical data import (includes subagents)
- `src/lib/costs/pricing.ts` - Model pricing calculations
- `src/lib/costs/retention.ts` - 90-day rolling cleanup
- `src/cli/commands/setup/hooks.ts` - Hook registration
- Dashboard API endpoints: `/api/costs/by-issue`, `/api/costs/rebuild`, `/api/costs/status`, `/api/costs/migrate`

### Recent Progress (UNCOMMITTED - needs commit)

**✅ DONE: Spin Lock Fixes**
- `src/lib/costs/events.ts` - Converted to async with proper `sleep()` function
  - Added `sleep(ms)` helper function
  - Made `appendEvent()` async with `await sleep(10)` instead of busy-wait
- `src/lib/costs/retention.ts` - Converted to async with proper `sleep()` function
  - Added `sleep(ms)` helper function
  - Made `cleanOldEvents()` async with `await sleep(100)` instead of busy-wait
- `src/lib/costs/migration.ts` - Updated to `await appendEvent()`

**✅ DONE: Migration Tests**
- Created `tests/lib/costs/migration.test.ts` (258 lines)
- Tests include:
  - Migration state persistence
  - Idempotency (skip if already complete)
  - Event aggregation after migration
  - (More tests in file)

### Acceptance Criteria Met
- [x] Cost queries <100ms (O(1) cache lookup)
- [x] Real-time hooks capture all usage
- [x] Subagent costs included
- [x] Historical migration on first run
- [x] Cache survives restarts
- [x] Manual rebuild via API
- [x] No session parsing on requests
- [x] **NEW** Spin locks replaced with async waits
- [x] **NEW** Migration safety tests written

## Remaining Work

### 1. Run Tests & Commit
```bash
npm test tests/lib/costs/migration.test.ts
git add -A
git commit -m "fix: replace spin locks with async waits and add migration tests (PAN-81)"
git push
```

### 2. Beads Tasks Still Open

- `panopticon-o1i` - Add status badge to MetricsSummary component
  - Types are added, need to render the badge in the UI
  - Show migration status, event count, cache stats

- `panopticon-3e8` - Update README with cost tracking documentation
  - Document the new architecture
  - Explain hooks, events, cache
  - Document API endpoints

## Files Modified (Uncommitted)

| File | Change |
|------|--------|
| `src/lib/costs/events.ts` | Async spin lock fix |
| `src/lib/costs/retention.ts` | Async spin lock fix |
| `src/lib/costs/migration.ts` | Await appendEvent |
| `tests/lib/costs/migration.test.ts` | NEW - migration tests |

## Architecture

```
Claude Response
     │
     ▼
cost-hook (bash)
     │
     ▼
events.jsonl (append-only)
     │
     ▼
aggregator.ts (incremental update)
     │
     ▼
by-issue.json (pre-computed cache)
     │
     ▼
/api/costs/by-issue (O(1) read)
```

## Notes

- TypeScript errors in `done.ts` and `issue.ts` are PRE-EXISTING, not from this PR
- See GitHub issue #112 for those fixes
- The core cost tracking is working - remaining work is polish and tests
- **Session crashed due to resume corruption** - restart fresh, work is saved in this STATE.md
