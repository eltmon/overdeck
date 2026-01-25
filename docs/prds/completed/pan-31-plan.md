# PAN-31: Cloister Phase 4 - Model Routing & Handoffs

## Issue Summary

Enable intelligent task routing to cost-effective models based on complexity, with automatic handoffs between models as work progresses. This builds on Phase 3's heartbeat/health infrastructure to create a complete agent orchestration system.

## Key Decisions

### 1. Handoff Methods

**Decision:** Implement both Kill & Spawn AND Specialist Wake

**Kill & Spawn (General Agents):**
- Signal agent to save state (update STATE.md)
- Wait for idle (30s timeout)
- Capture handoff context (beads, git, STATE.md)
- Kill current agent
- Build handoff prompt with context
- Spawn new agent with appropriate model

**Specialist Wake (Permanent Specialists):**
- For test-agent, merge-agent, review-agent
- Use `--resume {sessionId}` to preserve context
- Pass task-specific prompt
- Faster context loading, specialist expertise

**Why both:** Kill & Spawn provides clean handoffs for general work; Specialist Wake leverages context preservation for recurring specialist tasks.

### 1b. Specialist Feedback Loop (NEW)

**Decision:** Specialists send feedback back to issue agents after completing tasks

**The Genius:** Specialists accumulate context and expertise over time. A merge-agent that has resolved 50 merges learns patterns about common conflicts, test failures, and code structure. This knowledge should flow BACK to issue agents.

**Feedback Flow:**
```
Issue Agent → Specialist (task) → Specialist processes → Feedback → Issue Agent
     ↑                                                              │
     └──────────────────────────────────────────────────────────────┘
```

**SpecialistFeedback Interface:**
```typescript
interface SpecialistFeedback {
  id: string;
  timestamp: string;
  fromSpecialist: 'merge-agent' | 'test-agent' | 'review-agent';
  toIssueId: string;
  feedbackType: 'success' | 'failure' | 'warning' | 'insight';
  category: 'merge' | 'test' | 'review' | 'general';
  summary: string;
  details: string;
  actionItems?: string[];    // Specific actions for the agent
  patterns?: string[];       // Patterns the specialist noticed
  suggestions?: string[];    // Improvement suggestions
}
```

**Delivery Mechanism:**
1. Log to `~/.panopticon/specialists/feedback/feedback.jsonl` (persistent)
2. Send to issue agent's tmux session via `tmux send-keys`
3. If agent not running, feedback is queued for retrieval

**Why This Matters:**
- Merge-agent learns: "Config files always conflict on version bumps"
- Test-agent learns: "Auth tests fail when TEST_API_KEY not set"
- Review-agent learns: "This codebase uses snake_case, not camelCase"
- This knowledge accumulates and improves all future work

### 2. Handoff Triggers

**Decision:** Implement all triggers with specific detection mechanisms

| Trigger | Detection | From | To |
|---------|-----------|------|-----|
| Planning complete | Beads "plan" task closed + PRD file created | Opus | Sonnet |
| Stuck (Haiku) | Heartbeat > 10 min stale | Haiku | Sonnet |
| Stuck (Sonnet) | Heartbeat > 20 min stale | Sonnet | Opus |
| Test failures | Any test failure detected | Haiku | Sonnet |
| Implementation complete | Beads "implement" task closed | Sonnet | test-agent |

**Planning Complete Detection (Multi-Signal):**
1. Primary: Beads task with "plan" in title is closed via `bd close`
2. Secondary: PRD file created at `docs/prds/active/{issue}-plan.md`
3. Tertiary: Agent uses ExitPlanMode tool (if detectable via hooks)

**Why aggressive test escalation:** Haiku is for simple tasks - if tests fail, the task isn't simple.

### 3. Complexity Detection

**Decision:** Automatic complexity detection from multiple signals

**Signals:**
- Beads task complexity field (explicit, highest priority)
- Task tags: `trivial`, `docs`, `tests` → Haiku; `architecture`, `security` → Opus
- File count: >10 files → medium+; >20 files → complex+
- Keyword patterns: "refactor", "architecture" → complex; "typo", "rename" → simple

**Complexity → Model Mapping:**
```yaml
trivial: haiku
simple: haiku
medium: sonnet
complex: sonnet
expert: opus
```

### 4. Stuck Detection

**Decision:** Heartbeat-based detection using existing Phase 3 infrastructure

