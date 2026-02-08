# Planning Session: PAN-81

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-81
- **Title:** Event-sourced cost tracking: eliminate redundant session file parsing
- **URL:** https://github.com/eltmon/panopticon-cli/issues/81

## Description
## Problem

The `/api/costs/by-issue` endpoint re-parses ALL Claude Code session files on EVERY request:

1. Iterates through ~20+ agent directories
2. For each agent, reads ALL JSONL files in `~/.claude/projects/<workspace>/`
3. Parses EVERY line to extract token counts
4. Sums everything up

With workspaces accumulating 100M+ tokens of history (MYN has 188M tokens), this causes:
- Dashboard freezes (fixed partially by making it async in ce32ecf)
- Unnecessary I/O load
- Slow cost queries
- Redundant work on every request

### Additional Gap: Subagent Costs Not Included

**Current cost calculation misses subagent token usage entirely.**

Claude Code stores subagent sessions in a nested structure:
```
~/.claude/projects/-home-eltmon-projects/
├── e26dba74-xxxx.jsonl                    # Main session (✓ counted)
└── e26dba74-xxxx/
    └── subagents/
        └── agent-aa82e20.jsonl            # Subagent session (✗ NOT counted!)
```

The `parseWorkspaceSessionUsageAsync` function only reads top-level `.jsonl` files:
```typescript
const allFiles = await readdir(sessionDir);
const files = allFiles.filter(f => f.endsWith('.jsonl'));  // Only top-level!
```

**Impact:** When review-agent spawns `code-review-performance`, `code-review-security`, or other subagents, those Haiku model calls are logged by Claude Code but never aggregated in cost reports. This means we're under-counting actual costs.

## Solution: Event-Sourced Cost Tracking

Never parse session files during requests. Use hooks for real-time collection + pre-computed aggregations.

### Architecture

#### 1. Hook-Based Real-Time Collection

Extend the existing heartbeat hook (or add a sibling `cost-hook`) that fires after each Claude response:

```bash
# ~/.panopticon/bin/cost-hook
# Called by Claude Code after each response

# Extract usage from stdin (Claude Code provides this)
USAGE=$(cat)
INPUT_TOKENS=$(echo "$USAGE" | jq -r '.usage.input_tokens // 0')
OUTPUT_TOKENS=$(echo "$USAGE" | jq -r '.usage.output_tokens // 0')
CACHE_READ=$(echo "$USAGE" | jq -r '.usage.cache_read_input_tokens // 0')
CACHE_WRITE=$(echo "$USAGE" | jq -r '.usage.cache_creation_input_tokens // 0')
MODEL=$(echo "$USAGE" | jq -r '.model // "unknown"')

# Append to event log (append-only, never modify)
echo "{\"ts\":\"$(date -Iseconds)\",\"agent\":\"$AGENT_ID\",\"input\":$INPUT_TOKENS,\"output\":$OUTPUT_TOKENS,\"cache_read\":$CACHE_READ,\"cache_write\":$CACHE_WRITE,\"model\":\"$MODEL\"}" \
  >> ~/.panopticon/costs/events.jsonl
```

**Note:** This hook runs for BOTH main agents and subagents, capturing all costs uniformly.

**Event Log Format** (`~/.panopticon/costs/events.jsonl`):
```jsonl
{"ts":"2026-01-23T15:30:00","agent":"agent-pan-74","input":1234,"output":567,"cache_read":890,"cache_write":100,"model":"claude-sonnet-4"}
{"ts":"2026-01-23T15:31:00","agent":"agent-pan-75","input":2000,"output":300,"cache_read":500,"cache_write":0,"model":"claude-sonnet-4"}
{"ts":"2026-01-23T15:31:05","agent":"agent-pan-74-subagent-aa82e20","input":500,"output":100,"cache_read":200,"cache_write":0,"model":"claude-haiku-4-5"}
```

#### 2. Pre-Computed Aggregation Cache

Maintain a summary file updated incrementally when events are recorded:

