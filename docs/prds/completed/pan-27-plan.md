# PAN-27: Cloister Phase 2 - Agent Management UI

## Problem Statement

The Panopticon dashboard currently shows a flat list of agents with basic health indicators (Phase 1). Users need:
1. **Visibility into specialist vs ephemeral agents** - Different agent types have different lifecycles and actions
2. **Health history visualization** - See agent health over time, not just current state
3. **Better control actions** - Poke stuck agents, wake sleeping specialists, reset broken sessions

**Reference:** [PRD-CLOISTER.md](../../PRD-CLOISTER.md) Phase 2 specification

## Current State

From Phase 1 implementation (`a1a9753`):
- CloisterService monitors agents via passive heartbeat detection (JSONL mtime, tmux activity)
- Four health states: active (🟢), stale (🟡), warning (🟠), stuck (🔴)
- CloisterStatusBar shows summary counts and emergency stop
- AgentList shows flat list with Cloister health emoji
- No health history persistence
- No specialist agent support

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Specialist backend scope | Full implementation | PRD specifies Phase 2 includes specialist registry |
| Health history storage | SQLite (`better-sqlite3`) | Reliable, query-friendly, already common in Node CLIs |
| Health history retention | 7 days | Balance between useful history and storage |
| Charting library | Chart.js + react-chartjs-2 | User preference, good React integration |
| All action buttons | Yes | Poke, Kill, Message, Wake, Reset all in scope |
| Agent detail view | Slide-out panel | Consistent with existing UI patterns |

## Solution Architecture

### 1. Health History Persistence (SQLite)

Create `~/.panopticon/cloister.db`:

```sql
CREATE TABLE health_events (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  state TEXT NOT NULL,        -- active, stale, warning, stuck
  previous_state TEXT,
  source TEXT,                -- jsonl_mtime, tmux_activity, git_activity
  metadata TEXT               -- JSON: { tool_name, last_action } for future active heartbeats
);
CREATE INDEX idx_agent_timestamp ON health_events(agent_id, timestamp);
```

**Flow:**
```
CloisterService.performHealthCheck()
    → evaluateAgentHealth()
    → writeHealthEvent(db, event)  // NEW
    → emit health-update event
```

### 2. Specialist Agent Registry

Create `~/.panopticon/specialists/`:
```
specialists/
├── registry.json         # { specialists: [...], defaults: {...} }
├── merge-agent.session   # Session ID (UUID) if initialized
├── review-agent.session
└── test-agent.session
```

**Specialist states:**
- `uninitialized` (⚪) - No session file exists
- `sleeping` (😴) - Session file exists, no tmux session running
- `active` (🟢) - Session file exists, tmux session running

**Session discovery:**
1. Read session ID from `.session` file
2. Locate JSONL via Claude Code session index at `~/.claude/projects/*/sessions-index.json`
3. Parse JSONL for token usage (approximate context size)

### 3. New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/specialists` | GET | List all specialists with status, session ID, context size |
| `/api/specialists/:name/wake` | POST | Spawn tmux + `claude --resume <session>` |
| `/api/specialists/:name/reset` | POST | Delete session file, optionally reinitialize |
| `/api/agents/:id/poke` | POST | Send standard nudge message to stuck agent |
| `/api/agents/:id/health-history` | GET | Return 24h of health events |

### 4. Frontend Components

