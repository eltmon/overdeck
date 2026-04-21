# Agents Page Redesign — Complete Specification

## Status: Design Complete, Awaiting PAN Issue

---

## 1. Problem Statement

The current agents page is fragmented across two separate experiences:

1. **`AgentList.tsx`** — Shows Cloister Deacon status, specialist summary, and recent activity. Does NOT show work agents. Limited to a single list/table view.
2. **`GodView/index.tsx`** — Shows work agents in a cinematic grid with CanvasTerminal previews, but lacks table/dense views, timeline history, or relationship topology. Detail view is a full-screen modal overlay that interrupts context.

Users need a single, unified agents page that:
- Brings ALL agent types together (work, planning, specialists)
- Supports multiple viewing modes for different tasks (monitoring vs debugging vs auditing)
- Keeps context when drilling into an agent (slide-out panel, not modal)
- Surfaces Cloister status as a first-class citizen
- Is information-dense without being overwhelming

---

## 2. Design Philosophy

**"Mission Control, not a Gallery"**

This page is for operators managing a fleet of agents. Every pixel must convey actionable state. Beauty comes from clarity, not decoration.

Principles:
1. **Status-first** — At a glance, know what's healthy, warning, stuck, or dead
2. **Context-preserving** — Never lose your place when inspecting an agent
3. **View-appropriate density** — Grid for scanning, table for comparison, timeline for debugging, topology for relationships
4. **Unified types** — Work agents, planning agents, and specialists are all "agents" with the same metadata shape
5. **Cloister is the conductor** — The orchestrator's status is always visible

---

## 3. Architecture Overview

### 3.1 Page Layout

```
+-------------------------------------------------------------+
| Sidebar (existing, 220px)    | Main Content Area             |
|                              |                               |
|  [Panopticon Logo]           |  +-------------------------+  |
|                              |  | Top Bar                 |  |
|  Operations                  |  | Breadcrumb | Actions     |  |
|  - Command Deck              |  +-------------------------+  |
|  - Board                     |  |                           |  |
|  - Awaiting Merge            |  |  [View Tabs]              |  |
|  - Agents (active)           |  |                           |  |
|                              |  |  [Stats Row - 4 cards]    |  |
|  Infrastructure              |  |                           |  |
|  ...                         |  |  [Cloister Banner]        |  |
|                              |  |                           |  |
|                              |  |  [Active View Content]    |  |
|                              |  |                           |  |
|                              |  +-------------------------+  |
|                              |                               |
+-------------------------------------------------------------+
```

### 3.2 Detail Panel (Slide-out)

```
+-----------------------------------+ +-----------------------+
| Main Content                      | | Detail Panel (520px)  |
|                                   | |                       |
|  [Agent Grid/Table/etc]          | |  +-----------------+  |
|                                   | |  | Header          |  |
|  +-------------------------+      | |  | ID | Close     |  |
|  | Agent Card              |  <-- | |  +-----------------+  |
|  | (click opens detail)    |      | |  | [Tabs]          |  |
|  +-------------------------+      | |  | Terminal|Info|  |  |
|                                   | |  +-----------------+  |
|                                   | |  |                   |  |
|                                   | |  | [Section Content] |  |
|                                   | |  |                   |  |
|                                   | |  +-----------------+  |
|                                   | |  | Actions Footer  |  |
+-----------------------------------+ +-----------------------+
```

The detail panel slides in from the right (transform: translateX), pushing content. An overlay scrim (40% black) appears behind it. Clicking overlay or close button dismisses. Panel state is URL-addressable via query param (`?agent=agent-pan-505`).

### 3.3 Component Tree

