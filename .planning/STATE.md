# PAN-388: vBRIEF Integration — Structured Plans, Programmatic Beads, DAG Visualization

## Status: Planning Complete

## Decisions

### Scope
All remaining phases (2 tail + 3 + 4) delivered as a single issue:
- **Phase 2 tail**: Wire `createBeadsFromVBrief()` into post-planning flow, remove LLM-generated `bd create`
- **Phase 3**: Plan viewer + DAG visualization in dashboard
- **Phase 4**: Cloister DAG-aware scheduling with hard gates + auto-wake

### Architecture Decisions

**AD-1: ReactFlow for DAG visualization**
- Use `reactflow` (not @xyflow/react v12 rebrand) — same library as vBRIEF Studio
- ~150KB gzipped, handles layout, zoom, pan, click events out of the box

**AD-2: Augment BeadsTasks panel with graph/list toggle**
- No new tab or inspector section — add a toggle to the existing BeadsTasks panel
- List view = current beads list; Graph view = ReactFlow DAG with status colors
- Keeps workspace detail view cohesive

**AD-3: Post-planning conversion in Cloister (not in agent prompt)**
- After planning agent writes `plan.vbrief.json` and signals completion, Cloister calls `createBeadsFromVBrief()` before waking work agent
- Clean separation: agent produces structured plan, system handles mechanical conversion
- Planning agent prompts updated to remove `bd create` instructions

**AD-4: Hard gate + auto-detect ready for Cloister scheduling**
- `blocks` edges are hard gates — Cloister will NOT schedule a task whose blocking dependencies aren't complete
- When a bead completes, Cloister checks if any downstream tasks are now unblocked and auto-wakes the appropriate specialist
- `informs` edges are soft preferences — provide context ordering but don't block

**AD-5: Bidirectional status sync included**
- When agents close beads, update corresponding vBRIEF item status in `plan.vbrief.json`
- DAG visualization reads from vBRIEF for status colors (single source of truth)
- Sync triggered via bead completion hook or polling

**AD-6: Critical path detection included**
- Compute longest dependency chain in the DAG
- Highlight critical path edges/nodes in the DAG visualization
- Show in dashboard for bottleneck visibility

## Task Breakdown

### Phase 2 Tail: Wire Converter

| ID | Task | Difficulty | Deps |
|----|------|-----------|------|
| wire-converter | Wire `createBeadsFromVBrief()` into Cloister post-planning step | medium | — |
| remove-bd-prompts | Remove `bd create` instructions from planning agent prompts | simple | wire-converter |

### Phase 3: Plan Viewer + DAG Visualization

| ID | Task | Difficulty | Deps |
|----|------|-----------|------|
| vbrief-api | API endpoint to serve vBRIEF plan data for a workspace | simple | — |
| reactflow-setup | Add ReactFlow dependency + base DAG component | simple | — |
| dag-graph | Build DAG graph with status colors, edge type styling, layout | complex | reactflow-setup, vbrief-api |
| beads-toggle | Augment BeadsTasks panel with graph/list toggle | medium | dag-graph |
| node-detail | Click-through from graph node to item/bead detail | medium | dag-graph |
| status-sync | Bidirectional bead-to-vBRIEF status sync | medium | vbrief-api |
| live-updates | Live DAG updates via socket.io as beads complete | medium | dag-graph, status-sync |

### Phase 4: Cloister DAG Scheduling

| ID | Task | Difficulty | Deps |
|----|------|-----------|------|
| task-readiness | Dependency-aware task readiness check in Cloister | complex | wire-converter |
| auto-wake | Auto-detect unblocked tasks + wake specialists | complex | task-readiness |
| critical-path | Critical path algorithm + dashboard highlight | medium | task-readiness, dag-graph |

## Dependency Graph (text)

```
wire-converter ──blocks──> remove-bd-prompts
wire-converter ──blocks──> task-readiness
reactflow-setup ──blocks──> dag-graph
vbrief-api ──blocks──> dag-graph
vbrief-api ──blocks──> status-sync
dag-graph ──blocks──> beads-toggle
dag-graph ──blocks──> node-detail
dag-graph ──blocks──> live-updates
dag-graph ──blocks──> critical-path
status-sync ──blocks──> live-updates
task-readiness ──blocks──> auto-wake
task-readiness ──blocks──> critical-path
```

## Key Files to Modify

### Phase 2
- `src/lib/cloister/specialists.ts` — Add post-planning vBRIEF→beads conversion step
- `src/lib/planning/planning-agent.ts` — Remove `bd create` from agent prompt
- `src/lib/planning/decomposition-agent.ts` — May be bypassed entirely by converter

### Phase 3
- `src/dashboard/server/index.ts` — New GET `/api/workspaces/:issueId/plan` endpoint
- `src/dashboard/frontend/src/components/BeadsTasksPanel.tsx` — Add graph/list toggle
- `src/dashboard/frontend/src/components/PlanDAG.tsx` — New ReactFlow DAG component
- `src/dashboard/frontend/src/components/PlanItemDetail.tsx` — New node detail panel
- `src/lib/vbrief/io.ts` — May need `updateItemStatus()` utility
- `package.json` (frontend) — Add `reactflow` dependency

### Phase 4
- `src/lib/cloister/specialists.ts` — Dependency check before scheduling
- `src/lib/cloister/task-readiness.ts` — New module for DAG-aware readiness
- `src/lib/cloister/service.ts` — Hook into bead completion for auto-wake
- `src/lib/vbrief/dag.ts` — Critical path algorithm (or add to existing DAG utils)

## Risks

1. **ReactFlow bundle size**: ~150KB gzipped addition to frontend. Acceptable for the functionality gained; can lazy-load the component.
2. **Status sync race conditions**: Multiple agents closing beads simultaneously could cause write conflicts on `plan.vbrief.json`. Mitigation: use atomic read-modify-write with file locking or debounced sync.
3. **Cloister complexity**: Adding DAG scheduling to the already-complex specialist system. Mitigation: isolate in dedicated `task-readiness.ts` module, keep specialist scheduling code unchanged except for the readiness gate.
4. **Plan file absence**: Not all workspaces will have `plan.vbrief.json` (legacy or non-vBRIEF flows). All code must gracefully degrade when no plan exists.

## Out of Scope
- TRON encoding (PAN-399)
- Hierarchical planning / Rally features (PAN-397)
- Headroom integration (PAN-398)
- Migration of existing workspaces to vBRIEF format

## Specialist Feedback

- **[2026-03-31T19:35Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-03-31T20:51Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-03-31T20:54Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
