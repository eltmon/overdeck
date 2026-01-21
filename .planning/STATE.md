# PAN-27: Cloister Phase 2 - Agent Management UI - STATE

## Issue Summary

Implement Cloister Phase 2: Enhanced Agent Management UI per PRD-CLOISTER.md. This includes a two-section agents page (Specialist vs Issue agents), health history visualization, and full action button support.

## Key Decisions

### 1. Specialist Agents Scope
**Decision:** Full implementation (backend + UI)

The PRD indicates specialist agents backend is part of Phase 2. Implementation includes:
- Specialist registry module (`src/lib/cloister/specialists.ts`)
- Session management (read/write session IDs, context token counting)
- API endpoints: GET /api/specialists, POST /wake, POST /reset
- UI components: SpecialistAgentCard with Wake/Reset buttons

Specialist types:
- `merge-agent` - PR merging and conflict resolution
- `review-agent` - Code review
- `test-agent` - Test running

### 2. Health History Storage
**Decision:** SQLite for persistence

Create `~/.panopticon/cloister.db` with `health_events` table:
```sql
CREATE TABLE health_events (
  id INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  state TEXT NOT NULL,  -- active, stale, warning, stuck
  previous_state TEXT,
  source TEXT,          -- jsonl_mtime, tmux_activity, etc.
  metadata TEXT         -- JSON for additional context
);
CREATE INDEX idx_agent_timestamp ON health_events(agent_id, timestamp);
```

Retention: 7 days (cleanup on service start)

### 3. Health History Visualization
**Decision:** Chart.js + react-chartjs-2

Timeline visualization with:
- 24-hour area chart showing state durations
- Color coding: 🟢 green (active), 🟡 yellow (stale), 🟠 orange (warning), 🔴 red (stuck)
- Expandable from compact timeline to full chart
- Click-through to see individual events

### 4. Action Buttons
**Decision:** All actions implemented

| Action | Target | Behavior |
|--------|--------|----------|
| **Poke** | Issue agents (warning/stuck) | Send standard nudge message |
| **Kill** | All agents | Terminate via tmux kill-session |
| **Send Message** | All agents | Custom message via tmux send-keys |
| **Wake** | Specialists (sleeping) | Resume with --resume flag |
| **Reset** | Specialists (any) | Clear session file, reinitialize |

### 5. Agent List Sections
**Decision:** Two distinct sections

**Specialist Agents Section (top):**
- Shows all 3 specialists (merge-agent, review-agent, test-agent)
- States: Sleeping (😴), Active (🟢), Not initialized (⚪)
- Displays session ID (truncated), context token count
- Actions: Wake, Reset

**Issue Agents Section (bottom):**
- Shows ephemeral agents from /work-issue
- Displays issue ID, branch name, Cloister health state
- Actions: View, Poke (if warning/stuck), Kill, Send Message

### 6. Agent Detail View
**Decision:** Slide-out panel on click

Contents:
- Header: Agent ID, status badge, issue link
- Terminal output stream (existing TerminalView)
- Health history timeline (new)
- Git status (existing - branch, uncommitted files)
- For specialists: Session ID, context size, last wake time

## Scope

### In Scope (PAN-27)

**Backend (Layer 1 - Complete):**
- [x] Specialist registry module (`src/lib/cloister/specialists.ts`)
- [x] Specialist session management (context token counting from JSONL)
- [x] SQLite health history storage
- [x] Cloister service writes health events

**Backend (Layer 2 - Complete):**
- [x] Health history API endpoint (GET /api/agents/:id/health-history)
- [x] Specialist API endpoints (GET /api/specialists, POST /wake, POST /reset)
- [x] Poke API endpoint (POST /api/agents/:id/poke)

**Frontend (Layer 3):**
- [x] Two-section AgentList refactor (Specialists + Issue Agents)
- [x] SpecialistAgentCard component (Wake/Reset/Kill buttons)
- [x] IssueAgentCard component (Poke/Kill buttons)
- [ ] AgentDetailView panel

**Frontend (Layer 4 - Visualizations):**
- [ ] HealthHistoryTimeline component
- [ ] HealthHistoryChart component (Chart.js)

### Out of Scope (Future Phases)

- Active heartbeats via hooks (Phase 3)
- Model routing and handoffs (Phase 4)
- Auto-wake on GitHub/Linear webhooks (Phase 5)
- Cost tracking per agent (separate PRD)
- Multi-runtime support (OpenCode, Codex)

## Architecture

### New Files

