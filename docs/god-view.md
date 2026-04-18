# God View — Real-time Agent Activity Command Center

The God View is a full-screen dashboard tab providing a real-time overview of all active agents. It is designed for operators who need to monitor multiple concurrent agents at a glance.

## Access

Navigate to the **God View** tab (Zap icon) in the Panopticon dashboard header, or visit `/god-view` directly.

## Layout

```
┌────────────────────────────────────────────────────┐
│  Top Bar: Logo · Clock · CPU/MEM sparklines · Badge │
├───────────────────────────────┬────────────────────┤
│                               │  Activity Feed     │
│      Agent Grid               ├────────────────────┤
│   (glassmorphism cards)       │  Agent Donut       │
│   with connection lines       ├────────────────────┤
│                               │  System Gauges     │
└───────────────────────────────┴────────────────────┘
```

Clicking any agent card opens the **Focus View** overlay.

## Components

### Top Bar
- **Animated logo** with breathing glow
- **System clock** (24-hour)
- **CPU and memory sparklines** (from `/api/godview/system-health`, refreshed every 10s)
- **Active agent badge** — count of non-stopped agents with pulse animation

### Agent Grid
- **Auto-fill CSS grid** — adapts to any number of agents
- Each card shows:
  - Issue ID and phase badge (planning / implementation / exploration)
  - Live **status pill** (healthy / warning / stuck / dead / stopped) with pulse animation
  - **Canvas terminal preview** — last 3 lines of tmux output, rendered with ANSI color support
  - Git branch
  - Model name and uptime counter
- **Connection lines** — dashed SVG lines connect agents sharing the same issue prefix (e.g., all PAN-341 agents)
- **Framer Motion** — cards animate in/out with `AnimatePresence`

### Right Sidebar
- **Live activity feed** — global events from all agents (commits, errors, handoffs), sliding in from the right
- **Agent donut chart** (visx) — agent count by phase
- **System gauges** (visx) — CPU and memory arc gauges

### Focus View
Clicking an agent card opens a modal with:
- **Large canvas terminal** — 12 lines of live output
- **Task list** — bead tasks parsed from agent activity
- **Changed files tree** — `git diff --name-status` output via `/api/agents/:id/files`
- **Event timeline** — chronological events via `/api/agents/:id/timeline`
- **Action bar** — Send message, view files, stop agent

## Real-time Data

God View now consumes the shared dashboard read model instead of a God-View-specific event stream.

- **Agent output** comes from `agent.output_received` domain events stored in `DashboardStore.agentOutputById`
- **Agent status** comes from `agent.status_changed` domain events stored in `DashboardStore.agentsById`
- **Activity feed** comes from `activity.entry` / `activity.updated` events stored in `DashboardStore.recentActivity`
- **Activity bootstrap** also reads `GET /api/activity` on load so historical activity appears immediately before the next live event arrives
- **System health** still comes from `/api/godview/system-health`

## REST Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/agents/:id/files` | Files touched by agent (git diff HEAD) |
| `GET /api/agents/:id/timeline` | Event timeline (health events + activity.jsonl) |
| `GET /api/godview/system-health` | CPU, memory stats (cached 10s) |

## Design System

The God View uses a scoped CSS design system (`GodView/theme.css`):

```css
--gv-bg: #0a0e1a          /* Dark navy background */
--gv-blue: #00d4ff         /* Electric blue accent */
--gv-pink: #ff2d7c         /* Hot pink (error/stuck) */
--gv-green: #39ff14        /* Neon green (healthy) */
--gv-amber: #ffb800        /* Amber (warning) */
--gv-font-display: 'Space Grotesk'
--gv-font-mono: 'JetBrains Mono'
```

Glassmorphism panels use `backdrop-filter: blur(12px)` with semi-transparent backgrounds.

## Dependencies

| Package | Usage |
|---------|-------|
| `framer-motion` | Card animations, AnimatePresence, layout transitions |
| `@visx/shape` | Arc and arc shapes for donut/gauge charts |
| `@visx/group` | SVG group positioning |
| `@visx/scale` | Color scales for charts |
| `@fontsource/space-grotesk` | Display font (self-hosted, zero FOUT) |
| `@fontsource/jetbrains-mono` | Terminal/code font |
