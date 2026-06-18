# PAN-295: Dashboard Resources Panel

## Summary

Add a Resources panel to the Overdeck dashboard providing a unified grid view of all Overdeck-managed infrastructure (containers, agents, specialists) with real-time resource monitoring via `docker stats`.

## Decisions

### Scope
- **Containers + Agents only** — no host-level system metrics (total RAM/CPU)
- Show Docker container resource usage (CPU%, memory) alongside agent/specialist status cards
- All data from `docker stats` and existing agent state files

### Grid Layout & Grouping
- **Default grouping: by issue** (e.g., PAN-123 shows its containers + agent together)
- **Toggleable** via dropdown: group by issue, type (fe/api/db/cache), or status
- Filter chips: running only, all, by project

### Polling & Real-Time
- **5-second polling interval** for `docker stats` on the server
- Server emits `resources:updated` via Socket.io → TanStack Query cache injection
- Sparkline history stored in-memory on server (last 5 min = ~60 samples at 5s intervals)

### Sparklines
- **Included in v1** — Chart.js already a dependency
- Store rolling 5-minute history per container in server memory
- Render as small inline sparklines on each container card

### Container Detail View
- **Slide-out panel** on container card click
- Shows: logs (tail), env vars, ports, uptime, resource charts (CPU/mem over time)
- Reuses existing slide-out panel patterns from workspace panels

### Agent Navigation
- **Clicking agent card navigates to Agents tab** with that agent selected
- No duplicate agent detail UI — leverage existing AgentList component

### Resource Bar Thresholds
- **0-60%**: green (healthy)
- **60-85%**: yellow (warning)
- **85%+**: red (critical)
- Applied to both CPU and memory bar charts via color gradients

### Status Indicators
- Container: running (green), stopped (red), unhealthy (yellow), restarting (orange)
- Agent: healthy (green), warning (yellow), stuck (orange), dead (red), stopped (gray)
- Specialist: sleeping (gray), active (green), uninitialized (dim)

## Architecture

### Backend (Server)

**New module: `src/lib/docker-stats.ts`**
- `DockerStatsCollector` class
- Runs `docker stats --no-stream --format '{{json .}}'` every 5 seconds via `execAsync`
- Parses CPU%, memory usage/limit, network I/O
- Maintains rolling 60-sample history per container (5 min at 5s intervals)
- Correlates containers to issues via naming conventions (existing `getContainerStatusAsync` patterns)
- Exposes: `getStats()`, `getHistory(containerId)`, `getAggregateStats()`

**New API endpoints in `src/dashboard/server/index.ts`:**
- `GET /api/resources` — all containers with current stats + agent/specialist status, grouped by issue
- `GET /api/resources/:containerId/history` — sparkline history for a container
- `GET /api/resources/:containerId/details` — detailed container info (logs, env, ports)

**New Socket.io event:**
- `resources:updated` — emitted every 5s with current stats snapshot

### Frontend

**New component: `src/dashboard/frontend/src/components/ResourcesPanel.tsx`**
- Main panel component with grouping/filter controls
- Grid of `ResourceCard` components

**New component: `ResourceCard.tsx`**
- Container card: name, status badge, CPU bar, memory bar, sparkline
- Agent card: status, model, issue, context% — clicks navigate to Agents tab

**New component: `ContainerDetailPanel.tsx`**
- Slide-out panel for container details
- Tabs: Overview, Logs, Ports/Env

**New component: `ResourceBar.tsx`**
- Reusable bar chart component with gradient coloring (green→yellow→red)

**New component: `Sparkline.tsx`**
- Small inline chart using Chart.js line chart (no axes, just the line)

**New hook: `useResourceStats.ts`**
- Socket.io listener for `resources:updated` events
- Injects data into TanStack Query cache
- Fallback 5s polling via `refetchInterval`

**App.tsx changes:**
- Add `resources` tab with `Server` or `Monitor` icon from lucide-react
- Route: `/resources`

### Data Flow

```
docker stats (5s poll)
    ↓
DockerStatsCollector (server, in-memory history)
    ↓
Socket.io emit('resources:updated', snapshot)
    ↓
useResourceStats hook → queryClient.setQueryData(['resources'], data)
    ↓
ResourcesPanel → ResourceCard[] → ResourceBar + Sparkline
```

## Files to Create/Modify

### New Files
1. `src/lib/docker-stats.ts` — DockerStatsCollector class
2. `src/dashboard/frontend/src/components/ResourcesPanel.tsx` — main panel
3. `src/dashboard/frontend/src/components/ResourceCard.tsx` — container/agent cards
4. `src/dashboard/frontend/src/components/ContainerDetailPanel.tsx` — slide-out detail
5. `src/dashboard/frontend/src/components/ResourceBar.tsx` — utilization bar
6. `src/dashboard/frontend/src/components/Sparkline.tsx` — inline sparkline chart
7. `src/dashboard/frontend/src/hooks/useResourceStats.ts` — socket + query hook

### Modified Files
1. `src/dashboard/server/index.ts` — new API routes, socket event, DockerStatsCollector init
2. `src/dashboard/frontend/src/App.tsx` — add resources tab
3. `src/dashboard/frontend/src/hooks/useSocketIssues.ts` — add `resources:updated` listener
4. `src/dashboard/frontend/src/types.ts` — add resource/container stat types

## Out of Scope
- Host-level system metrics (total RAM, CPU, disk)
- Container log streaming (just tail on detail view)
- Container management actions (start/stop/restart already exist in workspace panel)
- Persistent metrics storage (all in-memory, lost on server restart)
- Network I/O charts (just show current values in detail panel)
- Custom threshold configuration (hardcoded for v1)
