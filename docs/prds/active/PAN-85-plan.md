# PAN-85: Archive old agent directories after cost tracking refactor

## Current State Analysis

### Problem
- **748 agent directories** in `~/.panopticon/agents/` (includes agent-*, planning-*, specialist-*, test-*, etc.)
- These accumulate indefinitely after work completes
- Directories dating back to Jan 20 (5+ days old)

### Blocker Status: RESOLVED ✓
**PAN-81** (Event-sourced cost tracking) is **CLOSED**. Infrastructure exists:
- `~/.panopticon/costs/events.jsonl` - Real-time hook-based collection (63KB)
- `~/.panopticon/costs/by-issue.json` - Pre-computed aggregation cache
- Hook-based tracking captures costs without needing agent directories

**However**: `/api/costs/by-issue` endpoint NOT migrated yet - still parses workspace session files on every request (lines 7972-8080 in server/index.ts).

### Current Agent State Management

**AgentState interface** (`src/lib/agents.ts:65-81`):
```typescript
export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  runtime: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error'; // ❌ No 'completed'
  startedAt: string;
  lastActivity?: string;
  branch?: string;
  // Model routing fields...
}
```

**Health filtering** (`src/dashboard/lib/health-filtering.ts:69`):
- Already filters out `status: 'stopped'` or `status: 'completed'` agents
- But type doesn't include 'completed' yet!

### Health Dashboard UI
- Location: `src/dashboard/frontend/src/components/HealthDashboard.tsx`
- Shows agent health cards with status badges
- No archive/cleanup button currently

## Decisions Made ✓

### 1. Cleanup Strategy: **Delete Permanently**
- No archive directory - simply remove old agent directories
- Cost data is safe in `~/.panopticon/costs/events.jsonl`
- Simpler implementation, no disk bloat from archives

### 2. Age Threshold: **7 Days (Configurable)**
- Default: 7 days (weekly cleanup)
- Configurable via `~/.panopticon.env`: `CLEANUP_AGENT_DAYS=7`
- Can be overridden in dashboard or via CLI flag

### 3. Directory Types to Clean
**Will clean**:
- `agent-*` - Regular work agents
- `planning-*` - Planning agents
- `specialist-*` - Specialist agents (review, test, merge)
- `test-agent-*` - Test artifacts

**Will NOT clean**:
- `main-cli` - Main CLI agent state
- Non-prefixed directories (legacy singletons without timestamps)

### 4. Cleanup Triggers: **Both Auto + Manual**
- **Auto-cleanup**: On dashboard startup (background, non-blocking)
- **Manual button**: "Clean Old Agents" in Health Dashboard UI
- Auto-cleanup logs what was deleted

### 5. Status Marking: **Add 'completed' Status**
- Add `'completed'` to AgentState status union type
- Mark agents completed via:
  - `pan work done` command
  - When Linear issue moves to "Done" (if auto-tracking enabled)
  - Explicit API call from dashboard

### 6. Cost Endpoint Migration: **Yes, Include It**
- Migrate `/api/costs/by-issue` to read from `by-issue.json`
- Eliminates last dependency on parsing agent directories
- Completes PAN-81's vision
- Performance win: <10ms vs 5-30 seconds

## Related Files

### Need to Modify
- `src/lib/agents.ts` - Add 'completed' status, mark agents completed
- `src/dashboard/frontend/src/components/HealthDashboard.tsx` - Add archive button
- `src/dashboard/server/index.ts` - Add archive API endpoint
- New file: `src/lib/cleanup.ts` - Archive/cleanup logic

### Maybe Modify
- `src/dashboard/server/index.ts` (lines 7972-8080) - Migrate cost endpoint to use by-issue.json
- `src/cli/commands/work/done.ts` - Mark agent completed when done
- Dashboard settings UI - Add age threshold config

## Implementation Plan

### Phase 1: Core Infrastructure (Simple)
**Task 1.1**: Add 'completed' status to AgentState type
- File: `src/lib/agents.ts`
- Change: `status: 'starting' | 'running' | 'stopped' | 'error' | 'completed'`
- Difficulty: **trivial**

**Task 1.2**: Create cleanup logic module
- New file: `src/lib/cleanup.ts`
- Functions:
  - `getOldAgentDirs(ageThresholdDays: number): string[]` - Find agents older than threshold
  - `shouldCleanAgent(dirName: string, state: AgentState | null): boolean` - Check if cleanable
  - `cleanupOldAgents(ageThresholdDays: number, dryRun: boolean): Promise<CleanupResult>`
