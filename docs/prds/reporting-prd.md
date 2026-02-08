# Panopticon Reporting & Metrics PRD

**Status:** In Progress
**Created:** 2026-01-19
**Related PRD Sections:** Part 6 (Multi-Runtime), Part 15 (Cost Tracking)

## Overview

This PRD consolidates the reporting, metrics, and cost tracking requirements that are partially implemented but not integrated into the dashboard UI.

## Current State Analysis

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| Cost calculation logic | `src/lib/cost.ts` | ✅ Complete |
| Cost CLI commands | `src/cli/commands/cost.ts` | ✅ Complete |
| Model pricing data | `src/lib/cost.ts:DEFAULT_PRICING` | ✅ Complete |
| Budget management | `src/lib/cost.ts` (budgets) | ✅ Complete |
| Runtime interface | `src/lib/runtime/interface.ts` | ✅ Complete |
| Runtime adapters | `src/lib/runtime/claude.ts`, etc. | ✅ Complete |

### What's Missing

| Requirement | PRD Section | Status |
|-------------|-------------|--------|
| Kanban card cost badges | Part 15 | ❌ Not Implemented |
| Issue detail cost breakdown | Part 15 | ❌ Not Implemented |
| JSONL session parsing | Part 15 | ❌ Not Implemented |
| Runtime metrics tracking | Part 6 | ❌ Not Implemented |
| RuntimeComparison dashboard | Part 6 | ❌ Not Implemented |
| Session-to-issue cost linking | Part 15 | ❌ Not Implemented |
| Real-time cost during agent work | Part 15 | ❌ Not Implemented |
| Cost API endpoints | Part 15 | ❌ Not Implemented |

---

## Requirements

### 1. Per-Issue Cost Display

**Goal:** Show total AI cost for each issue on Kanban cards and in issue details.

#### 1.1 Kanban Card Cost Badge

Display a cost badge on each Kanban card showing total cost for that issue.

```typescript
// IssueCard should show:
<span className="cost-badge">$2.47</span>
```

**Design:**
- Badge shows `$X.XX` format
- Color coding:
  - Green: < $5
  - Yellow: $5-$20
  - Orange: $20-$50
  - Red: > $50
- Tooltip shows breakdown: "3 sessions, 1.2M tokens"

#### 1.2 Issue Detail Panel Cost Section

Add a "Cost" section to `IssueDetailPanel.tsx` showing:

```
## Cost Summary
Total: $2.47

By Session:
- Planning (opus): $0.85 - 45K tokens
- Implementation (sonnet): $1.12 - 120K tokens
- Review (haiku): $0.50 - 80K tokens

By Model:
- claude-opus-4: $0.85 (34%)
- claude-sonnet-4: $1.12 (45%)
- claude-haiku-4.5: $0.50 (21%)
```

---

### 2. Claude Code JSONL Parsing

**Goal:** Extract actual token usage from Claude Code session files.

#### 2.1 Session File Location

Claude Code stores session data at:
```
~/.claude/projects/<project-path-hash>/<session-id>.jsonl
```

#### 2.2 JSONL Message Format

```json
{
  "sessionId": "037ae6b1-826d-4b2f-ae80-9b467abb7e43",
  "timestamp": "2026-01-17T10:30:00.000Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "usage": {
      "input_tokens": 1500,
      "output_tokens": 500,
      "cache_creation_input_tokens": 30000,
      "cache_read_input_tokens": 10000
    }
  }
}
```

#### 2.3 Parser Implementation

Create `src/lib/cost/jsonl-parser.ts`:

```typescript
interface ClaudeUsageMessage {
  sessionId: string;
  timestamp: string;
  message: {
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export function parseClaudeSession(sessionFile: string): TokenUsage;
export function getSessionFiles(projectPath: string): string[];
export function linkSessionToIssue(sessionId: string, issueId: string): void;
```

---

### 3. Session-to-Issue Linking

**Goal:** Track which Claude Code sessions belong to which issues.

