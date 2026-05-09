# PAN-965: Command Deck — Hierarchical Resource Tree Under Issues

## Status

Planned. Extends PAN-821 (session tree) and PAN-862 (resource icon strip). Does not replace either — adds a new expandable resource subtree alongside sessions.

## TL;DR for the engineer picking this up

> You're adding an expandable "Resources" section underneath each issue's session list in the Command Deck project tree. Today, issues expand to show sessions (planning, work, review, test, merge). After this work, they also expand to show containers, branches, PRs, and other allocated resources as first-class tree nodes — with live status, health indicators, and context menus.
>
> The resource icon strip on the issue row (PAN-862) stays. It's a glanceable summary. The new tree is the detail view you get when you want to see *which* containers, *which* branches, and *what state* they're in.
>
> Containers are the star of this feature. They get live CPU/memory sparklines, health status dots, and a right-click menu (logs, restart, stop). Other resources (branches, PRs, tmux sessions) get appropriate detail and actions too, but containers are the primary motivation.

## Problem

When working across multiple projects (e.g., `panopticon-cli` and `mind-your-now`), the Command Deck shows agents under each project's issues but gives no visibility into the infrastructure supporting them. A MYN issue like MIN-846 has 4 Docker containers running (API, frontend, PostgreSQL, Redis), but the only way to see them is:

1. **Resource icon strip** (PAN-862) — a tiny docker icon on the issue row, hover to see a count ("4 containers"). No status, no names, no actions.
2. **Inspector panel** (`ContainerSection.tsx`) — a separate panel you have to open, which shows container chips with status dots. Accessible but disconnected from the session tree.
3. **Resources page** (`/api/resources`) — a standalone page with container cards and CPU/memory sparklines. Completely separate navigation.

The information exists in three places, none of which are *in the tree where you're already looking at the agents*. The mental model is: "this issue has agents doing work, and those agents need infrastructure to run." The tree shows one half of that picture and hides the other.

### What the user wants

```
<Project: mind-your-now>
├── MIN-846  [$12.40]  In Review
│   ├── planning              ○ ended
│   ├── work                  ○ ended
│   ├── review                ◐ alive, active
│   │   ├── reviewer/correctness   ○ ended
│   │   ├── reviewer/security      ◐ alive
│   │   └── ...
│   └── 🔧 Resources (4)
│       ├── 🐳 api            ● healthy  cpu 12%  mem 340MB
│       ├── 🐳 frontend       ● healthy  cpu 3%   mem 128MB
│       ├── 🐳 postgres       ● healthy  cpu 1%   mem 96MB
│       ├── 🐳 redis          ● healthy  cpu 0%   mem 24MB
│       ├──  feature/MIN-846              (local + remote)
│       └── 🔀 PR #142  "Add briefing redesign"   (open, checks passing)
```

Containers are siblings of sessions under the issue — not children of a specific session — because containers serve the entire workspace, not a single agent.

## Goal

Add a collapsible "Resources" group node under each issue in the Command Deck project tree, with individual child nodes for each container, branch, and PR allocated to that issue. Container nodes show live health and resource usage. All resource nodes have context menus with appropriate actions.

## Relationship to existing work

| Surface | Status after this PRD |
|---|---|
| **Resource icon strip** (PAN-862, `FeatureItem.tsx`) | **Unchanged.** The strip remains as a glanceable summary on the issue row. It shows *which resource categories* are present. The new tree shows the detail. |
| **Inspector panel** (`ContainerSection.tsx`) | **Unchanged.** Inspector stays as a separate detail panel. The tree provides quick access to the same container actions without opening the inspector. |
| **Resources page** (`/api/resources`) | **Unchanged.** The Resources page is for system-wide resource monitoring. The tree is scoped to a single issue. |
| **PAN-957** (workspace pane container health) | **Complementary.** PAN-957 focuses on service health checks (not just "Up"). This PRD focuses on tree placement and hierarchy. Both share the same underlying data. |
| **Zone A container health** (PAN-830) | **Complementary.** Zone A shows aggregate container health for the selected issue ("3 healthy, 1 warning"). The tree shows the individual containers. |

## Non-goals

