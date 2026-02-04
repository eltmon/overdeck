# Cost Tracking System (PAN-81)

## Overview

Panopticon now uses an event-sourced architecture for cost tracking, providing:
- ⚡ **Fast queries** - <100ms instead of 5-30 seconds
- 📊 **Per-model breakdown** - See costs by Claude model (Sonnet, Opus, Haiku)
- 🔄 **Real-time updates** - Live cost tracking as agents work
- 🎯 **Subagent costs** - Now includes nested subagent costs (previously missed)
- 💰 **Budget tracking** - Set and monitor budgets per issue
- 🌐 **Multi-provider** - Support for Anthropic, OpenAI, and Google

## Architecture

### Event-Sourced Design

Instead of re-parsing session files on every request, costs are recorded in real-time and cached:

```
┌─────────────────┐     ┌──────────────────────┐
│  Claude Code    │────▶│   heartbeat-hook     │
│  (agent)        │     │  (PostToolUse)       │
└─────────────────┘     └──────────┬───────────┘
                                   │ writes
                                   ▼
                        ┌──────────────────────┐
                        │ ~/.panopticon/costs/ │
                        │  events.jsonl        │  ← Append-only log
                        │  by-issue.json       │  ← Pre-computed cache
                        └──────────┬───────────┘
                                   │ reads (O(1))
                                   ▼
                        ┌──────────────────────┐
                        │  Dashboard API       │
                        │  /api/costs/by-issue │
                        └──────────────────────┘
```

### Components

1. **events.jsonl** - Append-only event log
   - Location: `~/.panopticon/costs/events.jsonl`
   - Each line is a JSON cost event
   - Includes: timestamp, issue, agent, model, provider, tokens, cost

2. **by-issue.json** - Pre-computed cache
   - Location: `~/.panopticon/costs/by-issue.json`
   - Fast O(1) lookups by issue
   - Includes per-model breakdown, provider costs, budget status

3. **heartbeat-hook** - Real-time cost recording
   - Fires after every Claude API call
   - Extracts token usage and calculates cost
   - Appends event to events.jsonl

4. **Migration** - One-time historical import
   - Parses existing session files on first run
   - Includes subagent sessions (previously missed)
   - Best-effort: continues on errors

## Setup

### Initial Setup

The cost tracking system is automatically initialized when you start the dashboard. On first run:

1. **Migration runs automatically** - Historical session data is imported
2. **Cache is built** - by-issue.json is created
3. **Hook is activated** - New costs are tracked in real-time

### Manual Migration

If you need to rebuild the cache:

```bash
# Via API
curl -X POST http://localhost:3001/api/costs/rebuild

# Or restart the dashboard (migration runs if needed)
pan dashboard
```

## API Endpoints

### GET /api/costs/by-issue

Returns costs grouped by issue with full breakdown.

**Response:**
```json
{
  "status": "live",
  "lastEventTs": "2026-02-03T20:00:00Z",
  "eventCount": 1234,
  "issues": [
    {
      "issueId": "PAN-81",
      "totalCost": 107.60,
      "inputTokens": 30000000,
      "outputTokens": 8000000,
      "cacheReadTokens": 24947,
      "cacheWriteTokens": 1000,
      "models": {
        "claude-sonnet-4": {
          "cost": 95.0,
          "calls": 150,
          "tokens": 25000000
        },
        "claude-haiku-4.5": {
          "cost": 12.6,
          "calls": 200,
          "tokens": 12500000
        }
      },
      "providers": {
        "anthropic": 107.60,
        "openai": 0,
        "google": 0
      },
      "budget": 150.00,
      "budgetWarning": false,
      "lastUpdated": "2026-02-03T19:30:00Z"
    }
  ]
}
```

### GET /api/issues/:id/costs

Returns costs for a specific issue.

**Response:**
```json
{
  "issueId": "PAN-81",
  "totalCost": 107.60,
  "totalTokens": 38024947,
  "inputTokens": 30000000,
  "outputTokens": 8000000,
  "cacheReadTokens": 24947,
  "cacheWriteTokens": 1000,
  "models": { ... },
  "providers": { ... },
  "budget": 150.00,
  "budgetWarning": false
}
```

