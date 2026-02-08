# PAN-81: Event-Sourced Cost Tracking

## Problem Statement

The `/api/costs/by-issue` endpoint re-parses ALL Claude Code session files on EVERY request:
- Iterates through ~20+ agent directories
- For each agent, reads ALL JSONL files in `~/.claude/projects/<workspace>/`
- Parses EVERY line to extract token counts
- Sums everything up

With workspaces accumulating 100M+ tokens of history, this causes dashboard freezes, unnecessary I/O, and slow queries.

**Additional gap:** Subagent costs are NOT included. Session files in `<session-id>/subagents/` are never parsed.

## Decisions Made

### 1. Real-Time Collection: Stop Hook + Transcript Parse
- Claude Code hooks do NOT provide token data on stdin
- The **Stop hook** fires after each Claude response and provides `transcript_path`
- Parse the transcript file (last few entries) to extract the latest `message.usage`
- Append to event log for aggregation

### 2. Historical Migration: All Existing Workspaces
- On first run, parse all `~/.claude/projects/` session files
- Include `<session-id>/subagents/*.jsonl` files for complete subagent costs
- Mark migration complete with a marker file

### 3. Issue Mapping: Agent State Files
- Use existing pattern: `~/.panopticon/agents/*/state.json` contains `issueId` + `workspace`
- Workspace path maps to Claude session directory

### 4. Unlinked Sessions: Track as "unassigned"
- Create an "unassigned" or "main-cli" bucket for costs not linked to any issue
- Provides full cost visibility

### 5. Implementation: Bash Hook Script
- Keep cost-tracking hook as simple bash script with jq (like `heartbeat-hook`)
- Fast, no Node startup time, matches existing pattern

## Out of Scope (Future Issues)

- **Cost alerts/notifications** - No alerts when costs exceed thresholds
- **Per-model breakdown in API** - Don't add model-level detail to response yet
- **Cost prediction/estimation** - No estimated remaining costs for in-progress work

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                          │
│                                                                     │
│  1. Agent works, usage logged to transcript                         │
│  2. Stop hook fires with transcript_path                            │
│  3. Hook parses last entries, extracts usage                        │
│  4. Appends to ~/.panopticon/costs/events.jsonl                     │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Event Log (append-only)                        │
│  ~/.panopticon/costs/events.jsonl                                   │
│                                                                     │
│  {"ts":"...","agent":"agent-pan-74","model":"sonnet","input":1234,  │
│   "output":567,"cache_read":890,"cache_write":100}                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Aggregation Cache (pre-computed)                │
│  ~/.panopticon/costs/by-issue.json                                  │
│                                                                     │
│  {"issues": {"pan-74": {"totalCost": 107.60, "inputTokens": 30M}}}  │
│                                                                     │
│  Dashboard reads THIS file - O(1) lookup, zero parsing              │
└─────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
~/.panopticon/costs/
├── events.jsonl           # Append-only event log from hooks
├── by-issue.json          # Pre-computed aggregations (dashboard reads this)
├── migration-complete     # Marker file (timestamp of migration)
└── last-event-line        # Tracks position in events.jsonl for incremental aggregation
```

### Event Format

```jsonl
{"ts":"2026-01-25T10:30:00Z","agent":"agent-pan-81","issue":"pan-81","model":"claude-sonnet-4","input":1234,"output":567,"cache_read":890,"cache_write":100}
```

### Aggregation Cache Format

```json
{
  "version": 1,
  "lastUpdated": "2026-01-25T10:30:00Z",
  "lastEventLine": 4523,
  "issues": {
    "pan-81": {
      "totalCost": 12.50,
      "inputTokens": 5000000,
      "outputTokens": 1200000,
      "cacheReadTokens": 3000000,
      "cacheWriteTokens": 100000,
      "sessionCount": 3,
      "lastUpdated": "2026-01-25T10:30:00Z"
    },
    "unassigned": {
      "totalCost": 5.00,
      ...
    }
  }
}
```

## Implementation Plan

### Phase 1: Cost Tracking Module
Create `src/lib/costs/` module with:
- `events.ts` - Event log read/append utilities
- `aggregator.ts` - Cache management, incremental updates
- `migration.ts` - One-time historical parsing
- `pricing.ts` - Model pricing (move from server/index.ts)

### Phase 2: Stop Hook for Cost Collection
- Create `scripts/cost-hook` (bash script)
- Receives `transcript_path` via stdin
- Parses last few JSONL entries for usage
- Appends to events.jsonl
- Register in `pan setup hooks`

### Phase 3: Dashboard Endpoint Update
- `/api/costs/by-issue` reads from pre-computed cache only
- Add `/api/costs/rebuild` for manual reconciliation
- Migration runs on startup if needed (async, non-blocking)

### Phase 4: Subagent Support
- Hook also fires for SubagentStop (uses `agent_transcript_path`)
- Migration includes `<session-id>/subagents/*.jsonl` files

## Acceptance Criteria

- [ ] Cost queries complete in <100ms regardless of history size
- [ ] New token usage recorded in real-time via Stop hook
- [ ] Subagent costs included (hooks fire for subagents too)
- [ ] Historical data migrated on first run (including subagent sessions)
- [ ] Cache survives dashboard restarts
- [ ] Manual rebuild available via API
- [ ] No session file parsing on normal requests
- [ ] "unassigned" bucket for non-agent usage

## Files to Modify/Create

**New files:**
- `src/lib/costs/events.ts`
- `src/lib/costs/aggregator.ts`
- `src/lib/costs/migration.ts`
- `src/lib/costs/pricing.ts`
- `src/lib/costs/index.ts`
- `scripts/cost-hook`

**Modified files:**
- `src/dashboard/server/index.ts` - Update `/api/costs/by-issue`, add `/api/costs/rebuild`
- `src/cli/commands/setup/hooks.ts` - Register cost-hook

## Beads Tasks (Ordered by Dependency)

| ID | Task | Difficulty | Blocked By |
|----|------|------------|------------|
| `panopticon-qkr` | Create cost tracking module with pricing constants | simple | - |
| `panopticon-fm0` | Create cost-hook bash script for Stop event | medium | qkr |
| `panopticon-e2j` | Implement historical cost migration | complex | qkr |
| `panopticon-06z` | Register cost-hook in setup hooks command | simple | fm0 |
| `panopticon-b3t` | Handle SubagentStop hook for subagent costs | simple | fm0 |
| `panopticon-lbz` | Update /api/costs/by-issue to use pre-computed cache | medium | fm0, e2j |

**Ready to start:** `panopticon-qkr` (cost module)

**Note:** There are duplicate tasks from earlier planning sessions - the implementing agent should close any duplicates.

## Future Issues (Out of Scope)

Created as GitHub Issues:
- [PAN-104](https://github.com/eltmon/panopticon-cli/issues/104) - Cost alerts/notifications
- [PAN-105](https://github.com/eltmon/panopticon-cli/issues/105) - Per-model cost breakdown
- [PAN-106](https://github.com/eltmon/panopticon-cli/issues/106) - Cost prediction/estimation