- Changing the container discovery mechanism. `resource-discovery.ts` already discovers containers via `parseIssueIdFromText()` on container names — this works for all current naming conventions (`myn-feature-min-846-api-1`, etc.).
- Adding Docker compose management (start/stop entire stacks). Individual container operations only.
- Replacing the Resources page or Inspector panel.
- Showing containers for issues that don't have any — the Resources group only renders when `resourceDetails.dockerContainerCount > 0` or other resources exist.
- Adding new resource categories beyond what `ResourceSource` already tracks.

## Data inventory

### Resources group node (new)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Group label ("Resources") | Static | No | — |
| Resource count badge | `resourceDetails.dockerContainerCount + prs.length + localBranchCount + remoteBranchCount` | Polled | 30s resource discovery TTL |
| Expand/collapse state | localStorage key: `pan-tree-resources-${issueId}` | No | User interaction |
| Collapse by default | If issue has no active sessions (all ended) | No | Derived |

### Container node (new)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Container name (short) | `ResourceDetailIdentifiers.dockerContainerNames[]`, trimmed to service name | Polled | 30s resource discovery |
| Health status dot | `DockerStatsCollector.getStats()` → `ContainerStats.status` | **Yes** | 5s DockerStatsCollector poll |
| CPU percentage | `ContainerStats.cpuPercent` | **Yes** | 5s poll |
| Memory usage (human-readable) | `ContainerStats.memoryUsage` (bytes → MB/GB) | **Yes** | 5s poll |
| CPU sparkline (inline, ~60×12px) | `DockerStatsCollector.getHistory(containerId)` → `cpuPercent[]` | **Yes** | 5s poll, 60 samples |
| Container full name | `ContainerStats.name` | Polled | Tooltip on hover |
| Uptime | Derived from `docker ps` status string (e.g., "Up 2 hours") | Polled | 30s |

### Branch node (new)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Branch name | `ResourceDetailIdentifiers.localBranchNames[]` / `remoteBranchNames[]` | Polled | 30s resource discovery |
| Local/remote badge | Derived from which array it came from | Polled | 30s |
| Commits ahead/behind | Future enhancement — not in scope for v1 | — | — |

### PR node (new)

| Element | Source | Live? | Update path |
|---|---|---|---|
| PR number + title | `ResourceDetailIdentifiers.prs[]` | Polled | 30s resource discovery |
| State (open/closed/merged) | `ResourcePullRequest.state` | Polled | 30s |
| Draft badge | `ResourcePullRequest.isDraft` | Polled | 30s |
| URL (click to open) | `ResourcePullRequest.url` | No | Snapshot |

## Visual specification

### Tree structure with resources expanded

```
├── MIN-846  [$12.40]  In Review  [📁 🔀 📻 📋 🐛 🔀 🐳]     ← resource strip unchanged
│   ├── planning              ○ ended
│   ├── work                  ○ ended
│   ├── review                ◐ alive
│   │   └── reviewer/correctness ○ ended
│   │   └── ...
│   ├── ─── Resources ──────── (4 containers · 1 PR · 2 branches)
│   │   ├── 🐳 api            ● 12%  340M   ▁▃▅▇▅▃▁▂▄▆
│   │   ├── 🐳 frontend       ● 3%   128M   ▁▁▁▁▁▂▁▁▁▁
│   │   ├── 🐳 postgres       ● 1%   96M    ▁▁▁▁▁▁▁▁▁▁
│   │   ├── 🐳 redis          ● 0%   24M    ▁▁▁▁▁▁▁▁▁▁
│   │   ├── 🔀 #142 Add briefing redesign  (open)
│   │   ├──  feature/MIN-846  (local)
│   │   └──  origin/feature/MIN-846  (remote)
```

### Container node layout (single row)

```
┌──────────────────────────────────────────────────────────┐
│ 🐳  api  ● healthy  12%  340M  ▁▃▅▇▅▃▁▂▄▆              │
│                                                          │
│  icon  name  dot    cpu  mem   sparkline (60×12px)       │
└──────────────────────────────────────────────────────────┘
```

- **Icon**: `Container` from `lucide-react`, 12px, color matches container status
- **Name**: Service name extracted from full container name. Rule: strip the compose project prefix and trailing instance number. E.g., `myn-feature-min-846-api-1` → `api`
- **Status dot**: Reuse `StatusDot` component. Mapping:
  - `running` → `active` (green pulse, 1.6s)
  - `unhealthy` → `waiting` (amber pulse)
  - `restarting` → `thinking` (blue pulse + glow)
  - `stopped` → `ended` (gray, static)