```
AgentsPage (new, replaces AgentList + GodView agent display)
├── TopBar
│   ├── Breadcrumb ("Orchestration Module / Agents")
│   └── Actions (Filter, Deploy Agent)
├── ViewModeTabs
│   ├── Live Grid (default)
│   ├── Command Table
│   ├── Timeline
│   └── Topology
├── StatsRow
│   ├── Active Agents (green)
│   ├── Total Cost Today (cyan)
│   ├── Cloister Patrol (purple)
│   └── Alerts (amber/red)
├── CloisterBanner
│   ├── Icon + Title + Status text
│   └── Metrics (Active, Warning, Stuck, Specialists)
├── ViewContent (switches by mode)
│   ├── LiveGridView
│   │   ├── SectionHeader (with phase filter chips)
│   │   └── AgentGrid
│   │       └── AgentCard (×N)
│   ├── CommandTableView
│   │   └── AgentTable
│   ├── TimelineView
│   │   └── TimelineEventList
│   └── TopologyView
│       └── TopologyCanvas
├── RightPanel (persistent, 280px, shows when no detail open)
│   ├── ActivityFeed
│   ├── PhaseDistribution (donut)
│   └── SystemHealth (gauges)
└── AgentDetailPanel (slide-out, 520px, conditional)
    ├── DetailHeader
    ├── DetailTabs (Terminal, Info, Beads, Files, Timeline)
    ├── DetailBody
    └── DetailActions
```

---

## 4. Visual Design System

### 4.1 Color Palette (Obsidian Dark)

| Token | Value | Usage |
|-------|-------|-------|
| `--obsidian-base` | `#0c0f16` | Page background |
| `--obsidian-raised` | `#141820` | Card backgrounds |
| `--obsidian-overlay` | `#1c2130` | Hover states, overlays |
| `--obsidian-emphasis` | `#252b3b` | Borders, dividers |
| `--obsidian-border` | `rgba(255,255,255,0.06)` | Default borders |
| `--obsidian-border-bright` | `rgba(255,255,255,0.12)` | Hover borders |

### 4.2 Signal Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--signal-green` | `#22c55e` | Healthy, success, active |
| `--signal-amber` | `#f59e0b` | Warning, needs attention |
| `--signal-red` | `#ef4444` | Stuck, error, dead |
| `--signal-blue` | `#3b82f6` | Primary actions, info, links |
| `--signal-purple` | `#a855f7` | Review phase, specialists |
| `--signal-cyan` | `#06b6d4` | Cost/money metrics |

### 4.3 Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display | Space Grotesk | 600-700 | Page titles, section headers, stats |
| Body | Inter | 400-500 | Card text, descriptions, labels |
| Mono | JetBrains Mono | 400-500 | Agent IDs, costs, timestamps, terminal |

Text hierarchy:
- Page title: 20px, weight 700, `--text-primary`
- Section title: 14px, weight 600, `--text-secondary`
- Card title (agent ID): 13px, weight 500, mono, `--text-primary`
- Body: 12-13px, weight 400, `--text-secondary`
- Meta/labels: 10-11px, weight 500, uppercase, letter-spacing 0.08-0.15em, `--text-muted`

### 4.4 Spacing & Radius

- Border radius: 6px (sm), 8px (md), 12px (lg)
- Card padding: 14-16px
- Section gap: 20px
- Grid gap: 12px
- Stats row gap: 12px

### 4.5 Shadows & Elevation

- Card hover: `0 8px 24px rgba(0,0,0,0.3)`
- Detail panel: `-20px 0 60px rgba(0,0,0,0.5)`
- Selected card: `0 0 0 1px var(--signal-blue), 0 8px 24px rgba(59,130,246,0.1)`

### 4.6 Animations

- Card hover: `transform: translateY(-2px)`, 200ms, `cubic-bezier(0.4, 0, 0.2, 1)`
- Detail slide: `transform: translateX()`, 300ms, same easing
- Overlay fade: `opacity`, 300ms
- Pulse (stuck agents): 1.5s ease-in-out infinite, `opacity 1→0.6`, box-shadow expands
- Patrol dot: 2s ease-in-out infinite, `scale(1)→scale(0.8)`, `opacity 1→0.5`

---

