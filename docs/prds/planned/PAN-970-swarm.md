# PAN-970: Swarm — Multi-Agent Parallel Execution

## Vision

Enable multiple work agents to execute vBRIEF items in parallel on the same issue, with Cloister as the orchestrating monitor. Each agent gets its own git worktree and beads claims. The DAG's dependency structure drives wave scheduling — independent items run simultaneously, blocking dependencies enforce ordering. When a wave completes, worktrees merge in dependency order and the next wave spawns.

## Motivation

Panopticon runs one work agent per issue. Items execute serially even when the vBRIEF DAG shows independent parallel lanes. PAN-969's Directive Flow visualizes these parallelization opportunities — swarm realizes them.

Deft's swarm implementation relies on Warp terminal's undocumented `start_agent` + `send_message_to_agent` runtime tools, falling back to manual terminal tabs without Warp. Panopticon already owns:

- **tmux session management** — spawning, monitoring, and messaging agent sessions
- **Cloister lifecycle orchestration** — stuck detection, specialist handoffs, completion signals
- **Beads task tracking** — deterministic item-to-task mapping with mutex-serialized writes
- **Git worktree infrastructure** — `workspace-manager.ts` creates worktrees with full build + install

We can build native swarm without any terminal-emulator dependency.

## Architecture (3 sentences)

Cloister's wave scheduler partitions vBRIEF items into dependency waves using Kahn's algorithm on `blocks` edges, then spawns one agent per item-group in the current wave, each in its own git worktree branched from the issue's feature branch. When all agents in a wave complete (detected via existing completion signals), Cloister runs a merge cascade — rebasing worktrees in topological order, running verification per-worktree, then squash-merging into the feature branch — before spawning the next wave. The specialist pipeline (VERIFY → REVIEW → TEST → MERGE) runs once on the final merged result after all waves complete.

## Design

### Wave Scheduler

Analyze the vBRIEF DAG using `blocks` edges (same algorithm as `criticalPath()` in `dag.ts`) to partition items into waves:

```
Wave 1: [items with no unmet blocks dependencies]  → spawn N agents
Wave 2: [items whose blockers are all in wave 1]   → spawn after wave 1 merges
Wave 3: [items whose blockers are all in waves 1-2] → spawn after wave 2 merges
...
```

`informs`, `suggests`, and `invalidates` edges do NOT block wave assignment — they're hints, not hard dependencies.

Before assignment, the scheduler runs a **file-overlap audit**: items that modify the same files are serialized (moved to consecutive waves) even if the DAG allows parallelism. Overlap detection uses vBRIEF narrative analysis and, when available, historical file-touch data from prior runs.

### Agent Slots

Each swarm agent is an **agent slot**:

| Property | Single-agent (today) | Swarm slot |
|----------|---------------------|------------|
| Worktree | `workspaces/feature-<issueId>/` | `workspaces/feature-<issueId>-slot-<N>/` |
| Branch | `feature/<issueId>` | `feature/<issueId>/slot-<N>` |
| tmux session | `agent-<issueId>` | `agent-<issueId>-<N>` |
| Beads | All items | Claimed subset |
| .pan/spec.vbrief.json | Full plan | Full plan (items scoped via beads claims) |

Slots branch from the issue's feature branch (or main for wave 1). Each slot's agent receives the full vBRIEF but is instructed to work only on its claimed items. Beads claims (`bd update --claim`) enforce this at the task level.

### Cloister as Monitor

Cloister already manages the agent lifecycle. Swarm extends it with:

1. **Wave state machine**: `idle → planning → wave-N-running → wave-N-merging → wave-N+1-running → ... → all-waves-complete → specialist-pipeline`
2. **Per-agent tracking**: Each slot is an independent agent in `agentsById`. Cloister monitors all slots for the issue.
3. **Completion aggregation**: A wave completes when ALL slots in that wave have signaled done. If one slot is stuck, existing stuck-detection and intervention flows apply per-slot.
4. **Wave transition**: On wave completion → merge cascade → spawn next wave's agents.

### Merge Cascade

When all agents in a wave complete:

