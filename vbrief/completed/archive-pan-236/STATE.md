# PAN-236: Add TLDR Session Metrics Tracking to Agent Cost Events

## Problem

The TLDR daemon runs and intercepts file reads, but there's zero visibility into:
- How often it fires (interceptions)
- How often it's bypassed (and why)
- How many tokens it saves
- Whether it's actually working during agent sessions

## Implementation Plan

### 1. TLDR interception counter in `src/lib/tldr-daemon.ts`
Add in-memory metrics accumulator tracking per-workspace:
- `interceptions`: number of times TLDR provided a summary instead of full file read
- `bypasses`: number of times TLDR was skipped (with reason)
- `estimatedTokensSaved`: rough estimate based on `(fullFileTokens - tldrTokens)` per interception
- `filesAnalyzed`: unique files summarized in this session

Export `getTldrMetrics(workspacePath: string): TldrSessionMetrics` and `resetTldrMetrics(workspacePath: string)`.

### 2. Extend `CostEvent` in `src/lib/costs/events.ts`
Add optional TLDR fields (backward compatible):
```typescript
tldrInterceptions?: number;
tldrBypasses?: number;
tldrTokensSaved?: number;
tldrBypassReasons?: Record<string, number>;
```

### 3. Attach metrics when recording cost events
In the cost recording flow, call `getTldrMetrics()` to snapshot and attach TLDR counters, then reset accumulators (delta tracking, not cumulative).

### 4. Surface in agent status
Add TLDR metrics to agent status response used by `pan status` and dashboard.

## Files to Modify

- `src/lib/tldr-daemon.ts` — Add metrics accumulator and exports
- `src/lib/costs/events.ts` — Extend CostEvent interface
- `src/lib/costs/index.ts` — Wire metrics into cost event recording
- `src/lib/agents.ts` — Include TLDR metrics in agent status
- `scripts/record-cost-event.js` — Attach TLDR metrics when recording

## Current Status

**COMPLETE** — All changes implemented, 13 tests pass, committed and pushed.

## Remaining Work

None. Implementation complete.