- **CPU%**: `text-[10px] font-mono text-content-muted`, updates every 5s with a flash
- **Memory**: `text-[10px] font-mono text-content-muted`, formatted as MB or GB
- **Sparkline**: Inline SVG, 60×12px, last 60 samples (5 minutes at 5s intervals). Color: `var(--primary)` fill with 20% opacity, `var(--primary)` stroke. Uses `ContainerHistory.cpuPercent[]` from `DockerStatsCollector.getHistory(containerId)`.

### Container node context menu (right-click)

| Action | Endpoint | Condition |
|---|---|---|
| View Logs | Opens Zone C with streamed `docker logs -f --tail 200 <name>` | Always |
| Restart | `POST /api/resources/docker/container/:id/restart` (new) | `status === 'running'` |
| Stop | `DELETE /api/resources/docker/container/:id` (existing) | `status === 'running'` |
| Start | `POST /api/resources/docker/container/:id/start` (new) | `status === 'stopped'` |
| Inspect | Opens Zone C with `docker inspect` JSON viewer | Always |

### Branch node layout

```
┌──────────────────────────────────────────────────────────┐
│   feature/MIN-846  (local)                             │
└──────────────────────────────────────────────────────────┘
```

- **Icon**: `GitBranch` from `lucide-react`, 12px
- **Name**: Full branch name
- **Badge**: "(local)" or "(remote)" in `text-[9px] text-content-subtle`
- **No context menu in v1**

### PR node layout

```
┌──────────────────────────────────────────────────────────┐
│ 🔀 #142  Add briefing redesign  (open, checks passing)  │
└──────────────────────────────────────────────────────────┘
```

- **Icon**: `GitPullRequest` from `lucide-react`, 12px
- **Number**: `text-[11px] font-mono font-semibold`
- **Title**: `text-[11px]` truncated with ellipsis
- **State badge**: Same styling as PAN-830 status tags
- **Click**: Opens PR URL in browser (`window.open(pr.url)`)

### Resources group header

```
┌──────────────────────────────────────────────────────────┐
│ ▶ Resources  4 containers · 1 PR · 2 branches           │
│   or                                                     │
│ ▼ Resources  4 containers · 1 PR · 2 branches           │
└──────────────────────────────────────────────────────────┘
```

- **Chevron**: `ChevronRight` (collapsed) / `ChevronDown` (expanded), 12px
- **Label**: "Resources" in `text-[11px] font-medium text-content-muted uppercase tracking-wider`
- **Summary**: Item counts in `text-[10px] text-content-subtle`
- **Visual separator**: A subtle horizontal rule above the Resources group to visually separate sessions from resources. Use `border-top: 1px solid var(--divider)` with 4px margin.
- **Default state**: Collapsed when all sessions are ended; expanded when any session is active.

## Component architecture

### New components

| Component | File | Purpose |
|---|---|---|
| `ResourcesGroup` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ResourcesGroup.tsx` | Collapsible group header + child list. Renders below sessions in FeatureItem. |
| `ContainerNode` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ContainerNode.tsx` | Single container row with status dot, metrics, sparkline, context menu. |
| `BranchNode` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/BranchNode.tsx` | Single branch row with local/remote badge. |
| `PrNode` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/PrNode.tsx` | Single PR row with state badge, clickable. |
| `InlineSparkline` | `src/dashboard/frontend/src/components/CommandDeck/InlineSparkline.tsx` | Tiny inline SVG sparkline. Reusable (also useful for Zone A activity sparkline). |

### Modified components