**Thresholds:**
- Haiku: Stuck after 10 minutes of no activity → escalate to Sonnet
- Sonnet: Stuck after 20 minutes of no activity → escalate to Opus
- Opus: Stuck after 30 minutes → alert user (no auto-escalation)

**Detection Source:** Use existing health state from `cloister/health.ts`
- Active (🟢): < 5 min
- Stale (🟡): 5-15 min
- Warning (🟠): 15-30 min
- Stuck (🔴): > 30 min

Map model-specific thresholds onto these states.

**Future Enhancement: Context-Aware Specialist Routing**

Instead of just upgrading the model when stuck, route to the appropriate specialist:
- Stuck on merge conflicts → route to merge-agent
- Stuck on test failures → route to test-agent
- Stuck on code review feedback → route to review-agent

This leverages specialist expertise rather than just throwing more compute at the problem.

### 5. Context Preservation

**Decision:** STATE.md as primary context carrier

**HandoffContext Interface:**
```typescript
interface HandoffContext {
  issueId: string;
  agentId: string;
  workspace: string;

  // Source info
  previousModel: string;
  previousRuntime: 'claude-code';
  previousSessionId?: string;

  // Files
  stateFile: string;           // .planning/STATE.md content
  claudeMd: string;            // CLAUDE.md content

  // Git state
  gitBranch: string;
  uncommittedFiles: string[];
  lastCommit: string;

  // Beads state
  activeBeadsTasks: BeadsTask[];
  remainingTasks: BeadsTask[];
  completedTasks: BeadsTask[];

  // AI summaries
  whatWasDone: string;
  whatRemains: string;
  blockers: string[];
  decisions: string[];

  // Metrics
  tokenUsage: TokenUsage;
  costSoFar: number;
  handoffCount: number;
}
```

### 6. Cost Tracking & Display

**Decision:** Display costs per agent and cumulative totals in dashboard

**Dashboard Display:**
- Per-agent cost in agent card
- Total cost in header/status bar
- Cost breakdown by model tier (pie chart or table)

**Follow-up Issue:** Create GitHub issue for specialist cost breakdown (specialist vs general work split)

**Out of Scope:** Cost limits enforcement (display only, no auto-kill on limits)

### 7. Dashboard UI

**Decision:** Both inline controls + dedicated page

**Inline (Agent Card):**
- Current model badge
- "Handoff Suggestion" indicator when triggered
- Quick "Handoff" button with model selector

**Dedicated Page (/handoffs):**
- Handoff history table with filters
- Cost analysis charts
- Model usage breakdown

### 8. Event Logging

**Decision:** JSONL file at `~/.panopticon/logs/handoffs.jsonl`

**HandoffEvent Structure:**
```typescript
interface HandoffEvent {
  timestamp: string;
  agentId: string;
  issueId: string;

  from: { model: string; runtime: string; sessionId?: string };
  to: { model: string; runtime: string; sessionId?: string };

  trigger: 'planning_complete' | 'stuck_escalation' | 'test_failure' | 'manual' | 'task_complete';
  reason: string;

  context: {
    beadsTaskCompleted?: string;
    stuckMinutes?: number;
    costAtHandoff?: number;
  };

  // Operation success - did the handoff execute?
  success: boolean;
  errorMessage?: string;

  // Recovery outcome - did the agent ACTUALLY recover? (NEW)
  outcome?: {
    verified: boolean;          // Has recovery been checked?
    agentRecovered: boolean;    // Did agent start making progress?
    verifiedAt?: string;
    verificationMethod?: 'heartbeat' | 'manual' | 'task_complete';
    notes?: string;
  };
}
```

**CRITICAL: Two Different Success Metrics**

1. **Operation Success Rate**: Did the handoff operation complete?
   - "We spawned a new agent" = success
   - This is what `success: boolean` tracks

2. **Recovery Success Rate**: Did the agent actually recover?
   - "The agent is no longer stuck and making progress" = success
   - This requires follow-up verification via `outcome`

**Why This Matters:** A 100% operation success rate with 0% recovery success means handoffs are executing but not helping. The dashboard must show BOTH metrics to be useful.

### 9. Scope Boundaries

**In Scope:**
- ✅ Beads complexity field support
- ✅ Automatic complexity detection
- ✅ Model router component
- ✅ All handoff triggers (planning complete, stuck, test failures)
- ✅ Both handoff methods (Kill & Spawn, Specialist Wake)
- ✅ Context preservation via STATE.md
- ✅ Cost tracking & dashboard display
- ✅ Handoff UI (inline + page)
- ✅ Handoff event logging (JSONL)