**Aggregation Cache** (`~/.panopticon/costs/by-issue.json`):
```json
{
  "version": 2,
  "lastEventTs": "2026-01-23T15:31:00",
  "lastEventLine": 4523,
  "issues": {
    "pan-74": {
      "totalCost": 107.60,
      "inputTokens": 30000000,
      "outputTokens": 8000000,
      "cacheReadTokens": 24947,
      "cacheWriteTokens": 1000,
      "models": {"claude-sonnet-4": 95, "claude-opus-4": 5, "claude-haiku-4-5": 12},
      "lastUpdated": "2026-01-23T15:30:00"
    }
  }
}
```

**Dashboard reads this file directly** - O(1) lookup, zero parsing.

#### 3. One-Time Historical Migration

On first run (or when cache is missing), parse existing session files ONCE:

```typescript
async function migrateHistoricalCosts(): Promise<void> {
  // Check if migration already done
  if (existsSync(MIGRATION_MARKER)) return;
  
  // Parse all existing session files (one-time)
  // IMPORTANT: Include subagents/ subdirectories!
  for (const workspace of getAllWorkspaces()) {
    const usage = await parseWorkspaceSessionUsageAsync(workspace);
    const subagentUsage = await parseSubagentSessionsAsync(workspace);
    appendToAggregationCache(workspace.issueId, usage);
    appendToAggregationCache(workspace.issueId, subagentUsage);
  }
  
  // Mark migration complete
  writeFileSync(MIGRATION_MARKER, new Date().toISOString());
}
```

#### 4. Background Reconciliation (Optional)

Periodic job (e.g., daily) to verify cache integrity:

```typescript
// Run on dashboard startup or via cron
async function reconcileCosts(): Promise<void> {
  const cache = loadAggregationCache();
  const events = loadEventLog();
  
  // Replay events from lastEventLine to rebuild if needed
  // Compare with actual session files periodically
  // Log discrepancies but don't block requests
}
```

### Implementation Plan

1. **Create cost tracking module** (`src/lib/costs/`)
   - `events.ts` - Event log read/write
   - `aggregator.ts` - Cache management, incremental updates
   - `migration.ts` - One-time historical parsing (including subagents/)
   - `pricing.ts` - Model pricing constants (already exists partially)

2. **Add cost-tracking hook**
   - Extend `scripts/heartbeat-hook` or create `scripts/cost-hook`
   - Register in `pan setup hooks`
   - Hook runs for both main agents AND subagents

3. **Update dashboard endpoint**
   - `/api/costs/by-issue` reads from cache only
   - Add `/api/costs/rebuild` for manual reconciliation

4. **Migration on startup**
   - Dashboard checks for migration marker
   - If missing, runs one-time migration (async, non-blocking)
   - Migration includes `<session-id>/subagents/*.jsonl` files

### Benefits

| Metric | Before | After |
|--------|--------|-------|
| Cost query time | 5-30 seconds | <10ms |
| I/O per request | Read 100MB+ | Read 1 file (~10KB) |
| CPU per request | Parse millions of JSON lines | Zero parsing |
| Scales with history | Gets slower | Constant time |
| Subagent costs | ✗ Missing | ✓ Included |

### Files to Modify

- `src/lib/costs/` (new module)
- `scripts/cost-hook` (new)
- `src/cli/commands/setup/hooks.ts` (register new hook)
- `src/dashboard/server/index.ts` (update endpoint)

### Acceptance Criteria

- [ ] Cost queries complete in <100ms regardless of history size
- [ ] New token usage recorded in real-time via hooks
- [ ] **Subagent costs included** (hooks fire for subagents too)
- [ ] Historical data migrated on first run (including subagent sessions)
- [ ] Cache survives dashboard restarts
- [ ] Manual rebuild available via API
- [ ] No session file parsing on normal requests

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

When creating beads tasks, include difficulty labels:
```bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
```

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
3. Summarize the plan and STOP

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
