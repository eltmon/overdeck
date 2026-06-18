# PAN-388: vBRIEF Integration — Structured Plans, Programmatic Beads, DAG Visualization

## Problem

Overdeck's planning pipeline has three structural weaknesses:

1. **Plans are freeform Markdown** — PRD.md and STATE.md are human-readable but not machine-parseable. Cloister can't extract task ordering, dependencies, or completion state from them.

2. **Beads creation wastes LLM tokens** — The planning agent generates `bd create` shell commands one at a time. This is a creative act by the LLM when it should be mechanical — the plan already contains all the information needed.

3. **No dependency graph** — Beads tasks are a flat list. There's no way for Cloister to know "task B can't start until task A completes" or to detect what's ready to work on next. Agents pick up tasks without understanding ordering.

## Solution

Adopt the [vBRIEF v0.5 spec](https://github.com/deftai/vBRIEF) as the structured plan format. The planning agent outputs a single vBRIEF JSON file with:
- **Items** — tasks with id, title, priority, difficulty, descriptions
- **Edges** — typed dependency graph (`blocks`, `informs`, `invalidates`, `suggests`)
- **Narratives** — Problem, Proposal, Constraint, Risk, Alternative

Everything downstream is derived from this file: beads creation, scheduling, visualization.

## Architecture

### Pipeline Flow

```
Issue created
    ↓
Planning agent (Opus) explores codebase, interviews user
    ↓
Outputs:
  ├── .planning/STATE.md          (human-readable, existing)
  ├── docs/prds/active/*-plan.md  (dashboard copy, existing)
  └── .planning/plan.vbrief.json  (NEW: structured plan)
    ↓
vbrief-to-beads converter (TypeScript, zero LLM tokens)
  ├── Reads plan.vbrief.json
  ├── Creates beads via `bd create` for each item
  ├── Maps edges to `--deps "blocks:<id>"`
  └── Maps metadata.difficulty to difficulty labels
    ↓
Cloister reads plan.vbrief.json edges
  ├── Determines task readiness (all blocking predecessors completed?)
  ├── Schedules agents to work on ready tasks
  └── Detects blocked/stalled work
    ↓
Dashboard renders DAG
  ├── ReactFlow graph component
  ├── Status colors per node
  ├── Edge types visually distinct
  └── Live updates as beads close
```

### vBRIEF Document Structure

```json
{
  "vBRIEFInfo": { "version": "0.5", "created": "2026-03-30T00:00:00Z" },
  "plan": {
    "id": "PAN-XXX",
    "title": "Feature title",
    "status": "approved",
    "author": "opus-plan",
    "tags": ["area-tag"],
    "narratives": {
      "Problem": "What problem this solves",
      "Proposal": "The approach chosen",
      "Constraint": "Limitations and boundaries",
      "Risk": "Potential issues and mitigations",
      "Alternative": "Other options considered and why rejected"
    },
    "items": [
      {
        "id": "short-kebab-id",
        "title": "Task title",
        "status": "pending",
        "priority": "high",
        "metadata": {
          "difficulty": "medium",
          "issueLabel": "pan-xxx"
        },
        "narrative": { "Action": "What needs to be done" },
        "subItems": []
      }
    ],
    "edges": [
      { "from": "task-a", "to": "task-b", "type": "blocks" },
      { "from": "task-a", "to": "task-c", "type": "informs" }
    ]
  }
}
```

### Beads Field Mapping

| vBRIEF Field | Beads Equivalent | Mapping |
|---|---|---|
| `items[].title` | bead title | `"{issueId}: {title}"` |
| `items[].priority` | `--priority` | high=1, medium=2, low=3 |
| `items[].metadata.difficulty` | `-l "difficulty:{level}"` | Direct label |
| `items[].metadata.issueLabel` | `-l "{label}"` | Issue label for filtering |
| `items[].narrative.Action` | `-d "description"` | Bead description |
| `edges[type=blocks]` | `--deps "blocks:{id}"` | Blocking dependency |
| `items[].subItems` | `--parent {id}` | Hierarchical beads |

### Edge Types

| Type | Semantics | Cloister Behavior |
|---|---|---|
| `blocks` | Hard dependency — target cannot start until source completes | Gate: don't schedule until predecessor done |
| `informs` | Soft dependency — target benefits from source context | Prefer order but don't gate |
| `invalidates` | Source completion makes target unnecessary | Auto-close target if source completes |
| `suggests` | Weak recommendation | Ignore for scheduling |

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plan format | vBRIEF v0.5 JSON | Open spec, DAG support, graduated complexity, JSON Schema validated |
| TRON encoding | Skip | Novel format, marginal token savings, JSON is universal |
| Workflow replacement | No — keep existing specialist pipeline | vBRIEF defines plan structure, not execution semantics |
| Beads replacement | No — beads stays as task tracker | vBRIEF is the plan, beads are the execution. Plan spawns beads. |
| PRD.md replacement | No — keep alongside vBRIEF | PRD is human-readable narrative, vBRIEF is machine-readable structure |
| Dashboard graph library | ReactFlow | Same as vBRIEF Studio, already React, interactive DAG rendering |
| Storage backend | Dolt (via beads v0.62+) | Required by beads, enables shared state across worktrees |
| Missing spec fields | Use `metadata` now, filed spec PR | `complexity`, `estimate`, `acceptance`, `defer` proposed as first-class fields (deftai/vBRIEF#1) |
| Licensing | Implement the format, don't copy code | vBRIEF spec currently has no license file |

## Implementation Phases

### Phase 1: Plan Generation (PAN-386) ✅
- [x] Upgrade beads to v0.62.0 (Dolt backend)
- [x] Install Dolt to `~/.local/bin` (no sudo, added to `pan install`)
- [x] Replace `existsSync(issues.jsonl)` checks with `bd list --json` queries
- [x] Replace JSONL file parsing with `bd list --json` CLI queries
- [x] Update `.beads/` copy logic (Dolt worktrees share automatically)
- [x] Add vBRIEF plan generation to planning agent prompt
- [x] Planning agent outputs `.planning/plan.vbrief.json`

### Phase 2: Programmatic Beads from vBRIEF
- [ ] Create `src/lib/planning/vbrief-to-beads.ts` converter
  - Read `.planning/plan.vbrief.json`
  - Flatten items (including subItems) into beads
  - Map priority, difficulty, labels, descriptions
  - Map `blocks` edges to `--deps` flags
  - Execute `bd create` commands
- [ ] Add `pan vbrief convert` CLI command
- [ ] Update planning prompt: agent generates vBRIEF only, converter creates beads
- [ ] Remove `bd create` instructions from planning prompt
- [ ] Validate: planning tokens reduced (no shell command generation)

### Phase 3: DAG Visualization
- [ ] Add ReactFlow dependency to dashboard frontend
- [ ] Create `VBriefDagView` component
  - Parse plan.vbrief.json → ReactFlow nodes + edges
  - Status-based node colors (pending=gray, running=yellow, completed=green, blocked=red)
  - Edge styles by type (solid=blocks, dashed=informs, thick=invalidates)
  - Zoom, pan, auto-layout
- [ ] Integrate into workspace detail view on dashboard
- [ ] Click node → show bead detail panel
- [ ] Live updates: poll beads status, update node colors

### Phase 4: Cloister DAG Scheduling
- [ ] Create `src/lib/cloister/dag-scheduler.ts`
  - Load plan.vbrief.json for active issue
  - Build adjacency list from edges
  - Determine ready tasks: all `blocks` predecessors in `completed` status
  - Expose `getReadyTasks(issueId)` for Cloister
- [ ] Integrate with existing specialist dispatch
  - When work agent finishes a bead → check if new tasks are unblocked
  - Auto-assign next ready task
- [ ] Critical path detection
  - Longest path through `blocks` edges
  - Surface on dashboard
- [ ] Blocked task detection
  - Flag tasks whose predecessors are stalled
  - Alert on dashboard

## Out of Scope

- Replacing the specialist pipeline (review → test → merge) with vBRIEF workflows
- TRON encoding support
- vBRIEF Studio integration (private codebase, can't embed)
- Dolt installation on remote workspaces (exe.dev) — follow-up issue
- Modifying the vBRIEF spec itself (filed upstream proposals instead)
- Multi-plan coordination (one plan per issue is sufficient)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| vBRIEF spec is beta (v0.5) | Low | We implement a simple subset (items, edges, narratives). Spec changes are additive. |
| Planning agent generates bad vBRIEF | Medium | JSON Schema validation before converter runs. Fallback: agent still creates beads directly. |
| Dolt server crashes | Low | Beads has health checks + auto-restart. Dashboard falls back to no-beads mode. |
| Dolt is a new dependency for all users | Medium | Auto-installed by `pan install` to `~/.local/bin`. Single binary, no sudo. |
| ReactFlow bundle size | Low | Lazy-load DAG view. Only loaded when user views a workspace with a plan. |

## Files Modified (Phase 1 — Complete)

- `src/cli/commands/work/issue.ts` — `hasBeadsTasks()` uses `bd list --json`
- `src/lib/cloister/work-agent-prompt.ts` — `readBeadsTasks()` uses `bd list --json` with JSONL fallback
- `src/dashboard/server/index.ts` — Gate checks, copy logic, planning prompt with vBRIEF format
- `src/cli/commands/install.ts` — Dolt preflight check and auto-install

## Files to Create/Modify (Future Phases)

### Phase 2
- `src/lib/planning/vbrief-to-beads.ts` — Converter (NEW)
- `src/cli/commands/vbrief.ts` — CLI commands (NEW)
- `src/dashboard/server/index.ts` — Remove `bd create` from planning prompt

### Phase 3
- `src/dashboard/frontend/src/components/VBriefDagView.tsx` — Graph component (NEW)
- `src/dashboard/frontend/package.json` — Add `@xyflow/react` dependency

### Phase 4
- `src/lib/cloister/dag-scheduler.ts` — DAG scheduling logic (NEW)
- `src/lib/cloister/specialists.ts` — Integrate DAG readiness into dispatch