| Component | File | Change |
|---|---|---|
| `FeatureItem` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx` | Render `<ResourcesGroup>` after sessions when expanded. Pass `resourceDetails`, `resourceIdentifiers`, and container stats. |
| `ProjectNode` | `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx` | Thread container stats data through to FeatureItem. |
| `CommandDeck/index.tsx` | `src/dashboard/frontend/src/components/CommandDeck/index.tsx` | Fetch container stats and history, provide to project tree. |

### Existing components reused

| Component | From | Used for |
|---|---|---|
| `StatusDot` | `src/dashboard/frontend/src/components/CommandDeck/StatusDot.tsx` | Container health indicator with alive/idle/ended animations |
| `useLiveFlash` | `src/dashboard/frontend/src/lib/useLiveFlash.ts` | Flash CPU/memory values on change |

## Data flow

### Container stats path (new)

```
DockerStatsCollector (5s poll)
  → GET /api/resources (existing endpoint)
    → CommandDeck/index.tsx fetches every 5s
      → Zustand store: containerStatsByName: Record<string, ContainerStats>
        → ProjectNode → FeatureItem → ResourcesGroup → ContainerNode
```

### Container history path (new, lazy)

```
DockerStatsCollector.getHistory(containerId) (60 samples)
  → GET /api/resources/:containerId/history (existing endpoint)
    → ContainerNode fetches on mount (when resources group is expanded)
      → Local state: cpuHistory: number[]
        → InlineSparkline renders
```

### Resource detail identifiers path (existing)

```
resource-discovery.ts (30s cache)
  → GET /api/issues/:issueId/resource-details (existing endpoint)
    → FeatureItem already fetches this on popover open
      → CHANGE: also fetch when resources group expands
        → ResourcesGroup renders individual nodes
