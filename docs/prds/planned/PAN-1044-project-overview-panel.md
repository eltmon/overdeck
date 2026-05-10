# Command Deck — Project Overview Panel (PAN-1044)

> This is the workspace copy of the PRD with corrections applied from codebase research.
> Source PRD: `docs/prds/planned/project-overview-panel.md`
>
> **Corrections from codebase research:**
> - `SessionNode.type` (not `role`) is used to classify session types (`"work"`, `"planning"`, etc.). `role` is optional and only used for reviewer specialist roles. Bucketing must use `s.type === 'work'`.
> - `issueCosts` in CommandDeck is `Record<string, number>` (not `Map<string, number>`).
> - `projectsWithSessions` in CommandDeck is `ProjectData[]` (array), not `Map<string, ProjectFeature[]>`. ProjectOverview receives features as `ProjectFeature[]`.
> - `feature.issueId` from resource-allocated endpoint is uppercase (e.g., `PAN-1044`). `reviewStatusByIssueId` keys are also uppercase. Direct lookup is safe.
> - Store access for multiple issues: `useDashboardStore(s => s.reviewStatusByIssueId)` once, then index per feature (cannot call hooks in a loop).

## Problem

When a user clicks a project name in the Command Deck sidebar, the only behavior is toggling the expand/collapse of the project's issue list. There is no way to see a holistic view of a project — how many issues are active, where they sit in the pipeline, which are stuck, and what the aggregate cost is.

## Goal

Add a **Project Overview** panel that appears in the Command Deck's right content area when a user clicks a project name (not the chevron). The panel provides:

1. A **hero billboard** with project name, issue count, total cost, and active agent count
2. A **pipeline swimlane board** showing every issue bucketed by its current pipeline stage
3. A **stuck/blocked callout section** that surfaces issues needing attention at the very top

## Interaction Model

### Click Behavior Split on ProjectNode

| Click Target | Action |
|---|---|
| **Chevron icon** (ChevronRight/ChevronDown) | Toggle expand/collapse only. Does NOT select the project. |
| **Project name text + rest of row** | Select the project. Shows the Project Overview panel. If collapsed, also expands. |

The `MessageSquarePlus` button already uses `e.stopPropagation()` — must be preserved.

### Selection State

Add `selectedProject: string | null` to CommandDeck's state. Mutually exclusive with `selectedFeature` and `selectedConversation`:
- Selecting a project clears `selectedFeature` and `selectedConversation`
- Selecting a feature clears `selectedProject`
- Selecting a conversation clears `selectedProject`

### Right Panel Routing (four-way)

Priority: conversation > feature > project > empty

```
selectedConversation → ConversationView
selectedFeature → IssueWorkbench
selectedProject → ProjectOverview  ← NEW
(empty) → EmptyState
```

---

## Data Sources

All data is already available client-side. No new API endpoints.

| Data | Source | Type |
|---|---|---|
| Project features | `projectsWithSessions.find(p => p.name === selectedProject)?.features ?? []` | `ProjectFeature[]` |
| Issue costs | `issueCosts` (from `CommandDeck`) | `Record<string, number>` |
| Review pipeline state | `useDashboardStore(s => s.reviewStatusByIssueId)` | `Record<string, ReviewStatusSnapshot>` |
| Agent sessions | `feature.sessions` | `readonly SessionNode[]` |

---

## Pipeline Stage Bucketing

Each issue is placed in exactly one bucket. Evaluate in this order:

