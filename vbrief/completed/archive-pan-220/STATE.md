# PAN-220: Metrics Dashboard Improvements — TLDR Stats, Cost Accuracy, Label Clarity

## Problem

The metrics dashboard had four issues:
1. **Race condition** in `record-cost-event.js` causing duplicate cost events (~39% phantom costs)
2. **Duplicate route** — stub `/api/costs/summary` at line 4801 shadowed the real implementation, returning $0
3. **Label ambiguity** — "Cost Today" uses UTC midnight but didn't say so
4. **TLDR stats missing** — `TldrServiceStatus` component existed but wasn't integrated into the metrics page

## Implementation

### Fix 1: Race Condition (scripts/heartbeat-hook)

Added per-session `flock -x` around the `node record-cost-event.js` call. Claude Code fires parallel tool calls, spawning multiple heartbeat-hook processes that race on the same transcript offset file. `flock -x -w 30` serializes them, ensuring only one process reads/processes/updates the offset at a time.

**File:** `scripts/heartbeat-hook`

### Fix 2: Duplicate /api/costs/summary Route (src/dashboard/server/index.ts)

Removed the stub endpoint at the old location (line 4801) that returned all zeros. Express uses the first matching route, so the stub was always served instead of the correct implementation at line 11065.

**File:** `src/dashboard/server/index.ts`

### Fix 3: Event Deduplication (src/lib/costs/events.ts + index.ts + server)

Added `deduplicateEvents()` function that removes events caused by the historical race condition. Deduplication key: `agentId|issueId|model|input|output|cacheRead|cacheWrite`. Events within 60 seconds of the last kept event for the same key are considered race-condition duplicates and removed.

Exposed via `POST /api/costs/deduplicate` endpoint.

### Fix 4: Label Clarification

Changed "Cost Today" → "Cost Today (UTC)" in:
- `MetricsSummary.tsx`
- `MetricsPage.tsx`

### Fix 5: TLDR Stats Integration (MetricsPage.tsx)

Imported `TldrServiceStatus` and added a "Services" section to the metrics page that shows TLDR daemon status, health, and workspace daemon count.

## Files Modified

| File | Change |
|------|--------|
| `scripts/heartbeat-hook` | Added flock serialization around cost recording |
| `src/dashboard/server/index.ts` | Removed stub /api/costs/summary, added /api/costs/deduplicate, added deduplicateEvents import |
| `src/lib/costs/events.ts` | Added deduplicateEvents() |
| `src/lib/costs/index.ts` | Export deduplicateEvents |
| `src/dashboard/frontend/src/components/MetricsSummary.tsx` | "Cost Today (UTC)" label |
| `src/dashboard/frontend/src/components/MetricsPage.tsx` | "Cost Today (UTC)" label + TldrServiceStatus |
| `src/lib/costs/__tests__/events.test.ts` | New tests for deduplicateEvents |

## Current Status

**COMPLETE** — All changes implemented, tests pass (only pre-existing specialist-logs.test.ts failure unrelated to this PR).

## Remaining Work

None. Implementation complete.

## Specialist Feedback

- **[2026-02-21T14:11Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/006-review-agent-changes-requested.md`