**Out of Scope:**
- ❌ Cross-runtime handoffs (only Claude Code → Claude Code)
- ❌ Cost limits enforcement (display only)
- ❌ Model selection for new agents (future: pick model based on task)

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Cloister Service                        │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   Health     │  Heartbeats  │   Model      │   Handoff      │
│   Monitor    │   (Phase 3)  │   Router     │   Manager      │
│              │              │   [NEW]      │   [NEW]        │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬────────┘
       │              │              │               │
       ▼              ▼              ▼               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Agent State Store                          │
│  ~/.panopticon/agents/{id}/state.json                        │
│  + model, complexity, handoffCount, costSoFar                │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Handoff Event Log                          │
│  ~/.panopticon/logs/handoffs.jsonl                           │
└──────────────────────────────────────────────────────────────┘
```

### New Files to Create

```
src/lib/cloister/
├── router.ts           # Model router: complexity→model mapping
├── handoff.ts          # Handoff manager: orchestrates handoffs
├── handoff-context.ts  # Context capture and serialization
└── complexity.ts       # Complexity detection logic

src/dashboard/server/
├── routes/handoffs.ts  # /api/agents/:id/handoff endpoints
└── routes/costs.ts     # /api/costs endpoints (if not existing)

src/dashboard/frontend/
├── components/HandoffPanel.tsx    # Inline agent card panel
├── pages/Handoffs.tsx             # Dedicated handoffs page
└── components/CostDisplay.tsx     # Cost visualization
```

### Files to Modify

```
src/lib/cloister/service.ts        # Add router integration, handoff triggers
src/lib/cloister/config.ts         # Add handoff configuration
src/lib/agents.ts                  # Add model parameter, handoff support
src/dashboard/server/index.ts      # Add handoff endpoints
src/dashboard/frontend/AgentCard   # Add handoff UI
```

### Configuration Schema

```yaml
# ~/.panopticon/cloister.yaml additions

model_selection:
  default_model: sonnet

  complexity_routing:
    trivial: haiku
    simple: haiku
    medium: sonnet
    complex: sonnet
    expert: opus

  specialists:
    merge-agent: sonnet
    review-agent: sonnet
    test-agent: haiku
    planning-agent: opus

handoffs:
  auto_triggers:
    planning_complete:
      enabled: true
      detection:
        - beads_task_closed: "plan"
        - prd_file_created: true
      from_model: opus
      to_model: sonnet

    stuck_escalation:
      enabled: true
      thresholds:
        haiku_to_sonnet_minutes: 10
        sonnet_to_opus_minutes: 20

    test_failure:
      enabled: true
      from_model: haiku
      to_model: sonnet
      trigger_on: any_failure  # vs "2_consecutive"

    implementation_complete:
      enabled: true
      to_specialist: test-agent

cost_tracking:
  display_enabled: true
  log_to_jsonl: true
```

## API Endpoints

### Handoff Suggestion
```
GET /api/agents/:id/handoff/suggestion
Response: {
  suggested: boolean,
  trigger: 'stuck_escalation' | 'planning_complete' | 'test_failure' | null,
  currentModel: string,
  suggestedModel: string,
  reason: string,
  estimatedSavings?: number
}
```

### Execute Handoff
```
POST /api/agents/:id/handoff
Body: {
  toModel: 'opus' | 'sonnet' | 'haiku',
  reason?: string
}
Response: {
  success: boolean,
  newAgentId: string,
  newSessionId?: string,
  handoffEvent: HandoffEvent
}
```

### Handoff History
```
GET /api/issues/:id/handoffs
Response: {
  handoffs: HandoffEvent[]
}

GET /api/handoffs
Query: ?limit=50&since=2024-01-01
Response: {
  handoffs: HandoffEvent[],
  total: number
}
```

### Cost Endpoints
```
GET /api/agents/:id/cost
Response: {
  agentId: string,
  model: string,
  tokens: { input: number, output: number, cacheRead: number },
  cost: number
}