```

## Server-side changes

### New API endpoints

#### `POST /api/resources/docker/container/:id/restart`

Restarts a container by ID or name.

```typescript
// In src/dashboard/server/routes/resources.ts
HttpRouter.post('/api/resources/docker/container/:id/restart', (req) =>
  Effect.gen(function* () {
    const { id } = req.params;
    const { stdout } = yield* execAsync(`docker restart ${shellEscape(id)}`);
    return { ok: true, container: id };
  }),
);
```

#### `POST /api/resources/docker/container/:id/start`

Starts a stopped container.

```typescript
HttpRouter.post('/api/resources/docker/container/:id/start', (req) =>
  Effect.gen(function* () {
    const { id } = req.params;
    const { stdout } = yield* execAsync(`docker start ${shellEscape(id)}`);
    return { ok: true, container: id };
  }),
);
```

#### `GET /api/resources/docker/container/:id/logs`

Streams container logs. Returns last 200 lines + follows.

```typescript
HttpRouter.get('/api/resources/docker/container/:id/logs', (req) =>
  Effect.gen(function* () {
    const { id } = req.params;
    const { stdout } = yield* execAsync(
      `docker logs --tail 200 --timestamps ${shellEscape(id)}`,
      { timeout: 10000 },
    );
    return { logs: stdout };
  }),
);
```

### Container name parsing utility (new)

Extract the service name from a full Docker Compose container name:

```typescript
// In src/dashboard/server/services/resource-discovery.ts (or a shared util)
export function parseContainerServiceName(fullName: string): string {
  // Docker Compose v2 names: {project}-{service}-{instance}
  // Examples:
  //   myn-feature-min-846-api-1      → api
  //   myn-feature-min-846-postgres-1  → postgres
  //   panopticon-traefik              → traefik (no instance suffix)
  //
  // Strategy: strip the last segment if it's a number (instance),
  // then strip everything up to and including the issue ID.
  const parts = fullName.split('-');
  // Remove trailing instance number
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]!)) {
    parts.pop();
  }
  // Find the issue ID position (e.g., "min-846" occupies two segments)
  // and take everything after it
  const issueId = parseIssueIdFromText(fullName);
  if (issueId) {
    const issueIdLower = issueId.toLowerCase().replace('-', '-');
    const idx = fullName.toLowerCase().indexOf(issueIdLower);
    if (idx >= 0) {
      const afterIssue = fullName.slice(idx + issueIdLower.length).replace(/^-/, '');
      const afterParts = afterIssue.split('-');
      if (afterParts.length > 1 && /^\d+$/.test(afterParts[afterParts.length - 1]!)) {
        afterParts.pop();
      }
      const serviceName = afterParts.join('-');
      if (serviceName) return serviceName;
    }
  }
  return fullName;
}
```

### Extend `ResourceDetailIdentifiers` response

The existing `GET /api/issues/:issueId/resource-details` endpoint returns `dockerContainerNames: string[]`. Extend it to also return per-container status:

```typescript
// New field on the response
export interface ResourceDetailIdentifiers {
  // ... existing fields ...
  dockerContainerNames: string[];
  dockerContainerStats: Array<{
    name: string;
    serviceName: string;     // parsed short name
    status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
    cpuPercent: number;
    memoryUsage: number;     // bytes
    memoryPercent: number;
  }>;
}
```

Populate from `DockerStatsCollector.getStats()` by cross-referencing container names.

## Frontend implementation

### 1. `InlineSparkline.tsx`

A reusable inline SVG sparkline:

```typescript
interface InlineSparklineProps {
  data: number[];              // array of values (0-100 for percentages)
  width?: number;              // default: 60
  height?: number;             // default: 12
  color?: string;              // default: 'var(--primary)'
  fillOpacity?: number;        // default: 0.2
  className?: string;
}
```

Implementation: SVG `<polyline>` for the stroke, `<polygon>` (closed to bottom) for the fill. Points are evenly spaced along the width. Values are scaled to the height. No axes, no labels — this is a micro-visualization.

### 2. `ContainerNode.tsx`

```typescript
interface ContainerNodeProps {
  name: string;                // full container name
  serviceName: string;         // parsed short name (e.g., "api")
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
  cpuPercent: number;
  memoryUsage: number;         // bytes
  cpuHistory?: number[];       // for sparkline (lazy-loaded)
  onViewLogs?: (name: string) => void;
  onRestart?: (name: string) => void;
  onStop?: (name: string) => void;
  onStart?: (name: string) => void;
  onInspect?: (name: string) => void;
}
```

Renders a single row matching the visual spec above. Uses `StatusDot` for the health indicator. Right-click opens a context menu using the same pattern as `SessionNode`'s context menu (absolute-positioned div with click handlers).

### 3. `ResourcesGroup.tsx`

```typescript
interface ResourcesGroupProps {
  issueId: string;
  containers: ContainerNodeProps[];
  branches: Array<{ name: string; isLocal: boolean }>;
  prs: Array<{ number: number; title: string; state: string; isDraft: boolean; url?: string }>;
  onContainerAction?: (action: string, containerName: string) => void;
}
```

Manages expand/collapse state via `localStorage` key `pan-tree-resources-${issueId}`. Renders the group header with counts, then child nodes when expanded. Sort order within the group: containers first (sorted alphabetically by service name), then PRs (by number), then branches (local before remote, alphabetically).

### 4. `FeatureItem.tsx` modifications

After the session nodes (inside the expanded content), render:

```tsx
{isExpanded && hasResources && (
  <ResourcesGroup
    issueId={feature.issueId}
    containers={containerNodes}
    branches={branchNodes}
    prs={prNodes}
    onContainerAction={handleContainerAction}
  />
)}
```

Where `hasResources` is `feature.resourceDetails.dockerContainerCount > 0 || feature.resourceDetails.prs.length > 0 || feature.resourceDetails.localBranchCount > 0 || feature.resourceDetails.remoteBranchCount > 0`.

### 5. Container stats polling in `CommandDeck/index.tsx`

Add a 5-second polling interval for container stats when the Command Deck is open and at least one issue has containers:

```typescript
const [containerStats, setContainerStats] = useState<Record<string, ContainerStats>>({});

useEffect(() => {
  if (!hasAnyContainers) return;
  const fetchStats = async () => {
    const res = await fetch('/api/resources');
    if (!res.ok) return;
    const data = await res.json();
    const byName: Record<string, ContainerStats> = {};
    for (const c of data.containers) {
      byName[c.name] = c;
    }
    setContainerStats(byName);
  };
  fetchStats();
  const interval = setInterval(fetchStats, 5000);
  return () => clearInterval(interval);
}, [hasAnyContainers]);
```

## CSS additions

Add to `src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css`:

```css
.resourcesGroup {
  margin-top: 2px;
  border-top: 1px solid var(--divider);
  padding-top: 4px;
}

.resourcesGroupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 28px;  /* 28px left = same indent as session nodes */
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}

.resourcesGroupHeader:hover {
  background: var(--accent);
}

.resourcesGroupSummary {
  font-size: 10px;
  font-weight: 400;
  color: var(--content-subtle);
  text-transform: none;
  letter-spacing: normal;
}

.containerNode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 40px;  /* 40px = indent under resources group */
  font-size: 11px;
  cursor: default;
}

