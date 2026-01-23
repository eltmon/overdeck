# PAN-33: Cloister Phase 6 - Advanced Features

## Status: ✅ COMPLETE

## Summary

Successfully implemented ALL 11 tasks for Cloister Phase 6 - Advanced Features.

### ✅ Completed (11/11 tasks)

**Reliability Fixes (3/3)**
1. ✅ **1.1 Cloister Auto-Start** - Dashboard auto-starts Cloister on launch when configured
2. ✅ **1.2 Specialist State Reset** - Specialists reset working directory and prompt buffer between tasks
3. ✅ **1.3 Confirmation Dialog UI** - Modal confirmation system for destructive actions

**Core Monitoring (3/3)**
4. ✅ **2.1 Auto-Restart on Crash** - Agents restart after crashes with exponential backoff (30/60/120s)
5. ✅ **2.2 Mass Death Detection** - Detects 3+ deaths in 30s window, pauses spawns
6. ✅ **2.3 FPP Violation Detection** - Escalating nudges for idle agents with pending work

**Cost Management (1/1)**
7. ✅ **3.1 Cost Limits and Alerts** - Per-agent, per-issue, daily limits with 80% threshold warnings

**Session Management (1/1)**
8. ✅ **4.1 Session Rotation** - Tiered memory rotation for merge-agent at 100k tokens

**Metrics Dashboard (3/3)**
9. ✅ **5.1 Metrics API Endpoints** - Backend endpoints for summary, costs, handoffs, stuck agents
10. ✅ **5.2 Metrics Summary Widgets** - Dashboard widgets showing key daily metrics
11. ✅ **5.3 Dedicated /metrics Page** - Full-page metrics view with cost breakdowns

---

## Decision Log

### Scope Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| AskUserQuestion interception | **DROPPED** | Previously attempted, didn't work well |
| Priority approach | All features + reliability fixes | Comprehensive Phase 6 implementation |
| Specialist state reset | Reset working directory between tasks | Preserves session context while clearing stale state |
| Merge-agent memory | Tiered: 100/50/20 merges | 100 with hash+message, 50 with detail, 20 with full diffs |
| Cost limit response | Alert + manual intervention | No automatic stopping, user decides |
| Metrics UI | Both page and widgets | Summary widgets on main dashboard + dedicated /metrics page |
| FPP nudge style | Escalating (Status → Reminder → Direct) | Progressively more insistent, 3 stages |
| Auto-restart | Exponential backoff (30/60/120s) | 3 max retries then alert |
| Branch delete confirmation | Add alert dialog UI | Strengthen confirmation with proper dashboard dialog |

---

## Architecture Overview

### 1. Reliability Fixes

#### 1.1 Cloister Auto-Start
**Problem:** Dashboard saves `auto_start` to config but doesn't read it on startup.

**Solution:** In `src/dashboard/server/index.ts`, import `shouldAutoStart()` from config and call `getCloisterService().start()` if true.

```typescript
// At server startup, after ensureTmuxRunning()
import { shouldAutoStart } from '../../lib/cloister/config.js';

if (shouldAutoStart()) {
  console.log('🔔 Auto-starting Cloister...');
  getCloisterService().start();
}
```

#### 1.2 Specialist State Reset
**Problem:** Specialists retain stale working directory and prompt buffer between tasks.

**Solution:** Add `resetSpecialist()` function that:
1. Sends `Ctrl+C` to cancel any pending command
2. Runs `cd ~` to reset working directory
3. Clears the prompt buffer with `Ctrl+U`
4. Called before sending new task prompts

**Location:** `src/lib/cloister/specialists.ts`

#### 1.3 Branch Delete Confirmation Dialog
**Problem:** Hook confirmation for branch deletes happens in tmux, not visible in dashboard.

**Solution:** When a hook requires confirmation for destructive actions:
1. Dashboard detects confirmation request (via tmux output polling)
2. Shows alert dialog with action details
3. User confirms/denies in dashboard
4. Response sent to tmux session

**Files:**
- `src/dashboard/server/index.ts` - Add confirmation detection endpoint
- `src/dashboard/frontend/src/components/ConfirmationDialog.tsx` - New component
- Integrate with existing terminal/agent views

---

### 2. Auto-Restart on Crash

**Config Addition:**
```toml
[auto_restart]
enabled = true
max_retries = 3
backoff_seconds = [30, 60, 120]
```

**Implementation:**
- Track crash count per agent in memory
- On agent death detection (tmux session dies):
  1. Check if crashes < max_retries
  2. Wait backoff_seconds[crashCount] before restart
  3. Restart with `--resume` using stored session ID
  4. If max_retries exceeded, emit alert event

**Location:** `src/lib/cloister/service.ts`

**New Types:**
```typescript
interface AgentCrashTracker {
  agentId: string;
  crashCount: number;
  lastCrash: Date;
  nextRetryAt?: Date;
  gaveUp: boolean;
}
```

---

### 3. Mass Death Detection

**Trigger:** 3+ agent deaths within 30 seconds

**Response:**
1. Pause all new agent spawns
2. Emit `mass_death_detected` event
3. Show critical alert in dashboard
4. Require manual acknowledgment to resume spawning

**Implementation:**
- Maintain rolling window of death timestamps
- On each death, check if 3+ in last 30 seconds
- Set `spawnsPaused` flag that `pan work issue` respects

**Location:** `src/lib/cloister/service.ts`

---

### 4. FPP Violation Detection