## 5. View Modes (Detailed)

### 5.1 Live Grid (Default)

**Purpose:** Scanning agent health and activity at a glance. Best for: "What's happening right now?"

**Layout:**
- CSS Grid: `repeat(auto-fill, minmax(300px, 1fr))`, gap 12px
- Section header above grid with phase filter chips (All, Planning, Implementation, Review, Testing)

**Agent Card Structure:**
```
+----------------------------------+
| ▍Agent ID          [Phase] [●]  |  ← accent bar (3px left), ID mono, phase badge, status dot
|                                  |
|  $ pan plan PAN-505 --model...   |  ← terminal preview (3 lines, 10px mono)
|  ✓ PRD loaded from docs/...      |     color-coded prefixes: $=blue, ✓=green, !=amber, ✗=red
|  → Analyzing 14 source files...  |
|                                  |
|  [Model] [Uptime]        $14.29  |  ← footer: model icon+name, clock icon+time, cost pill (cyan)
+----------------------------------+
```

**Card States:**
- Default: border `--obsidian-border`
- Hover: border brightens, `translateY(-2px)`, shadow appears
- Selected: blue border + blue glow shadow
- Stuck status dot: pulsing red animation

**Accent Bar Colors by Health:**
- Healthy: green
- Warning: amber
- Stuck: red + pulse animation
- Dead: dim gray

**Accent Bar Colors by Phase (fallback if health is normal):**
- Planning: amber
- Implementation: blue
- Review: purple
- Testing: green

**Terminal Preview:**
- Background: `rgba(0,0,0,0.35)`
- Font: 10px JetBrains Mono, line-height 1.5
- 3 lines max, `text-overflow: ellipsis`
- Color prefixes: `.ok` (green), `.warn` (amber), `.err` (red), `.info` (blue)
- Content: last 3 lines of agent terminal output (from WebSocket or API)

**Card Footer:**
- Left: CPU/icon + model name, clock icon + uptime
- Right: Cost pill (`$X.XX`, cyan background `rgba(6,182,212,0.08)`, rounded)

### 5.2 Command Table

**Purpose:** Dense comparison of all agents. Best for: "Which agent is costing the most?", "Sort by uptime"

**Layout:** Full-width table, 13px font

**Columns:**
| Column | Content | Style |
|--------|---------|-------|
| Agent ID | `agent-{issue}` | 12px mono, `--text-primary` |
| Issue | `PAN-505` | 11px mono, `--signal-blue` |
| Phase | Planning / Implementation / Review / Testing | Phase badge (same as grid) |
| Model | opus-4.6 / sonnet-4.6 | 12px body |
| Status | Healthy / Warning / Stuck / Dead | Status pill with dot |
| Uptime | 2h 14m | 11px mono, `--text-muted` |
| Cost | $14.29 | 12px mono, `--signal-cyan`, weight 500 |
| Actions | Stop / Kill / View | Icon buttons |

**Row Hover:** `background: rgba(255,255,255,0.02)`
**Header:** 10px uppercase, letter-spacing 0.12em, `--text-muted`
**Sortable:** Click headers to sort (default: status severity desc, then uptime desc)

### 5.3 Timeline

**Purpose:** Chronological event history. Best for: "What happened to this agent?", "When did the stuck state begin?"

**Layout:** Vertical timeline with left border line

**Structure:**
```
    ●  2m ago
    |  STARTED
    |  agent-pan-505 spawned with opus-4.6
    |
    ●  1h 23m ago
    |  COMMIT
    |  agent-min-826 pushed 3 files
    |
    ○  2h 14m ago
       STOPPED
       agent-krux-12 completed successfully
```

**Timeline Dot Colors by Event Type:**
- `started`: green
- `stopped`: dim gray
- `error`: red
- `commit`: blue
- `complete`: purple

