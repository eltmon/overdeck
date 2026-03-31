# PAN-341: God View — Real-time Agent Activity Command Center

## Status: PLANNING COMPLETE

## Decisions Made

### Navigation
- **New tab** at `/god-view` (13th tab) — does NOT replace mission-control
- Added to Header tab bar alongside existing tabs

### Visual Design
- **Theme**: Dark navy (#0a0e1a) background, neon accents, glassmorphism panels
- **Font**: Space Grotesk (display) + JetBrains Mono (terminal) via `@fontsource` (self-hosted, zero FOUT)
- **Palette**: Electric blue #00d4ff, Hot pink #ff2d7c, Neon green #39ff14, Amber #ffb800
- **Effects**: Glassmorphism (backdrop-blur, semi-transparent backgrounds), breathing glow borders, pulsing status indicators

### Terminal Rendering
- **Canvas-rendered text** for agent card mini-previews (last 3-4 lines)
- Custom `<canvas>` renderer with JetBrains Mono, syntax-highlighted output
- Large terminal in focus view also canvas-rendered (30 lines)

### Animations
- **CSS @keyframes** for simple effects: breathing glow borders, pulsing status pills, color transitions
- **Framer Motion** for complex layout animations: card appear/disappear (AnimatePresence), connection line drawing, slide-in activity feed items, grid layout transitions

### Charts (visx)
- **visx** (D3 primitives) for all data visualizations
- Cost donut chart (sidebar)
- System health sparklines (top bar)
- Cost breakdown stacked bar chart (focus view)
- Infrastructure gauge arcs (sidebar)

### Real-time Data
- **New Socket.io events** for God View streaming:
  - `godview:agent-output` — terminal output per agent (debounced, last 30 lines)
  - `godview:status-change` — agent status transitions
  - `godview:activity` — global activity feed events (commits, tests, errors, status changes)
- Existing `/api/agents` (5s poll) for agent list baseline
- Cost data: cached server-side, pushed every 30s

### New Server Endpoints
- `GET /api/agents/:id/files` — files touched by agent (git diff integration)
- `GET /api/agents/:id/timeline` — agent event timeline from health_events + activity.jsonl
- `GET /api/godview/system-health` — CPU, memory, disk stats for gauges

### Scope
- **Full scope** — all features in the spec including connection lines between agents and file activity tree

## Architecture

### Frontend Component Tree
```
GodViewPage (new tab component)
├── GodViewTopBar
│   ├── LogoGlow (animated logo)
│   ├── SystemClock
│   ├── HealthSparklines (visx)
│   ├── ActiveAgentBadge
│   └── DailyCostTrend
├── GodViewGrid (75% viewport)
│   ├── AgentCard[] (dynamic grid, glassmorphism)
│   │   ├── ProjectColorBorder
│   │   ├── StatusPill (pulse animation)
│   │   ├── CanvasTerminalPreview (3-4 lines)
│   │   ├── FileBreadcrumb
│   │   ├── ToolIndicators
│   │   ├── ModelBadge + Cost + Tokens
│   │   ├── BeadsProgressBar
│   │   └── UptimeCounter
│   └── ConnectionLines (SVG overlay)
├── GodViewSidebar (25% viewport)
│   ├── LiveActivityFeed (slide-in items)
│   ├── CostDonutChart (visx)
│   └── InfrastructureGauges (visx arcs)
└── AgentFocusView (click-through overlay/page)
    ├── FocusHeader
    ├── LargeCanvasTerminal (30 lines)
    ├── BeadsKanban (horizontal dots)
    ├── FileActivityTree
    ├── CostBreakdownChart (visx stacked bar)
    ├── AgentTimeline (vertical)
    └── ActionBar (pause, message, diff, terminal, kill)
```

### Design System (God View scope)
- CSS custom properties scoped under `.god-view` class
- Glassmorphism mixin: `background: rgba(21, 27, 43, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(30, 38, 56, 0.8);`
- Glow effects via `box-shadow` with status-color matching
- All colors as CSS variables for consistency

### Data Flow
```
Server:
  tmux capture-pane (debounced 2s) → godview:agent-output
  health state changes → godview:status-change
  cloister events + git commits → godview:activity
  os.cpus() + os.freemem() (every 10s) → system-health cache

Frontend:
  Socket.io listeners → Zustand store (GodView state)
  React Query → /api/agents (5s), /api/godview/system-health (10s)
  Canvas refs → requestAnimationFrame terminal rendering
  visx → SVG charts with animation
```

### New Dependencies
- `framer-motion` — layout animations, AnimatePresence
- `@visx/shape`, `@visx/group`, `@visx/scale`, `@visx/axis`, `@visx/text` — D3 chart primitives
- `@fontsource/space-grotesk` — display font
- `@fontsource/jetbrains-mono` — terminal/code font

### Performance Considerations
- Canvas terminal previews: only render when visible (IntersectionObserver)
- Terminal output debounced server-side (2s), last 30 lines max
- Cost data cached 30s server-side
- System health cached 10s
- Agent grid uses CSS Grid with `auto-fill` for responsive layout
- Connection lines recalculated on grid layout changes only (ResizeObserver)
- Framer Motion `layout` prop for smooth grid transitions
- Socket.io room-based: only stream agent output for agents visible on screen

## File Impact

### New Files (~15-20 new component files)
- `src/dashboard/frontend/src/components/GodView/` — all God View components
- `src/dashboard/frontend/src/components/GodView/index.tsx` — main page
- `src/dashboard/frontend/src/components/GodView/TopBar.tsx`
- `src/dashboard/frontend/src/components/GodView/AgentCard.tsx`
- `src/dashboard/frontend/src/components/GodView/AgentGrid.tsx`
- `src/dashboard/frontend/src/components/GodView/CanvasTerminal.tsx`
- `src/dashboard/frontend/src/components/GodView/Sidebar.tsx`
- `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx`
- `src/dashboard/frontend/src/components/GodView/CostDonut.tsx`
- `src/dashboard/frontend/src/components/GodView/InfraGauges.tsx`
- `src/dashboard/frontend/src/components/GodView/ConnectionLines.tsx`
- `src/dashboard/frontend/src/components/GodView/FocusView.tsx`
- `src/dashboard/frontend/src/components/GodView/BeadsKanban.tsx`
- `src/dashboard/frontend/src/components/GodView/FileActivityTree.tsx`
- `src/dashboard/frontend/src/components/GodView/AgentTimeline.tsx`
- `src/dashboard/frontend/src/components/GodView/ActionBar.tsx`
- `src/dashboard/frontend/src/components/GodView/theme.css` — God View design system
- `src/dashboard/frontend/src/hooks/useGodViewSocket.ts` — Socket.io hook for God View events

### Modified Files
- `src/dashboard/frontend/src/App.tsx` — add god-view tab route
- `src/dashboard/frontend/src/components/Header.tsx` — add God View tab
- `src/dashboard/server/index.ts` — new Socket.io events + REST endpoints
- `src/dashboard/frontend/package.json` — new deps
- `src/dashboard/frontend/vite.config.ts` — possibly font config
- `docs/INDEX.md` — add god-view docs link
- `docs/dashboard.md` — document God View page

### New Documentation
- `docs/god-view.md` — feature guide