```typescript
export type PipelineStage =
  | 'stuck'
  | 'merging'
  | 'awaitingMerge'
  | 'tests'
  | 'review'
  | 'buildGate'
  | 'working'
  | 'planning'
  | 'idle';

export function bucketFeature(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): PipelineStage {
  // 1. Stuck/blocked
  if (reviewStatus?.stuck) return 'stuck';
  if (
    reviewStatus?.reviewStatus === 'failed' ||
    reviewStatus?.testStatus === 'failed' ||
    reviewStatus?.mergeStatus === 'failed' ||
    reviewStatus?.verificationStatus === 'failed'
  ) return 'stuck';
  if (reviewStatus?.blockerReasons && reviewStatus.blockerReasons.length > 0) return 'stuck';

  // 2. Most-advanced pipeline stage first
  if (reviewStatus?.mergeStatus && ['queued', 'merging', 'verifying'].includes(reviewStatus.mergeStatus)) return 'merging';
  if (reviewStatus?.readyForMerge && (!reviewStatus.blockerReasons || reviewStatus.blockerReasons.length === 0)) return 'awaitingMerge';
  if (reviewStatus?.testStatus === 'testing') return 'tests';
  if (reviewStatus?.reviewStatus === 'reviewing') return 'review';
  if (reviewStatus?.verificationStatus === 'running') return 'buildGate';

  // 3. Pre-pipeline stages (NOTE: use s.type === 'work', NOT s.role)
  if (feature.agentStatus !== null && !reviewStatus) return 'working';
  if (feature.hasPlanning && !feature.sessions?.some(s => s.type === 'work')) return 'planning';

  return 'idle';
}
```

**Color tokens per stage:**

| Stage | Token |
|---|---|
| stuck | `var(--destructive)` |
| merging | `var(--info)` |
| awaitingMerge | `var(--success)` |
| tests | `var(--signal-review)` |
| review | `var(--signal-review)` |
| buildGate | `var(--warning)` |
| working | `var(--primary)` |
| planning | `var(--muted-foreground)` |
| idle | `var(--muted-foreground)` |

---

## Component Design

### `ProjectOverview.tsx` Props (corrected types)

```typescript
interface ProjectOverviewProps {
  projectName: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;  // NOT Map — matches CommandDeck actual type
  onSelectFeature: (feature: ProjectFeature) => void;
}
```

### Hero Billboard

- Background: `linear-gradient(135deg, color-mix(in srgb, var(--primary) 8%, transparent), transparent)`
- Project name (18px, weight 700)
- Stats: issue count, total cost (LiveCounter), active agent count

### Stuck/Blocked Callout

- Only render when stuck issues exist
- `AlertTriangle` icon, `var(--destructive)` accent
- Per card: Issue ID (clickable), title (truncated), stuck reason

### Pipeline Swimlanes

- One section per non-empty stage
- Header: stage name + count badge
- Body: horizontal flex-wrap of issue cards
- Cards: Issue ID (clickable), title, cost badge, sub-status pill

---

## Files

### New: `src/dashboard/frontend/src/components/CommandDeck/ProjectOverview.tsx`

All sub-components inline. Export `bucketFeature` and `PipelineStage` for testability.

### New: `src/dashboard/frontend/src/components/CommandDeck/__tests__/ProjectOverview.test.tsx`

Unit tests for `bucketFeature` covering all 9 stage transitions.

### Modify: `ProjectTree/ProjectNode.tsx`

- Add `onSelectProject?: (projectName: string) => void`
- Add `selectedProject?: string | null`
- Split click: chevron span → toggle only; row → select + expand if needed
- Selected visual: `background: var(--accent)` when selected

### Modify: `CommandDeck/index.tsx`

- Add `const [selectedProject, setSelectedProject] = useState<string | null>(null)`
- Add `handleSelectProject` callback (clears feature + conversation)
- Update `handleSelectFeature` to clear `selectedProject`
- Update `handleSelectConversation` to clear `selectedProject`
- Pass `onSelectProject={handleSelectProject}` and `selectedProject={selectedProject}` to `ProjectNode`
- Add four-way routing in content area

---

## Quality Gates

- `npm run typecheck` passes
- `npm run lint` passes
- `npm test` passes
- Clicking chevron toggles expand only (does not select project)
- Clicking project name selects project and shows overview
- Clicking an issue card in the overview navigates to that issue's workbench
- Stuck/blocked section only appears when issues are stuck
- Empty pipeline stages are hidden
- All colors use CSS variables