**Line:** 1px solid `--obsidian-emphasis`, left of events
**Dot:** 9px circle with 2px border matching background (creates cutout effect)
**Time:** 11px mono, `--text-dim`
**Type:** 11px uppercase, weight 600, letter-spacing 0.08em, colored by type
**Message:** 12px, `--text-secondary`
**Agent ref:** 11px mono, `--signal-blue`

**Events to display:**
- Agent spawn/stop
- Phase transitions
- Health status changes
- Commits pushed
- Cost threshold crossings
- Human interventions (tell, kill, approve)
- Cloister patrol actions

### 5.4 Topology

**Purpose:** Visualize agent relationships and dependencies. Best for: "Which agents are blocking others?"

**Layout:** Canvas area (500px min height), absolute-positioned nodes + connecting lines

**Nodes:**
- Central node: Cloister Deacon (larger, blue-tinted background)
- Agent nodes: Positioned around center in a force-directed or radial layout
- Each node shows: agent ID (mono), issue ref, status indicator dot

**Node Styling:**
- Background: `--obsidian-overlay`
- Border: `--obsidian-border`
- Hover: blue border + glow shadow
- Central node: `rgba(59,130,246,0.08)` bg, `rgba(59,130,246,0.3)` border

**Connections:**
- Solid line: agent belongs to project
- Dashed line: agent blocks another agent (same project dependency)
- Line color: `--obsidian-emphasis` default

**Interactivity:**
- Click node → opens detail panel for that agent
- Hover node → highlights connections
- Zoom/pan (optional Phase 2)

**Data model:**
- Nodes: all agents + Cloister central node
- Edges: `belongs-to-project` (agent→project), `blocks` (agent→agent via issue dependency)

---

## 6. Cloister Banner

Always visible below stats row, above view content.

```
+--------------------------------------------------------------------------+
| [▶ Icon]  Cloister Deacon          8 Active    2 Warning    2 Stuck    3 Specialists  [Stop Patrol] |
|           ● Lifecycle manager...                                          |
+--------------------------------------------------------------------------+
```

**Layout:** Flex row, space-between
**Left side:**
- Icon: 36px rounded square, blue-tinted bg (`rgba(59,130,246,0.1)`), blue border
- Title: 14px Space Grotesk weight 600
- Status text: 11px, `--text-muted`, with pulsing green dot

**Right side:**
- 4 metrics in a row, each: value (16px mono weight 600, colored) + label (9px uppercase)
- Values: Active (green), Warning (amber), Stuck (red), Specialists (default)
- Optional: Start/Stop Patrol button (ghost style)

**States:**
- Patrolling: pulsing green dot, "Last check Xs ago"
- Stopped: gray dot, "Patrol loop stopped"

---

## 7. Stats Row

Four cards in a grid, always visible.

| Card | Label | Value | Meta | Color |
|------|-------|-------|------|-------|
| 1 | Active Agents | `12` | `● 8 healthy, 2 warning, 2 stuck` | Green |
| 2 | Total Cost Today | `$142.39` | `+$23.12 from yesterday` | Cyan |
| 3 | Cloister Patrol | `Patrolling` | `● Last check 14s ago` | Purple |
| 4 | Alerts | `2 stuck` | `1 needs input · 0 dead` | Amber/Red |

**Card styling:**
- Background: `--obsidian-raised`
- Border: `--obsidian-border`
- Top accent bar: 2px, colored by card theme
- Value: 28px Space Grotesk weight 700
- Label: 10px uppercase, letter-spacing 0.12em, `--text-muted`
- Meta: 12px, `--text-muted`
- Pulse dot in meta: 6px, breathing animation

---

## 8. Right Panel (Persistent)

280px width, visible when no agent detail is open. Shows at viewport widths >1200px.

### 8.1 Activity Feed

Last 8-10 events, condensed format:
```
2m    ●  agent-pan-505 started
14m   ●  Cloister promoted MIN-826
1h    ✗  agent-pan-442 stuck (test failure)
```