```
src/lib/cloister/
├── specialists.ts       # Specialist registry and session management
├── database.ts          # SQLite health history storage
└── config.ts            # (existing)

src/dashboard/server/
├── index.ts             # (add specialist + history endpoints)
└── routes/
    └── specialists.ts   # (optional - if splitting routes)

src/dashboard/frontend/src/components/
├── AgentList.tsx        # (refactor into sections)
├── SpecialistAgentCard.tsx
├── IssueAgentCard.tsx
├── AgentDetailView.tsx
├── HealthHistoryTimeline.tsx
└── HealthHistoryChart.tsx
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Health Event Flow                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CloisterService.performHealthCheck()                       │
│         │                                                   │
│         ▼                                                   │
│  evaluateAgentHealth() ──► health state determined          │
│         │                                                   │
│         ▼                                                   │
│  writeHealthEvent(db, event) ──► SQLite cloister.db        │
│         │                                                   │
│         ▼                                                   │
│  GET /api/agents/:id/health-history                         │
│         │                                                   │
│         ▼                                                   │
│  HealthHistoryTimeline / HealthHistoryChart                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Specialist Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ~/.panopticon/specialists/                                 │
│  ├── registry.json        # List of configured specialists  │
│  ├── merge-agent.session  # Session ID (if initialized)    │
│  ├── review-agent.session                                   │
│  └── test-agent.session                                     │
│                                                             │
│  GET /api/specialists                                       │
│    └─► List all with status (sleeping/active/uninitialized) │
│                                                             │
│  POST /api/specialists/:name/wake                           │
│    └─► tmux new-session + claude --resume <session-id>      │
│                                                             │
│  POST /api/specialists/:name/reset                          │
│    └─► Delete .session file, optionally reinitialize        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Order

### Layer 1: Backend Foundation
1. `panopticon-agl` - SQLite database module
2. `panopticon-vw4` - Specialist registry module
3. `panopticon-x55` - Specialist session management
4. `panopticon-rpk` - Cloister writes health events

### Layer 2: API Endpoints
5. `panopticon-xud` - Health history API
6. `panopticon-fyv` - Specialist API endpoints
7. `panopticon-9yw` - Poke API endpoint

### Layer 3: Frontend Components
8. `panopticon-9lh` - AgentList two sections
9. `panopticon-5f4` - SpecialistAgentCard
10. `panopticon-cbw` - IssueAgentCard
11. `panopticon-2cw` - AgentDetailView

### Layer 4: Visualizations
12. `panopticon-isv` - HealthHistoryTimeline
13. `panopticon-7um` - HealthHistoryChart (Chart.js)

## Dependencies Diagram

```
Layer 1 (Backend Foundation)
panopticon-agl ────────────────────────────┐
panopticon-vw4 ──► panopticon-x55 ─────────┤
                                           │
Layer 2 (API Endpoints)                    │
panopticon-rpk ◄───────────────────────────┤
panopticon-xud ◄───────────────────────────┘
panopticon-fyv ◄── panopticon-x55
panopticon-9yw (no deps)

Layer 3 (Frontend Components)
panopticon-9lh (no deps - can start early)
panopticon-5f4 ◄── panopticon-fyv
panopticon-cbw ◄── panopticon-9yw
panopticon-2cw (no deps)

Layer 4 (Visualizations)
panopticon-isv ◄── panopticon-xud
panopticon-7um ◄── panopticon-xud
```

## Beads Tasks Summary

| ID | Title | Layer | Status |
|----|-------|-------|--------|
| panopticon-agl | Create SQLite database module | 1 | open |
| panopticon-vw4 | Create specialist registry module | 1 | open |
| panopticon-x55 | Implement specialist session management | 1 | open |
| panopticon-rpk | Modify Cloister to write health events | 1 | open |
| panopticon-xud | Implement health history API endpoint | 2 | open |
| panopticon-fyv | Add specialist API endpoints | 2 | open |
| panopticon-9yw | Add poke API endpoint | 2 | open |
| panopticon-9lh | Update AgentList to show two sections | 3 | open |
| panopticon-5f4 | Create SpecialistAgentCard component | 3 | open |
| panopticon-cbw | Create IssueAgentCard component | 3 | open |
| panopticon-2cw | Create AgentDetailView component | 3 | open |
| panopticon-isv | Create HealthHistoryTimeline component | 4 | open |
| panopticon-7um | Create HealthHistoryChart component | 4 | open |

## Technical Notes

### SQLite Package
Use `better-sqlite3` for synchronous SQLite operations in Node.js. Already commonly used in CLI tools.

### Chart.js Setup
```bash
npm install chart.js react-chartjs-2
```

Chart configuration:
- Type: Area/line chart
- X-axis: Time (24h)
- Y-axis: State (categorical - map to numbers for visualization)
- Colors: Match health state colors (green/yellow/orange/red)

### Specialist Session Discovery
To count context tokens for a sleeping specialist:
1. Read session ID from `~/.panopticon/specialists/<name>.session`
2. Find JSONL file via Claude Code's session index or direct path search
3. Parse JSONL and sum `usage.input_tokens + usage.output_tokens`

Note: This is approximate - actual context window includes system prompt and any images.

### Poke Message Format
Standard nudge message for stuck agents:
```
You seem to have been inactive for a while. If you're stuck:
1. Check your current task in STATE.md
2. Try an alternative approach if blocked
3. Ask for help if needed

What's your current status?
```

## Open Questions

None - all decisions captured above.

## References

- PRD: `/home/eltmon/projects/panopticon/docs/PRD-CLOISTER.md`
- Phase 1 Implementation: Commit `a1a9753`
- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/27
- Existing components: `src/dashboard/frontend/src/components/`
