# PAN-969: Directive Flow — DAG-Centric Issue Overview

## Vision

Replace the card-grid Overview tab with a live, interactive DAG visualization where the vBRIEF plan items are nodes that glow as agents work them, and the specialist pipeline (VERIFY → REVIEW → TEST → MERGE) extends the graph as tail nodes. The entire issue lifecycle — from first bead to merged PR — is one unified directed acyclic graph. We call this section **"The Directive"**.

## Motivation

The current Overview tab shows disconnected cards (Agent, Cost, By Stage, Services, Attach, Actions, Workspace, Links) plus a Reviewer Summary table. These are all facets of the same story — an issue flowing through planning, implementation, quality gates, and merge — but they're laid out as a flat grid with no sense of flow or progress.

Meanwhile, the vBRIEF DAG viewer exists as a separate tab with static nodes. It doesn't show agent assignments, live progress, costs, inspection results, or the specialist pipeline. The dot stepper at the top (PLAN · WORK · VERIFY · REVIEW · TEST · MERGE) hints at the flow but provides no detail.

The Directive Flow unifies all of this: the DAG IS the overview, enriched with live data, and the specialist pipeline is the graph's tail.

## Architecture (3 sentences)

The Overview tab becomes a full-viewport ReactFlow canvas showing vBRIEF plan items as enriched nodes (agent assignment, bead progress, AC checklist, inspection status, cost) connected by dependency edges, with quality gate nodes (VERIFY, REVIEW, TEST, MERGE, DONE) appended after the terminal work items. A collapsible resource dock on the right shows containers, agents, workspace, and services. A summary strip at the bottom shows critical path length, overall progress, and total cost.

## Design

### The Unified DAG

Work items from the vBRIEF form the left/center of the graph. After the terminal items (those with no outgoing `blocks` edges), the graph extends with quality gate nodes:

```
[work items DAG] ──→ VERIFY ──→ REVIEW ──→ TEST ──→ MERGE ──→ DONE
```

Feedback loops (REVIEW sends CHANGES_REQUESTED, TEST fails) show as dashed backward edges to the relevant work items, which re-activate in `review-response` phase.

### Work Item Nodes (enriched)

Each vBRIEF item node shows:
- Status dot + title
- Bead progress bar (from beads status)
- Agent assignment (model, runtime state) when running
- Duration + cost attribution for this item
- Acceptance criteria inline (compact: "3/4 AC", expandable to full checklist)
- Last inspection result (passed/blocked)
- Difficulty + priority badges

Status rendering:
- `pending` → gray border, dimmed, shows blocking dependencies
- `approved`/ready → blue border, pulse animation ("unblocked")
- `running` → green border, glow animation, agent info visible
- `completed` → green fill, checkmark, collapsed to compact one-liner
- `blocked` → red border, shows blocker
- `cancelled` → strikethrough, gray, collapsed

### Quality Gate Nodes (new node type)

Rendered differently from work items — wider, with substep indicators:

- **VERIFY**: Shows typecheck/lint/test substeps, attempt count, elapsed time
- **REVIEW**: Shows 5 reviewer columns (correctness/security/perf/requirements/synthesis) with per-reviewer status, round number, auto-requeue count
- **TEST**: Shows test-agent status, skip reason if applicable
- **MERGE**: Shows merge step progress (queued → validating-pr → rebasing → stripping-planning → verifying → squash-merging → post-merge-cleanup), queue position, CI checks, blocker reasons. Human gate prominently displayed.
- **DONE**: Shows merged commit, total cost, duration

### Parallelization Visibility

The DAG layout (Dagre TB) naturally places independent chains side-by-side at the same rank. When multiple work items share no dependency path, they sit in parallel lanes — making parallelization opportunities visually obvious. With future swarm support, each lane could have its own agent shown inline.

### Resource Dock (right sidebar, collapsible)

Replaces the Services/Attach/Workspace/Links cards:
- **Containers**: Live status, CPU/memory sparklines (from docker-stats polling)
- **Agents**: Tree view matching issue tree (work-agent, review-agent with nested sub-reviewers)
- **Workspace**: Path, branch, VS Code button, Stop button
- **Services**: Frontend/API links
- **Attach**: tmux command with copy button
- **Cost**: Total + breakdown by model and by stage

### Summary Strip (bottom bar)

Compressed status line:
- Overall progress: "✓ 6/8 items · ● REVIEW running"
- Critical path: "5 steps" (from criticalPath())
- Parallel lanes: count of independent chains
- Total cost with sparkline trend

### Inline Diff Toggle

When an issue is selected, a +/- toggle in the summary strip or resource dock opens the @pierre/diffs panel showing the worktree diff (vs main). Uses the existing `GET /api/agents/:agentId/diffs/vs-main` endpoint and the DiffPanel component with the pierre worker pool.

### Rework Cycles

When a specialist sends feedback (CHANGES_REQUESTED, test failure), the graph shows:
- A dashed red backward edge from the gate node to the relevant work item(s)
- The work item re-activates with phase `review-response`
- The gate node shows round number and circuit breaker count (e.g., "Round 2 · 1/3 requeues")

### Escape State Overlays

- **BLOCKED** (stuck=true): Yellow banner overlaid on the current stage node with stuckReason
- **CANCELLED**: All nodes grayed, graph dimmed
- **Circuit breaker tripped** (autoRequeueCount >= 3): Red banner on REVIEW node: "Human intervention needed"

## Data Sources

| Data | Source | Endpoint/Field |
|------|--------|---------------|
| vBRIEF items + edges | `.pan/spec.vbrief.json` (workspace) or `.pan/specs/` (main) | `GET /api/workspaces/:issueId/plan` |
| Critical path | Server-computed from DAG | Returned with plan response |
| Item statuses | vBRIEF `item.status` field | Plan response |
| AC statuses | vBRIEF `subItem.status` field | Plan response |
| Agent assignment | Read model `agentsById` | WebSocket snapshot |
| Agent runtime | Read model `agentRuntimeById` | WebSocket events |
| Review pipeline | Read model `reviewStatusByIssueId` | WebSocket events |
| Reviewer sub-statuses | `reviewSubStatuses` record | WebSocket events |
| Merge step | `reviewStatus.mergeStep` | WebSocket events |
| Containers | `resources.containers` | `GET /api/resources` |
| Beads progress | Beads CLI | `GET /api/workspaces/:issueId/beads` (or new) |
| Cost per item | Cost reconciler | Existing cost attribution |
| Worktree diff | Git checkpoint system | `GET /api/agents/:agentId/diffs/vs-main` |

## Depends On

- PAN-967 (unified `.pan/` directory — merged)
- PAN-965 (hierarchical resource tree — provides container tree data)

## Relates To

- Existing PlanDAG component (`src/dashboard/frontend/src/components/PlanDAG.tsx`) — will be significantly extended or replaced
- Existing VBriefViewer (`src/dashboard/frontend/src/components/vbrief/`) — the List/Raw tabs may be retained as secondary views
- Existing ReviewPipelineSection (`src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx`) — absorbed into gate nodes
- Existing OverviewTab (`src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx`) — replaced entirely

## Non-Goals

- Implementing swarm/parallel agent execution (that's a separate feature — this visualizes the opportunity)
- Changing the vBRIEF spec or DAG algorithm
- Changing the specialist pipeline flow
- Mobile responsiveness (desktop dashboard only)