### POST /api/costs/rebuild

Manually trigger migration and cache rebuild.

**Response:**
```json
{
  "success": true,
  "message": "Cost cache rebuilt successfully",
  "migration": {
    "eventsCreated": 1234,
    "totalCost": 543.21,
    "errors": 0,
    "warnings": 0
  },
  "cache": {
    "issueCount": 45,
    "eventCount": 1234,
    "lastEventTs": "2026-02-03T20:00:00Z"
  }
}
```

### GET /api/costs/stream

Returns recent cost events for real-time updates.

**Query Parameters:**
- `since` - ISO timestamp, only return events after this time
- `limit` - Max events to return (default: 50)

**Response:**
```json
{
  "events": [
    {
      "ts": "2026-02-03T20:00:00Z",
      "model": "claude-sonnet-4",
      "provider": "anthropic",
      "cost": 0.0234,
      "tokens": 5000
    }
  ],
  "byIssue": {
    "PAN-81": [ ... ]
  },
  "count": 50
}
```

## Budget Tracking

### Setting Budgets

Budgets are set per issue in the cache file or via the dashboard UI.

**Budget States:**
- **Good** (0-79% used) - Green indicator
- **Warning** (80-99% used) - Yellow indicator, `budgetWarning: true`
- **Over** (100%+ used) - Red indicator

**Note:** Budgets are tracking only - they do NOT block agent execution.

## Data Retention

Events are retained for **90 days** by default. Older events are automatically pruned.

**Retention Settings:**
- Location: `~/.panopticon/costs/by-issue.json`
- Field: `retentionDays` (default: 90)
- Pruning: Automatic, runs daily

## Troubleshooting

### Dashboard shows "Stale" status

This means the cache is out of sync with the event log.

**Solution:**
```bash
curl -X POST http://localhost:3001/api/costs/rebuild
```

### Costs seem too low

Check if historical data was migrated:
1. Check `~/.panopticon/costs/events.jsonl` exists
2. Check event count in dashboard
3. Manually rebuild if needed

### Missing subagent costs

Subagent costs should now be included. If they're missing:
1. Ensure you're running the latest version with PAN-81
2. Rebuild the cache to re-import historical data
3. Check that hooks are installed: `pan setup hooks`

### Migration errors

Migration is best-effort and logs warnings for corrupted files. Check logs:
- Dashboard console output
- `~/.panopticon/costs/by-issue.json` status field

## File Locations

```
~/.panopticon/costs/
  ├── events.jsonl          # Append-only event log
  └── by-issue.json         # Pre-computed cache

~/.panopticon/bin/
  ├── heartbeat-hook        # Updated with cost tracking
  └── record-cost-event.js  # Cost recording script

~/.claude/projects/
  └── -<workspace>/         # Session files (legacy)
      ├── *.jsonl           # Main session files
      └── subagents/*.jsonl # Subagent session files
```

## Performance Comparison

| Metric | Before (Session Parsing) | After (Event-Sourced) |
|--------|-------------------------|----------------------|
| Query time | 5-30 seconds | <100ms |
| I/O per request | Read 100MB+ | Read ~10KB |
| Subagent costs | ❌ Missing | ✅ Included |
| Per-model breakdown | ❌ No | ✅ Yes |
| Real-time updates | ❌ No | ✅ Yes |
| Scales with history | ❌ Gets slower | ✅ Constant time |

## Implementation Details

For implementation details, see:
- `src/lib/costs/` - Core cost tracking modules
- `src/dashboard/server/index.ts` - API endpoints
- `src/dashboard/frontend/src/components/CostsPage.tsx` - UI component
- `scripts/heartbeat-hook` - Real-time cost recording
- `scripts/record-cost-event.js` - Cost calculation logic

## Related Issues

- **PAN-105**: Per-model cost breakdown in API responses (enabled by PAN-81)
