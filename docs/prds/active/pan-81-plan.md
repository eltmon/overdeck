# PAN-81: Event-Sourced Cost Tracking

## Status: PLANNING COMPLETE

## Problem Statement

The `/api/costs/by-issue` endpoint re-parses ALL Claude Code session files on EVERY request, causing:
- Dashboard freezes with large workspaces (100M+ tokens)
- Unnecessary I/O load
- Slow cost queries (5-30 seconds)
- **Subagent costs not counted** (nested `<session>/subagents/*.jsonl` files missed)

## Solution: Event-Sourced Architecture

### Core Components

1. **cost-hook** (new script) - Records token usage after each Claude response
2. **events.jsonl** - Append-only event log
3. **by-issue.json** - Pre-computed aggregation cache
4. **One-time migration** - Parse historical session files (including subagents)

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hook design | Separate `cost-hook` script | Cleaner separation from heartbeat, easier debugging |
| Migration | Non-blocking | Dashboard starts immediately, migration runs in background |
| Error handling | Silent failure + log error | Never break Claude Code, reconciliation catches missed events |
| UI indicator | Status badge | Show "Live" vs "Migrating" vs "Stale" on cost displays |
| Fallback mode | Clean break | No dual-mode complexity, force migration |
| Event retention | Rolling 90 days | Archive old events, preserve aggregates |
| Feature flag | None | Ship as new default immediately |

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│  Claude Code    │────▶│    cost-hook         │
│  (main agent)   │     │  (PostToolUse)       │
└─────────────────┘     └──────────┬───────────┘
                                   │
┌─────────────────┐                │  writes
│  Claude Code    │────▶───────────┤
│  (subagent)     │                ▼
└─────────────────┘     ┌──────────────────────┐
                        │ ~/.panopticon/costs/ │
                        │  events.jsonl        │
                        │  by-issue.json       │
                        └──────────┬───────────┘
                                   │ reads
                                   ▼
                        ┌──────────────────────┐
                        │  Dashboard API       │
                        │  /api/costs/by-issue │ ◀── O(1) lookup
                        └──────────────────────┘
```

## Data Formats

### Event Log (`~/.panopticon/costs/events.jsonl`)
```jsonl
{"ts":"2026-01-23T15:30:00","agent":"agent-pan-74","input":1234,"output":567,"cache_read":890,"cache_write":100,"model":"claude-sonnet-4"}
{"ts":"2026-01-23T15:31:05","agent":"agent-pan-74-subagent-aa82e20","input":500,"output":100,"cache_read":200,"cache_write":0,"model":"claude-haiku-4-5"}
```

### Aggregation Cache (`~/.panopticon/costs/by-issue.json`)
```json
{
  "version": 2,
  "status": "live",
  "lastEventTs": "2026-01-23T15:31:00",
  "lastEventLine": 4523,
  "retentionDays": 90,
  "issues": {
    "pan-74": {
      "totalCost": 107.60,
      "inputTokens": 30000000,
      "outputTokens": 8000000,
      "cacheReadTokens": 24947,
      "cacheWriteTokens": 1000,
      "models": {"claude-sonnet-4": 95.00, "claude-haiku-4-5": 12.60},
      "lastUpdated": "2026-01-23T15:30:00"
    }
  }
}
```

### Error Log (`~/.panopticon/costs/errors.log`)
```
2026-01-23T15:30:00 ERROR: Failed to parse usage JSON: <error details>
2026-01-23T15:31:00 ERROR: Missing agent ID in environment
```

## Files to Create/Modify

### New Files
- `src/lib/costs/events.ts` - Event log read/write
- `src/lib/costs/aggregator.ts` - Cache management, incremental updates
- `src/lib/costs/migration.ts` - One-time historical parsing
- `src/lib/costs/retention.ts` - 90-day rolling cleanup
- `src/lib/costs/index.ts` - Module exports
- `scripts/cost-hook` - Bash hook script

### Modified Files
- `src/cli/commands/setup/hooks.ts` - Register cost-hook
- `src/dashboard/server/index.ts` - Update endpoints, remove old parsing
- `src/dashboard/frontend/src/components/MetricsSummary.tsx` - Status badge
- `README.md` - Document new cost tracking system

## Performance Targets

| Metric | Before | After |
|--------|--------|-------|
| Cost query time | 5-30 seconds | <100ms |
| I/O per request | Read 100MB+ | Read ~10KB |
| CPU per request | Parse millions of lines | Zero parsing |
| Scales with history | Gets slower | Constant time |
| Subagent costs | Missing | Included |

## Acceptance Criteria

- [ ] Cost queries complete in <100ms regardless of history size
- [ ] New token usage recorded in real-time via cost-hook
- [ ] Subagent costs included (hooks fire for subagents too)
- [ ] Historical data migrated on first run (including subagent sessions)
- [ ] **Migration tests verify no data loss** (compare old vs new totals)
- [ ] Cache survives dashboard restarts
- [ ] Manual rebuild available via API (`/api/costs/rebuild`)
- [ ] Status badge shows "Live" / "Migrating" / "Stale"
- [ ] Events older than 90 days archived/deleted
- [ ] No session file parsing on normal requests
- [ ] README updated with cost tracking documentation

## Migration Safety Tests (CRITICAL)

The migration process MUST NOT lose data. Tests should verify:

1. **Parity Test**: Run both old and new cost calculation on same data, verify totals match
2. **Subagent Inclusion**: Old code missed subagents - new code should include them (totals will be HIGHER)
3. **Empty State**: Migration on fresh install with no history should work cleanly
4. **Partial State**: Migration should handle partially-migrated state (crash recovery)
5. **Idempotency**: Running migration twice should produce same results

```typescript
// Test: Migration produces correct totals
describe('migration', () => {
  it('should match old calculation for sessions without subagents', async () => {
    const oldTotal = await legacyParseWorkspaceUsage(workspace);
    await runMigration();
    const newTotal = await getCachedCosts(issueId);
    expect(newTotal.tokenCount).toBeGreaterThanOrEqual(oldTotal.tokenCount);
  });

  it('should include subagent costs in total', async () => {
    // Create mock workspace with main session + subagent sessions
    const result = await runMigration();
    expect(result.subagentTokens).toBeGreaterThan(0);
  });

  it('should be idempotent', async () => {
    await runMigration();
    const first = await getCachedCosts(issueId);
    await runMigration();
    const second = await getCachedCosts(issueId);
    expect(first).toEqual(second);
  });
});
```

## Out of Scope

- Real-time cost notifications/alerts
- Cost budgets/limits
- Per-model cost breakdown in UI (aggregates only)
- Export/import of cost data