1. **Order worktrees** by topological sort of their assigned items
2. **For each worktree** (in order):
   a. Rebase onto latest feature branch
   b. Run verification gate (typecheck + lint + test)
   c. If verification passes: squash-merge into feature branch
   d. If conflict: attempt auto-resolution, else flag for human intervention
3. **Clean up** merged slot worktrees and branches
4. **Spawn** next wave's agents from the updated feature branch

The merge cascade is serialized — no concurrent merges to the feature branch. This eliminates merge conflict races.

### Command Deck Display

Extend `FeatureItem.tsx` with a `WorkGroup` component (mirroring the existing `ReviewGroup` for reviewers):

```
PAN-970
├── planning-pan-970         (type: 'planning')
├── ▸ Work (Wave 2 · 3/5 items)
│   ├── agent-pan-970-1      (slot 1: enriched-work-node, gate-nodes)
│   ├── agent-pan-970-2      (slot 2: rework-edges)
│   └── agent-pan-970-3      (slot 3: live-data-wiring)
├── review-PAN-970-...       (type: 'review')
│   └── [reviewer children]
└── merge-pan-970            (type: 'merge')
```

Each agent node in the WorkGroup shows:
- Assigned vBRIEF item titles
- Beads completion progress (2/3 tasks)
- Agent status (running/stopped/stuck)
- Model name

The `buildActivitySummary()` function already pluralizes ("2 work agents running") — it just needs the slot data.

### CLI Command

```bash
pan swarm <issueId>          # Analyze DAG, show wave plan, spawn wave 1
pan swarm <issueId> --dry-run # Show wave plan without spawning
pan swarm <issueId> --wave N  # Re-run specific wave (after conflict resolution)
```

The `pan swarm` command:
1. Loads vBRIEF from `.pan/specs/` or workspace `.pan/spec.vbrief.json`
2. Runs wave scheduler → produces wave assignments
3. Runs file-overlap audit → adjusts assignments
4. Prints the wave plan (items per wave, estimated parallelism)
5. Spawns wave 1 agents (or confirms with user first)

### Directive Flow Integration (PAN-969)

The Directive Flow DAG shows swarm state naturally:
- Work item nodes assigned to different agents get a **slot badge** (colored dot matching agent slot)
- Multiple items glow simultaneously when their agents are running
- The wave boundary is a subtle horizontal separator in the DAG layout
- Summary strip shows: "Wave 2/3 · 3 agents running · 5/11 items complete"

## Data Model Changes

### AgentSnapshot extensions

```typescript
interface AgentSnapshot {
  // existing fields...
  slot?: number;              // agent slot number (undefined = single-agent mode)
  swarmWave?: number;         // which wave this agent belongs to
  assignedItems?: string[];   // vBRIEF item IDs assigned to this agent
}
```

### New SwarmState in read model

```typescript
interface SwarmState {
  issueId: string;
  mode: 'single' | 'swarm';
  waves: Wave[];
  currentWave: number;
  mergeState: 'idle' | 'cascading' | 'conflict';
}

interface Wave {
  number: number;
  status: 'pending' | 'running' | 'merging' | 'complete' | 'conflict';
  slots: SlotAssignment[];
}

interface SlotAssignment {
  slot: number;
  agentId: string;
  itemIds: string[];
  status: 'pending' | 'running' | 'complete' | 'stuck' | 'conflict';
}
```

## Depends On

- PAN-967 (unified `.pan/` directory — merged)
- PAN-969 (Directive Flow — DAG visualization shows parallelization opportunities)

## Relates To

- Deft swarm skill — reference architecture (Warp-dependent, we go terminal-agnostic)
- `src/lib/vbrief/dag.ts` — wave scheduling reuses criticalPath's Kahn's algorithm
- `src/lib/workspace-manager.ts` — slot worktree creation extends existing createWorkspace
- `FeatureItem.tsx` `ReviewGroup` — pattern for WorkGroup component
- `src/lib/vbrief/beads.ts` — beads claim system for item assignment

## Non-Goals

- Cloud/remote agent execution
- Automatic parallelism without a vBRIEF (requires structured plan)
- Cross-issue swarm (one issue = one specialist pipeline run)
- Changing the specialist pipeline flow
- Dynamic re-assignment mid-wave (agent keeps its items until wave completes)