.containerNode:hover {
  background: var(--accent);
}

.containerName {
  font-weight: 500;
  color: var(--content);
  min-width: 64px;
}

.containerMetric {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted-foreground);
  min-width: 36px;
  text-align: right;
}

.branchNode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 40px;
  font-size: 11px;
  color: var(--content-muted);
}

.branchBadge {
  font-size: 9px;
  color: var(--content-subtle);
}

.prNode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 40px;
  font-size: 11px;
  cursor: pointer;
}

.prNode:hover {
  background: var(--accent);
  text-decoration: underline;
}

.prNumber {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--content);
}

.prTitle {
  font-size: 11px;
  color: var(--content-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
```

## Acceptance criteria

1. **Resources group renders under sessions.** When an issue is expanded in the Command Deck project tree, a "Resources" group appears below the session list if the issue has any containers, branches, or PRs. The group has a chevron toggle and item counts.

2. **Container nodes show live data.** Each container node displays the service name, a health status dot (reusing `StatusDot`), CPU percentage, memory usage (human-readable MB/GB), and a CPU sparkline (60×12px, last 5 minutes). Data updates every 5 seconds.

3. **Container context menu works.** Right-clicking a container node opens a menu with: View Logs, Restart, Stop (if running), Start (if stopped), Inspect. Each action calls the corresponding API endpoint.

4. **Branch and PR nodes render correctly.** Branch nodes show the branch name and local/remote badge. PR nodes show number, title (truncated), and state. Clicking a PR opens the URL in a new tab.

5. **Expand/collapse state persists.** The Resources group expand/collapse state is stored in `localStorage` per issue and survives page reloads. Default: expanded when any session is active, collapsed when all sessions are ended.

6. **Resource strip unchanged.** The existing resource icon strip on the issue row (PAN-862) continues to render exactly as before. The new tree is additive.

7. **Performance.** A tree with 10 issues, each having 4 containers, renders without perceptible lag. Container stats polling is gated — only fetches when the Command Deck is open and at least one resources group is expanded.

8. **No containers = no group.** Issues with zero resources (no containers, no branches, no PRs) do not render the Resources group at all.

9. **Container name parsing.** Full Docker Compose names (e.g., `myn-feature-min-846-api-1`) are parsed to short service names (`api`). Full name shown in tooltip on hover.

10. **CSS matches session tree styling.** Resource nodes use the same indentation, font sizes, hover states, and color tokens as session nodes. The visual language is cohesive.

## Implementation phases

### Phase 1: Core resource tree

1. Create `InlineSparkline.tsx` component
2. Create `ContainerNode.tsx` with status dot, metrics, sparkline
3. Create `BranchNode.tsx` and `PrNode.tsx`
4. Create `ResourcesGroup.tsx` with expand/collapse and localStorage persistence
5. Modify `FeatureItem.tsx` to render `ResourcesGroup` after sessions
6. Add container stats polling in `CommandDeck/index.tsx`
7. Add CSS to `command-deck.module.css`

### Phase 2: Container actions

1. Add `POST /api/resources/docker/container/:id/restart` endpoint
2. Add `POST /api/resources/docker/container/:id/start` endpoint
3. Add `GET /api/resources/docker/container/:id/logs` endpoint
4. Add container context menu to `ContainerNode.tsx`
5. Wire "View Logs" to Zone C (or a modal)
6. Wire Restart/Stop/Start to the new endpoints

### Phase 3: Data enrichment

1. Add `dockerContainerStats` to `ResourceDetailIdentifiers` response
2. Add `parseContainerServiceName()` utility
3. Lazy-load container history (sparkline data) only when Resources group is expanded
4. Add container stats to the Zustand store for cross-component access

## Testing

- **Typecheck**: `npm run typecheck` must pass
- **Lint**: `npm run lint` must pass
- **Unit tests**: Add tests for `parseContainerServiceName()` covering:
  - `myn-feature-min-846-api-1` → `api`
  - `myn-feature-min-846-postgres-1` → `postgres`
  - `panopticon-traefik` → `traefik`
  - `devcontainer-frontend-1` → `frontend` (no issue ID match, fallback)
- **Visual verification**: Use Playwright MCP to verify the tree renders correctly with containers expanded, status dots animate, and sparklines display data.