- Time: 10px mono, `--text-dim`, min-width 36px
- Dot: 6px circle, colored by event type
- Text: 12px, `--text-secondary`
- Issue refs: mono, `--signal-blue`

### 8.2 Phase Distribution (Donut Chart)

CSS `conic-gradient` donut showing agent count by phase:
- Planning: amber
- Implementation: blue
- Review: purple
- Testing: green

Legend below with count per phase.

### 8.3 System Health Gauges

Vertical bar gauges showing:
- API Latency (ms)
- Event Queue Depth
- Memory Usage

Each: label left, value right, 4px bar fill.

---

## 9. Agent Detail Panel (Slide-out)

520px wide, slides from right. NOT a modal — main content remains visible.

### 9.1 Header

```
agent-pan-505                                [X]
Planning  ·  opus-4.6  ·  2h 14m  ·  $14.29
```

- Agent ID: 18px mono weight 600
- Subtitle row: phase badge, model, uptime, cost
- Close button: X icon, top-right

### 9.2 Tabs

| Tab | Content |
|-----|---------|
| **Terminal** | Live terminal output (same as GodView) |
| **Info** | Agent metadata grid (2 columns) |
| **Beads** | Beads task list / vBRIEF plan |
| **Files** | Changed files tree |
| **Timeline** | This agent's event history |

Tab style: 11px uppercase, underline active indicator in blue.

### 9.3 Terminal Tab

- Black background (`rgba(0,0,0,0.5)`)
- 11px JetBrains Mono
- Min-height 200px
- Scrollable
- Same terminal component as GodView (reuse `CanvasTerminal` or equivalent)

### 9.4 Info Tab

2-column grid of info items:
```
+---------------+---------------+
| Issue         | Model         |
| PAN-505       | opus-4.6      |
+---------------+---------------+
| Phase         | Status        |
| Planning      | Healthy       |
+---------------+---------------+
| Started       | Uptime        |
| 2:14 PM       | 2h 14m        |
+---------------+---------------+
| Cost          | Workspace     |
| $14.29        | pan-505/      |
+---------------+---------------+
```

Each item: label (10px uppercase dim) + value (12px mono)

### 9.5 Actions Footer

Sticky bottom bar with buttons:
- **Send Message** (ghost) → Opens message input
- **Stop Agent** (amber outline) → Graceful stop
- **Kill Agent** (red outline) → Force kill
- **View Workspace** (primary blue) → Opens workspace in new tab

---

## 10. Data Requirements

### 10.1 Agent Object (Unified)

All agent types share this shape:

```typescript
interface UnifiedAgent {
  id: string;                    // "agent-pan-505"
  issueId: string;               // "PAN-505"
  type: 'work' | 'planning' | 'specialist';
  specialistType?: 'merge-agent' | 'review-agent' | 'test-agent';
  runtime: 'docker' | 'local' | 'remote';
  model: string;                 // "opus-4.6"
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  phase: 'planning' | 'implementation' | 'review' | 'testing' | 'idle';
  isRunning: boolean;
  hasPendingQuestion: boolean;
  uptimeSeconds: number;
  costCents: number;             // Aggregated from usage logs
  startedAt: string;             // ISO timestamp
  lastActivityAt: string;
  workspacePath?: string;
  tmuxSession?: string;
  // For terminal preview (last 3 lines)
  terminalPreview?: string[];
}
```

### 10.2 API Endpoints Needed

| Endpoint | Purpose |
|----------|---------|
| `GET /api/agents` | List all unified agents (work + planning + specialists) |
| `GET /api/agents/:id` | Full agent details |
| `GET /api/agents/:id/timeline` | Event history for agent |
| `GET /api/agents/:id/terminal?lines=3` | Terminal preview lines |
| `POST /api/agents/:id/stop` | Graceful stop |
| `POST /api/agents/:id/kill` | Force kill |
| `POST /api/agents/:id/tell` | Send message |
| `GET /api/agents/topology` | Nodes + edges for topology view |
| `GET /api/activity?limit=20` | Recent activity feed (already exists) |