GET /api/costs/summary
Response: {
  totalCost: number,
  byModel: { opus: number, sonnet: number, haiku: number },
  byAgent: { [agentId]: number },
  today: number,
  thisWeek: number
}
```

## Implementation Order

### Phase A: Foundation (Model Router + Complexity)
1. Create `complexity.ts` - complexity detection logic
2. Create `router.ts` - complexity→model mapping
3. Extend agent state with complexity, model tracking
4. Add configuration schema for model routing

### Phase B: Handoff Infrastructure
5. Create `handoff-context.ts` - context capture
6. Create `handoff.ts` - handoff orchestration
7. Implement Kill & Spawn handoff method
8. Implement Specialist Wake handoff method

### Phase C: Triggers
9. Implement stuck escalation trigger (heartbeat-based)
10. Implement planning complete detection
11. Implement test failure detection
12. Implement task completion detection

### Phase D: Dashboard & Logging
13. Add handoff JSONL logging
14. Add cost display to agent cards
15. Create HandoffPanel component
16. Create /handoffs page
17. Add handoff API endpoints

### Phase E: Integration & Testing
18. Wire triggers to handoff manager in Cloister service
19. E2E test: stuck escalation scenario
20. E2E test: planning→implementation handoff
21. Manual testing of dashboard UI

## Beads Tasks

| ID | Title | Phase | Blocked By | Complexity |
|----|-------|-------|------------|------------|
| pan31-01 | Create complexity detection module | A | - | simple |
| pan31-02 | Create model router with config | A | pan31-01 | simple |
| pan31-03 | Extend agent state for model/complexity tracking | A | - | simple |
| pan31-04 | Add handoff config schema to cloister.yaml | A | pan31-02 | trivial |
| pan31-05 | Create handoff context capture module | B | pan31-03 | medium |
| pan31-06 | Implement Kill & Spawn handoff method | B | pan31-05 | medium |
| pan31-07 | Implement Specialist Wake handoff method | B | pan31-05 | medium |
| pan31-08 | Create handoff manager orchestration | B | pan31-06, pan31-07 | medium |
| pan31-09 | Implement stuck escalation trigger | C | pan31-08 | simple |
| pan31-10 | Implement planning complete detection | C | pan31-08 | medium |
| pan31-11 | Implement test failure escalation | C | pan31-08 | simple |
| pan31-12 | Implement task completion detection | C | pan31-08 | simple |
| pan31-13 | Add handoff JSONL logging | D | pan31-08 | trivial |
| pan31-14 | Add cost display to dashboard agent cards | D | - | simple |
| pan31-15 | Create HandoffPanel component | D | pan31-13 | medium |
| pan31-16 | Create /handoffs page with history | D | pan31-13, pan31-15 | medium |
| pan31-17 | Add handoff API endpoints | D | pan31-08 | simple |
| pan31-18 | Wire triggers into Cloister service | E | pan31-09, pan31-10, pan31-11, pan31-12 | medium |
| pan31-19 | E2E test: stuck escalation | E | pan31-18 | simple |
| pan31-20 | E2E test: planning handoff | E | pan31-18 | simple |
| pan31-21 | Create follow-up issue for specialist cost breakdown | D | - | trivial |

## Success Criteria

1. ✅ Beads complexity field influences model selection
2. ✅ Automatic complexity detection works for unlabeled tasks
3. ✅ Model router correctly maps complexity→model
4. ✅ Stuck agents automatically escalate to higher model
5. ✅ Planning completion triggers Opus→Sonnet handoff
6. ✅ Test failures escalate Haiku→Sonnet
7. ✅ Context (STATE.md, beads, git) preserved during handoff
8. ✅ Specialists can be woken with --resume
9. ✅ Cost displayed per agent in dashboard
10. ✅ Handoff events logged to JSONL
11. ✅ Dashboard shows handoff controls and history
12. ✅ No regressions in Phase 1-3 functionality

## Open Questions (Resolved)

1. **How detect planning complete?** → Multi-signal: beads task + PRD file + ExitPlanMode
2. **Stuck detection source?** → Heartbeat-based, using existing health states
3. **Test failure threshold?** → Any failure escalates (aggressive)
4. **Cross-runtime handoffs?** → Out of scope (Claude Code only)
5. **Cost limits?** → Display only, no enforcement

## References

- PRD-CLOISTER.md lines 48-680 (Model Selection & Handoffs)
- Phase 3 (Heartbeats & Hooks) - Complete ✅
- src/lib/cloister/service.ts - Main service
- src/lib/cloister/specialists.ts - Specialist management
- src/lib/cost.ts - Cost tracking infrastructure