- Pattern matching: `agent-*`, `planning-*`, `specialist-*`, `test-agent-*`
- Exclude: `main-cli`, singletons without prefixes
- Difficulty: **simple**

**Task 1.3**: Add config support for age threshold
- File: `src/lib/paths.ts` or `src/lib/config.ts`
- Read `CLEANUP_AGENT_DAYS` from `~/.panopticon.env` (default: 7)
- Difficulty: **trivial**

### Phase 2: Cost Endpoint Migration (Medium)
**Task 2.1**: Migrate `/api/costs/by-issue` to read from cache
- File: `src/dashboard/server/index.ts` (lines 7972-8080)
- Change from: Parse all agent workspace sessions
- Change to: Read `~/.panopticon/costs/by-issue.json`
- Fallback: Legacy session-map.json for historical data
- Performance: <10ms instead of 5-30s
- Difficulty: **medium** (needs careful testing, fallback logic)

**Task 2.2**: Add cache rebuild endpoint (optional)
- New endpoint: `POST /api/costs/rebuild`
- Manually trigger re-aggregation from events.jsonl
- Admin/debug feature
- Difficulty: **simple**

### Phase 3: Manual Cleanup UI (Medium)
**Task 3.1**: Add cleanup button to Health Dashboard
- File: `src/dashboard/frontend/src/components/HealthDashboard.tsx`
- Add button: "Clean Old Agents (7+ days)"
- Shows count of cleanable agents before cleanup
- Confirmation dialog with list of agents to delete
- Difficulty: **medium** (UI + confirmation flow)

**Task 3.2**: Add cleanup API endpoint
- File: `src/dashboard/server/index.ts`
- Endpoint: `POST /api/agents/cleanup`
- Body: `{ dryRun?: boolean, ageThresholdDays?: number }`
- Returns: `{ deleted: string[], count: number, dryRun: boolean }`
- Difficulty: **simple**

### Phase 4: Auto-Cleanup (Simple)
**Task 4.1**: Add auto-cleanup on dashboard startup
- File: `src/dashboard/server/index.ts` (startup logic)
- Run `cleanupOldAgents()` in background after server starts
- Non-blocking, catches errors
- Logs what was deleted
- Difficulty: **simple**

**Task 4.2**: Mark agents completed via `pan work done`
- File: `src/cli/commands/work/done.ts`
- After marking Linear issue as done, update agent state to 'completed'
- Difficulty: **simple**

### Phase 5: Testing (Medium)
**Task 5.1**: Add cleanup tests
- Test file: `src/lib/__tests__/cleanup.test.ts`
- Test age filtering, pattern matching, dry run
- Difficulty: **medium**

**Task 5.2**: E2E test for cleanup flow
- Dashboard test: Manual cleanup button
- CLI test: Auto-cleanup on startup
- Verify cost data still accessible after cleanup
- Difficulty: **medium**

## Acceptance Criteria

- [ ] Agent directories older than 7 days can be deleted
- [ ] Cleanup respects pattern filters (agent-*, planning-*, specialist-*, test-agent-*)
- [ ] Cleanup button in Health Dashboard with confirmation dialog
- [ ] Auto-cleanup runs on dashboard startup (background)
- [ ] Cost queries use by-issue.json cache (<100ms)
- [ ] Cost data remains accessible after agent cleanup
- [ ] Config: `CLEANUP_AGENT_DAYS` in `~/.panopticon.env`
- [ ] Completed agents marked via `pan work done`
- [ ] Tests cover cleanup logic and patterns

## Risk Analysis

### Low Risk
- Adding 'completed' status (additive change, no breaking)
- Config for age threshold (optional, has default)
- Manual cleanup button (user-triggered, has confirmation)

### Medium Risk
- Cost endpoint migration (high traffic, needs fallback)
  - Mitigation: Keep legacy session-map fallback
  - Test: Verify all cost queries work after migration
- Auto-cleanup on startup (could delete active work if logic wrong)
  - Mitigation: Conservative age threshold (7 days)
  - Mitigation: Check agent status before deletion

### Edge Cases
- Agent directory exists but state.json missing → Check tmux session before deleting
- Agent marked 'stopped' but recently active → Use lastActivity timestamp
- Planning agent still in use → Check for active tmux session