**Two-Section AgentList:**
```
┌─────────────────────────────────────────────────────┐
│  SPECIALIST AGENTS (Permanent)                       │
│  ┌─────────────────────────────────────────────────┐│
│  │ 😴 merge-agent    Sleeping    Last: 2 hrs ago   ││
│  │    Session: 286e638d...  Context: 45K tokens    ││
│  │                                    [Wake][Reset]││
│  ├─────────────────────────────────────────────────┤│
│  │ ⚪ review-agent   Not initialized               ││
│  │                              [Initialize]       ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ISSUE AGENTS (Ephemeral)                           │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🟢 agent-pan-18   Active     2 min ago         ││
│  │    PAN-18 - Add Cloister framework              ││
│  │                        [View][Poke][Kill]       ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**AgentDetailView (slide-out panel):**
- Header with agent ID, status badge, issue link
- Terminal output stream (existing)
- Health history timeline (24h colored dots)
- Expandable health history chart (Chart.js area chart)
- Git status (branch, uncommitted files)
- For specialists: session ID, context size, last wake time

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/cloister/database.ts` | SQLite schema, init, read/write functions |
| `src/lib/cloister/specialists.ts` | Registry management, session discovery, wake/reset |
| `src/dashboard/frontend/src/components/SpecialistAgentCard.tsx` | Specialist display with Wake/Reset |
| `src/dashboard/frontend/src/components/IssueAgentCard.tsx` | Ephemeral agent display with Poke |
| `src/dashboard/frontend/src/components/AgentDetailView.tsx` | Slide-out detail panel |
| `src/dashboard/frontend/src/components/HealthHistoryTimeline.tsx` | 24h dot timeline |
| `src/dashboard/frontend/src/components/HealthHistoryChart.tsx` | Chart.js area chart |

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/cloister/service.ts` | Call `writeHealthEvent()` on each health check |
| `src/dashboard/server/index.ts` | Add specialist endpoints, poke endpoint, health-history endpoint |
| `src/dashboard/frontend/src/components/AgentList.tsx` | Split into two sections, use new card components |
| `src/dashboard/frontend/src/types.ts` | Add Specialist, HealthEvent interfaces |
| `src/dashboard/frontend/package.json` | Add chart.js, react-chartjs-2, better-sqlite3 |

## Implementation Order

### Layer 1: Backend Foundation (~4 tasks)
1. SQLite database module (`database.ts`)
2. Specialist registry module (`specialists.ts`)
3. Specialist session management (token counting)
4. Cloister service writes health events

### Layer 2: API Endpoints (~3 tasks)
5. Health history endpoint
6. Specialist endpoints (list, wake, reset)
7. Poke endpoint

### Layer 3: Frontend Components (~4 tasks)
8. AgentList two-section refactor
9. SpecialistAgentCard component
10. IssueAgentCard component
11. AgentDetailView panel

### Layer 4: Visualizations (~2 tasks)
12. HealthHistoryTimeline component
13. HealthHistoryChart component

## Testing Strategy

| Test | Approach |
|------|----------|
| SQLite persistence | Unit test write/read cycle, 7-day cleanup |
| Specialist registry | Unit test list/wake/reset functions |
| API endpoints | Integration tests via supertest |
| Health timeline | Visual test with mock data spanning 24h |
| Wake/Reset buttons | Manual test with real Claude Code session |
| Poke message delivery | Manual test - verify message appears in tmux |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `better-sqlite3` requires native compilation | Include in package.json optionalDependencies, document fallback |
| Session ID discovery may fail | Graceful degradation - show "Unknown" for context size |
| Chart.js bundle size | Tree-shake unused chart types |
| Specialist wake may fail if Claude Code not installed | Pre-check `claude --version`, show error message |

## Out of Scope (Explicitly)

- **Active heartbeats via hooks** (Phase 3) - Requires Claude Code configuration changes
- **Model routing and handoffs** (Phase 4) - Complex orchestration logic
- **Auto-wake on webhooks** (Phase 5) - GitHub/Linear integration
- **Cost tracking per agent** - Separate reporting PRD
- **Multi-runtime support** (OpenCode, Codex) - Future phases

## Beads Tasks

All tasks created with dependencies in beads:

| ID | Title | Layer |
|----|-------|-------|
| panopticon-agl | Create SQLite database module | 1 |
| panopticon-vw4 | Create specialist registry module | 1 |
| panopticon-x55 | Implement specialist session management | 1 |
| panopticon-rpk | Modify Cloister to write health events | 1 |
| panopticon-xud | Implement health history API endpoint | 2 |
| panopticon-fyv | Add specialist API endpoints | 2 |
| panopticon-9yw | Add poke API endpoint | 2 |
| panopticon-9lh | Update AgentList to show two sections | 3 |
| panopticon-5f4 | Create SpecialistAgentCard component | 3 |
| panopticon-cbw | Create IssueAgentCard component | 3 |
| panopticon-2cw | Create AgentDetailView component | 3 |
| panopticon-isv | Create HealthHistoryTimeline component | 4 |
| panopticon-7um | Create HealthHistoryChart component | 4 |

## Success Criteria

1. Dashboard shows two distinct sections for specialists and issue agents
2. Specialist cards show session ID, context size, and Wake/Reset buttons
3. Issue agent cards show Poke button when in warning/stuck state
4. Clicking any agent opens detail panel with health timeline
5. Health timeline shows last 24 hours of state changes
6. Health events persist across dashboard restarts (SQLite)
7. Wake action successfully resumes a Claude Code session
8. Reset action clears session and allows reinitialization