### 10.3 Existing Endpoints to Reuse

- `GET /api/cloister/status` — Cloister banner data
- `GET /api/specialists` — Specialist list (transform to UnifiedAgent)
- `GET /api/workspaces` — Work agents (transform to UnifiedAgent)
- WebSocket `/ws/rpc` — Real-time agent status updates
- WebSocket `/ws/terminal?session=X` — Live terminal streaming

### 10.4 Real-time Updates

The page must subscribe to domain events via `/ws/rpc`:
- `AgentSpawned` — Add to grid/table
- `AgentStopped` — Update status to dead
- `AgentStatusChanged` — Update health/phase
- `AgentQuestionPending` — Show question indicator
- `CloisterPatrolCompleted` — Update banner metrics
- `CostUpdated` — Update cost display

---

## 11. Interactions & Behaviors

### 11.1 View Switching

- Click tab → instant content swap (no page reload)
- Active tab: blue text + blue bottom border
- URL updates: `?view=grid|table|timeline|topology`
- Default: `grid`
- View preference saved to localStorage

### 11.2 Agent Selection

- Click agent card/table row/topology node → opens detail panel
- URL updates: `?agent=agent-pan-505` (preserves view: `?view=grid&agent=agent-pan-505`)
- Selected agent highlighted in current view (blue border on card, blue row bg in table)
- Press Escape → close detail panel
- Click overlay scrim → close detail panel

### 11.3 Filtering

- Phase filter chips (grid view): All, Planning, Implementation, Review, Testing
- Click chip → filter grid to that phase
- Multiple chips selectable? No — single select ("All" = no filter)
- Filter state in URL: `?phase=implementation`

### 11.4 Filtering (Global)

- "Filter" button in top bar → opens filter dropdown/popover
- Filter by: status, phase, model, project, cost range
- Search: free-text matches agent ID, issue ID, or terminal content

### 11.5 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close detail panel |
| `1-4` | Switch view mode (1=Grid, 2=Table, 3=Timeline, 4=Topology) |
| `j/k` | Navigate agents in table view |
| `Enter` | Open selected agent detail |
| `r` | Refresh data |

### 11.6 Empty States

- No agents: "No active agents" with deploy button
- No agents in filtered view: "No agents match filters" with clear filters link
- No timeline events: "No events yet"
- No topology data: "Insufficient data for topology"

---

## 12. Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| >1400px | Show right panel (280px) alongside main content |
| 1200-1400px | Hide right panel, detail panel still 520px |
| <1200px | Detail panel becomes full-width overlay (not slide-out), right panel hidden |
| <768px | Stack stats row 2×2, grid single column, table horizontal scroll |

---

## 13. Implementation Plan

### Phase 1: Foundation
1. Create `AgentsPage.tsx` shell with layout, top bar, view tabs
2. Implement `StatsRow` and `CloisterBanner` components
3. Implement `ViewModeTabs` with URL sync
4. Add `UnifiedAgent` type and data transformation layer
5. Wire up existing APIs (`/api/cloister/status`, `/api/specialists`, workspaces)

### Phase 2: Live Grid
1. Implement `AgentCard` component with terminal preview
2. Implement `AgentGrid` with phase filtering
3. Add hover/selected states
4. Wire terminal preview endpoint

### Phase 3: Detail Panel
1. Implement `AgentDetailPanel` slide-out component
2. Implement tab system (Terminal, Info, Beads, Files, Timeline)
3. Wire terminal streaming via WebSocket
4. Add action buttons (Stop, Kill, Tell, View Workspace)

### Phase 4: Additional Views
1. Implement `CommandTableView` with sorting
2. Implement `TimelineView`
3. Implement `TopologyView` (basic CSS positioning)

### Phase 5: Polish
1. Add right panel (Activity, Donut, Gauges)
2. Keyboard shortcuts
3. Empty states
4. Responsive breakpoints
5. Performance: virtualize large grids