#### 3.1 Linking Mechanism

When `pan work issue` spawns an agent:
1. Record the Claude Code session ID in agent state
2. Store mapping in `~/.panopticon/session-map.json`

```json
{
  "MIN-123": {
    "sessions": [
      {
        "id": "037ae6b1-826d-4b2f-ae80-9b467abb7e43",
        "startedAt": "2026-01-17T10:30:00.000Z",
        "endedAt": "2026-01-17T11:45:00.000Z",
        "type": "planning",
        "model": "opus"
      },
      {
        "id": "148b7c2f-937e-5c3g-bf91-0c578bcc8b54",
        "startedAt": "2026-01-17T12:00:00.000Z",
        "endedAt": null,
        "type": "implementation",
        "model": "sonnet"
      }
    ]
  }
}
```

#### 3.2 Session Detection

On agent completion:
1. Find the session JSONL file
2. Parse token usage
3. Calculate cost
4. Store in cost log with issue ID

---

### 4. Dashboard API Endpoints

**Goal:** Expose cost data to the dashboard frontend.

#### 4.1 New Endpoints

```typescript
// GET /api/issues/:id/costs
// Returns cost summary for an issue
interface IssueCostResponse {
  issueId: string;
  totalCost: number;
  totalTokens: number;
  sessions: SessionCost[];
  byModel: Record<string, number>;
}

// GET /api/costs/summary
// Returns overall cost summary (daily, weekly, monthly)
interface CostSummaryResponse {
  today: CostSummary;
  week: CostSummary;
  month: CostSummary;
}

// GET /api/costs/by-issue
// Returns costs grouped by issue for dashboard display
interface IssuesCostResponse {
  issues: Array<{
    issueId: string;
    totalCost: number;
    tokenCount: number;
  }>;
}
```

---

### 5. Runtime Metrics Tracking

**Goal:** Track performance metrics per runtime for comparison.

#### 5.1 RuntimeMetrics Interface

Create `src/lib/runtime/metrics.ts`:

```typescript
interface RuntimeMetrics {
  runtime: RuntimeType;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  successRate: number;
  avgDurationMinutes: number;
  avgCost: number;
  totalCost: number;
  totalTokens: number;

  // Per-capability breakdown
  byCapability: Record<string, {
    tasks: number;
    successRate: number;
    avgDuration: number;
  }>;

  // Time series for charts
  dailyStats: Array<{
    date: string;
    tasks: number;
    cost: number;
    successRate: number;
  }>;
}
```

#### 5.2 Metrics Collection

On agent completion:
1. Record outcome (success/failure)
2. Record duration (start to completion)
3. Record runtime type
4. Record cost
5. Update aggregated metrics

#### 5.3 Metrics Storage

Store in `~/.panopticon/runtime-metrics.json`:

```json
{
  "claude": {
    "totalTasks": 150,
    "successfulTasks": 142,
    "failedTasks": 8,
    "totalCost": 245.50,
    "totalTokens": 45000000,
    "avgDurationMinutes": 35,
    "byCapability": {
      "feature": { "tasks": 80, "successRate": 0.95, "avgDuration": 45 },
      "bugfix": { "tasks": 50, "successRate": 0.96, "avgDuration": 20 },
      "refactor": { "tasks": 20, "successRate": 0.90, "avgDuration": 40 }
    }
  },
  "codex": {
    "totalTasks": 25,
    "successfulTasks": 20,
    "failedTasks": 5,
    ...
  }
}
```

---

### 6. Runtime Comparison Dashboard

**Goal:** Dashboard component comparing runtime performance.

#### 6.1 RuntimeComparison Component

Create `src/dashboard/frontend/src/components/RuntimeComparison.tsx`:

```tsx
function RuntimeComparison() {
  return (
    <div className="runtime-comparison">
      <h2>Runtime Performance</h2>

      <table>
        <thead>
          <tr>
            <th>Runtime</th>
            <th>Tasks</th>
            <th>Success Rate</th>
            <th>Avg Duration</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {runtimes.map(r => (
            <tr key={r.runtime}>
              <td>{r.runtime}</td>
              <td>{r.totalTasks}</td>
              <td>{(r.successRate * 100).toFixed(1)}%</td>
              <td>{r.avgDurationMinutes}m</td>
              <td>${r.totalCost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <RuntimeCostChart data={dailyStats} />
    </div>
  );
}
```

#### 6.2 Dashboard Tab

Add "Metrics" tab to main dashboard alongside Kanban, Terminal, Health, Skills.

---

### 7. Real-Time Cost Display

**Goal:** Show running cost while agent is working.

#### 7.1 Live Cost Indicator

While agent is running, show estimated cost based on:
- Elapsed time
- Model being used
- Historical average token rate

```tsx
// In AgentCard/KanbanCard when agent is running:
<span className="live-cost">
  <Loader2 className="animate-spin" />
  ~$1.23
</span>
```

#### 7.2 Implementation Approach

1. Periodically read partial JSONL file during execution
2. Sum tokens processed so far
3. Calculate running cost
4. Update every 30 seconds

---

## Implementation Tasks

### Phase 1: Cost Display Integration (Priority: High)

1. **PAN-XX: Add cost API endpoints to dashboard server**
   - GET /api/issues/:id/costs
   - GET /api/costs/summary
   - GET /api/costs/by-issue

2. **PAN-XX: Add cost badge to Kanban cards**
   - Fetch costs via API
   - Display badge with color coding
   - Add tooltip with breakdown

3. **PAN-XX: Add cost section to IssueDetailPanel**
   - Show total cost
   - Show per-session breakdown
   - Show per-model breakdown

### Phase 2: JSONL Parsing (Priority: High)

4. **PAN-XX: Create Claude Code JSONL parser**
   - Parse usage objects from session files
   - Handle all token types (input, output, cache)
   - Calculate cost per session

5. **PAN-XX: Implement session-to-issue linking**
   - Track session IDs when spawning agents
   - Store mapping in session-map.json
   - Auto-calculate costs on agent completion

### Phase 3: Runtime Metrics (Priority: Medium)

6. **PAN-XX: Implement RuntimeMetrics tracking**
   - Track success/failure per task
   - Track duration per task
   - Store aggregated metrics

7. **PAN-XX: Create RuntimeComparison component**
   - Table comparing runtimes
   - Daily cost chart
   - Success rate comparison

8. **PAN-XX: Add Metrics tab to dashboard**
   - New tab in main navigation
   - RuntimeComparison component
   - Daily/weekly/monthly cost charts

### Phase 4: Real-Time Features (Priority: Low)

9. **PAN-XX: Implement live cost indicator**
   - Periodic JSONL reading during execution
   - Running cost calculation
   - UI indicator in agent card

---

## Acceptance Criteria

- [ ] Kanban cards show cost badge for issues with cost data
- [ ] IssueDetailPanel shows cost breakdown section
- [ ] JSONL parser correctly extracts token usage from Claude Code sessions
- [ ] Session-to-issue linking works for all spawned agents
- [ ] Cost API endpoints return correct data
- [ ] RuntimeMetrics tracks task outcomes per runtime
- [ ] RuntimeComparison component displays comparison table
- [ ] Metrics tab appears in dashboard navigation
- [ ] Documentation updated with cost tracking usage

---

## References

- Main PRD: `/home/eltmon/projects/panopticon/docs/PRD.md`
- Cost library: `/home/eltmon/projects/panopticon/src/lib/cost.ts`
- Runtime interface: `/home/eltmon/projects/panopticon/src/lib/runtime/interface.ts`
- KanbanBoard: `/home/eltmon/projects/panopticon/src/dashboard/frontend/src/components/KanbanBoard.tsx`
- IssueDetailPanel: `/home/eltmon/projects/panopticon/src/dashboard/frontend/src/components/IssueDetailPanel.tsx`
- ccusage (reference): https://github.com/ryoppippi/ccusage