**Detection Triggers:**
- Agent has work on hook but no activity for `hook_idle_minutes` (default: 5)
- PR approved but not merged for `pr_approved_minutes` (default: 10)
- Review requested but agent idle for `review_pending_minutes` (default: 15)

**Escalation Sequence:**
1. **Nudge 1 (Status check):** "What's your current status? You have [pending work] on your hook."
2. **Nudge 2 (Gentle reminder):** "I notice you've been idle. Do you need help with [pending item]?"
3. **Nudge 3 (Direct action):** "You have pending work: [description]. Execute it now or explain why you're blocked."
4. **Escalate:** After 3 failed nudges, alert user via dashboard/notification

**New Types:**
```typescript
interface FPPViolation {
  agentId: string;
  type: 'hook_idle' | 'pr_stale' | 'review_pending' | 'status_mismatch';
  detectedAt: string;
  nudgeCount: number;
  lastNudgeAt?: string;
  resolved: boolean;
}
```

**Location:** New file `src/lib/cloister/fpp-violations.ts`

---

### 5. Cost Limits and Alerts

**Config Addition:**
```toml
[cost_limits]
per_agent_usd = 10.00
per_issue_usd = 25.00
daily_total_usd = 100.00
alert_threshold = 0.8  # Alert at 80%
```

**Implementation:**
- Hook into existing cost tracking (`src/lib/cost.ts`)
- After each cost log, check against limits
- If threshold exceeded: emit alert event
- Dashboard shows cost warning banner

**Alert Levels:**
- **Warning (80%):** Yellow banner, no action
- **Limit reached (100%):** Red banner, prominent notification
- No automatic stopping - user decides

**Location:** `src/lib/cloister/cost-monitor.ts` (new)

---

### 6. Session Rotation for Merge-Agent

**Trigger:** When merge-agent context exceeds threshold (configurable, default 100k tokens)

**Process:**
1. Detect high context via token counting
2. Build memory file with tiered merge history:
   - Last 100 merges: commit hash + message
   - Last 50 merges: + files changed, conflict summary
   - Last 20 merges: + full diff summaries, resolution strategies
3. Kill current session
4. Start fresh session with memory file injected
5. Archive old session ID

**Location:** `src/lib/cloister/session-rotation.ts` (new)

**Memory File Format:**
```markdown
# Merge Agent Memory

## Recent Merge History (Last 100)
| Hash | Message | Date |
|------|---------|------|
| abc123 | Merge feature/foo | 2026-01-20 |
...

## Detailed Merges (Last 50)
### abc123 - Merge feature/foo
Files: src/app.ts, src/lib/utils.ts
Conflicts: None
...

## Full Context Merges (Last 20)
### abc123 - Merge feature/foo
[Full diff summary and resolution notes]
...
```

---

### 7. Metrics Dashboard

#### Summary Widgets (Main Dashboard)
- Cost today (with sparkline)
- Active agents count
- Stuck incidents today
- Handoff success rate

#### Dedicated /metrics Page
- Cost over time (line chart, 7/30 day)
- Cost by model (pie chart)
- Handoff success rate (bar chart)
- Stuck incidents per day (bar chart)
- Model usage breakdown (stacked area)
- Cost savings from model routing

**Files:**
- `src/dashboard/frontend/src/components/MetricsSummary.tsx` (new)
- `src/dashboard/frontend/src/pages/Metrics.tsx` (new)
- `src/dashboard/server/index.ts` - Add `/api/metrics` endpoints

---

## Implementation Order

1. **Reliability Fixes** (foundation)
   - 1.1 Cloister auto-start
   - 1.2 Specialist state reset
   - 1.3 Confirmation dialog (can be parallel)

2. **Core Monitoring** (safety net)
   - 2.1 Auto-restart on crash
   - 2.2 Mass death detection
   - 2.3 FPP violation detection

3. **Cost Management** (awareness)
   - 3.1 Cost limits and alerts

4. **Session Rotation** (merge-agent improvement)
   - 4.1 Token counting for specialists
   - 4.2 Memory file generation
   - 4.3 Session rotation logic

5. **Metrics Dashboard** (visibility)
   - 5.1 API endpoints
   - 5.2 Summary widgets
   - 5.3 Dedicated metrics page

---

## Files to Create

- `src/lib/cloister/fpp-violations.ts` - FPP violation detection and nudging
- `src/lib/cloister/cost-monitor.ts` - Cost limit monitoring
- `src/lib/cloister/session-rotation.ts` - Session rotation logic
- `src/dashboard/frontend/src/components/ConfirmationDialog.tsx` - Alert dialog
- `src/dashboard/frontend/src/components/MetricsSummary.tsx` - Dashboard widgets
- `src/dashboard/frontend/src/pages/Metrics.tsx` - Metrics page

## Files to Modify

- `src/dashboard/server/index.ts` - Auto-start, confirmation endpoints, metrics API
- `src/lib/cloister/service.ts` - Auto-restart, mass death detection
- `src/lib/cloister/specialists.ts` - State reset function
- `src/lib/cloister/config.ts` - New config sections
- `src/dashboard/frontend/src/App.tsx` - Add /metrics route

---

## Testing Strategy

1. **Unit Tests:**
   - FPP violation detection logic
   - Cost limit calculations
   - Session rotation memory generation

2. **Integration Tests:**
   - Auto-restart with mocked tmux
   - Mass death detection window

3. **E2E Tests:**
   - Metrics page rendering
   - Confirmation dialog flow
   - Cost alert banner display