---

## 14. File Structure

```
src/dashboard/frontend/src/components/AgentsPage/
├── index.tsx                 # Main page component
├── TopBar.tsx
├── ViewModeTabs.tsx
├── StatsRow.tsx
├── CloisterBanner.tsx
├── views/
│   ├── LiveGridView.tsx
│   ├── AgentCard.tsx
│   ├── CommandTableView.tsx
│   ├── TimelineView.tsx
│   ├── TopologyView.tsx
│   └── index.ts
├── detail/
│   ├── AgentDetailPanel.tsx
│   ├── DetailTabs.tsx
│   ├── TerminalTab.tsx
│   ├── InfoTab.tsx
│   ├── BeadsTab.tsx
│   ├── FilesTab.tsx
│   └── TimelineTab.tsx
├── right-panel/
│   ├── RightPanel.tsx
│   ├── ActivityFeed.tsx
│   ├── PhaseDistribution.tsx
│   └── SystemHealth.tsx
├── hooks/
│   ├── useAgents.ts          # Unified agent fetching
│   ├── useAgentDetail.ts
│   ├── useAgentTimeline.ts
│   └── useViewMode.ts        # URL + localStorage sync
└── types.ts                  # UnifiedAgent, AgentEvent, etc.
```

**Files to modify:**
- `src/dashboard/frontend/src/App.tsx` — Route `agents` tab to new `AgentsPage`
- `src/dashboard/frontend/src/types.ts` — Add `UnifiedAgent` type

**Files to deprecate (keep for reference, remove from routing):**
- `src/dashboard/frontend/src/components/AgentList.tsx`
- `src/dashboard/frontend/src/components/GodView/index.tsx` (or repurpose as separate page)

---

## 15. Acceptance Criteria

- [ ] All agent types (work, planning, specialists) appear in a single unified list
- [ ] Four view modes function: Grid (default), Table, Timeline, Topology
- [ ] Detail panel slides out from right, does not use modal overlay
- [ ] Cloister banner is always visible with real metrics
- [ ] Stats row shows active count, cost, patrol status, alerts
- [ ] Agent cards show live terminal preview (last 3 lines)
- [ ] Table view supports sorting by all columns
- [ ] Timeline shows chronological events with color-coded types
- [ ] Topology shows agents with relationship lines
- [ ] Real-time updates via WebSocket reflect in all views
- [ ] URL is addressable: `?view=grid&agent=agent-pan-505`
- [ ] View mode preference persists in localStorage
- [ ] Keyboard shortcuts work (Esc, 1-4, j/k, Enter)
- [ ] Responsive at 768px, 1200px, 1400px breakpoints
- [ ] Right panel shows activity feed, phase distribution, health gauges
- [ ] Detail panel has Terminal, Info, Beads, Files, Timeline tabs
- [ ] All existing functionality preserved (stop, kill, tell, view workspace)
- [ ] Dark theme only, matches existing obsidian design system
- [ ] No new dependencies (use existing React, CSS, WebSocket)

---

## 16. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unified agent type conflicts with existing types | Medium | Create adapter layer, don't modify existing APIs |
| Terminal preview performance (fetching every card) | High | Batch preview API, debounce, or use WebSocket push |
| Large agent count (>50) grid performance | Medium | Virtualize grid, lazy-load terminal previews |
| Topology view complexity | Low | Phase 4 — start with simple CSS positioning |
| Detail panel state management | Medium | Use URL query params as source of truth |

---

## 17. Open Questions

1. Should we keep God View as a separate page or redirect to Agents with a specific view mode?
2. Should the topology use a proper graph library (d3, cytoscape) or stay CSS-based?
3. Should we add a "Compare" mode for side-by-side agent inspection?
4. Cost data: is it already aggregated per agent or do we need a new endpoint?
5. Should terminal preview auto-refresh or be push-based via WebSocket?
