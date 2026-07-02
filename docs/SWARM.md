# Swarm v2

Swarm v2 runs one work agent per vBRIEF item when the plan DAG, file scope, and global capacity allow safe parallel work. It is coordinated by Deacon, not by a durable sidecar runtime file.

The shipped operator entry point is:

```bash
pan swarm <id>
```

The shipped recovery entry point is:

```bash
pan swarm recover <id> <slotIndex> --action retry
```

`CLAUDE.md` and agent context references to `pan swarm <id>` are now accurate: the command exists, checks plan eligibility, ensures the feature workspace, dispatches the first wave through the same selection path Deacon uses, and then leaves ongoing coordination to Deacon.

## Mental Model

A swarm issue has one normal feature workspace:

```text
workspaces/feature-<issue>/
feature/<issue>
agent-<issue>
```

Each slot gets its own worktree, branch, and work-agent identity:

```text
workspaces/feature-<issue>-slot-<N>/
feature/<issue>-slot-<N>
agent-<issue>-slot-<N>
```

The vBRIEF DAG decides what can run. `getDispatchableItems(doc, mergedItemIds)` returns items whose blocking parents are merged or already terminal in the plan. `analyzeSwarmReadiness(doc)` decides which of those items are safe slot candidates based on item readiness, `files_scope`, `files_scope_confidence`, verify commands, and expected outputs.

Two dispatchable items whose `files_scope` overlaps are serialized. Deacon may dispatch a later item only after the overlapping item is merged.

## coordinateSwarmSlots Loop

`coordinateSwarmSlots()` in `src/lib/cloister/deacon-swarm.ts` is the host-side orchestrator. The loop is intentionally derive-first:

1. Enumerate feature workspaces.
   Deacon lists regular `feature-*` workspaces and skips `feature-*-slot-N` workspaces for swarm enumeration.

2. Load and check the plan.
   Deacon loads the main-side vBRIEF spec with `findSpecByIssue()` and runs `analyzeSwarmReadiness()`. Non-eligible plans are ignored by the patrol; the CLI prints the reason.

3. Reconcile slot state.
   `reconcileSlotState()` derives merged, in-flight, pending, branch, and agent state from git branches, worktrees, agent state, and vBRIEF item status. Runtime truth is not stored in a swarm JSON file.

4. Detect slot lifecycle.
   `classifyInFlightSlots()` classifies slots as `running`, `ready-to-merge`, `failed`, or `stalled`. A pane exit code of 0 makes a slot ready to merge. A missing session, missing agent, non-zero pane exit, or unknown dead-pane exit makes it failed. A live pane with no branch-tip commit progress and no pane-output progress past the stall threshold becomes stalled.

5. Verify and merge ready slots.
   `mergeReadySlots()` calls `verifyAndMergeSlot()`. On success it writes the item `done` through `applyTaskOperationToPlanFile()`. On merge conflicts it records a failed-merge recovery block.

6. Garbage collect merged slots.
   `gcMergedSlots()` removes merged slot worktrees and branches after the slot has been incorporated into the parent feature branch.

7. Dispatch the next wave.
   `dispatchNextWave()` calls `getDispatchableItems(doc, mergedItemIds)`, filters to slot-eligible items, applies file-overlap serialization, checks global capacity, allocates the lowest free slot index, claims the vBRIEF item through the write door, and spawns `agent-<issue>-slot-N`.

8. Recover failed or stalled slots.
   Failed merge and stalled-slot records pause automatic advancement for that issue until `pan swarm recover` applies an operator-selected action.

## CLI

### Start

```bash
pan swarm PAN-2203
```

`pan swarm <id>`:

- resolves the issue to its project;
- loads the main-side vBRIEF plan;
- runs `analyzeSwarmReadiness()`;
- exits non-zero with reasons when the plan is not swarm eligible;
- ensures `workspaces/feature-<issue>/` exists;
- dispatches wave 0 by calling `dispatchNextWave()`; and
- prints the dispatched slot actions.

It does not stay resident. After the first dispatch, Deacon continues merge, garbage collection, next-wave dispatch, stall detection, and recovery blocking.

### Recover

```bash
pan swarm recover PAN-2203 1 --action retry
pan swarm recover PAN-2203 1 --action drop
pan swarm recover PAN-2203 1 --action handoff
```

`pan swarm recover <id> <slotIndex> --action retry|drop|handoff` calls the same recovery path used by Deacon:

| Action | Effect |
| --- | --- |
| `retry` | Unblocks the item, clears the failed-slot block, and redispatches through `dispatchNextWave()`. |
| `drop` | Marks the item done through the vBRIEF write door and clears the block. Use only when the operator has verified the slot output is no longer needed. |
| `handoff` | Keeps advancement paused and records an operator handoff note for manual resolution. |

## Derive, Do Not Store

Swarm v2 does not keep a canonical `SwarmRuntime` sidecar. The durable sources of truth are:

- the vBRIEF spec and item status;
- git branches and worktrees;
- agent state and tmux sessions; and
- review or merge evidence written through existing writer surfaces.

Everything else is derived on patrol. This keeps recovery simple: if Deacon restarts, it re-enumerates workspaces, branches, agents, panes, and plan status instead of trusting a separate runtime file that can drift.

Writes still go through the existing write doors. Deacon claims, unblocks, and completes items with `applyTaskOperationToPlanFile()`. It does not directly edit ad-hoc runtime state to make an item appear done.

## Duplicate-Spawn Guard

Before any slot spawn, `dispatchNextWave()` refuses to claim and spawn when it detects that the target slot is already occupied by:

- a live `agent-<issue>-slot-N` tmux session;
- an unmerged `feature/<issue>-slot-N` branch; or
- an existing `workspaces/feature-<issue>-slot-N/` worktree.

This protects reconnecting or paused slots from being double-spawned onto the same worktree.

## Stalled Slots

Pane exit alone is not enough. A model can leave a pane alive while making no progress. Swarm v2 tracks per-slot progress by observing both:

- the branch-tip commit time for the slot branch; and
- the captured pane output digest.

If neither changes before the stall threshold elapses, the slot becomes `stalled`. Deacon records a recovery block and stops advancing that issue until the operator chooses `retry`, `drop`, or `handoff`.

The default stall threshold is 30 minutes. It can be overridden with `PAN_SWARM_STALL_THRESHOLD_MS` for test or operational tuning.

## Synthesis Slots

When a vBRIEF item is a convergence point, Deacon may dispatch a synthesis slot before implementation. The synthesis slot writes concise context into item metadata. The following implementation slot receives an active-slice prompt containing that synthesis context.

This keeps downstream implementation prompts bounded while preserving the relevant outputs from multiple parent items.

## Out of Scope

Remote Fly slots from PAN-1773 are layered on top of this model. Swarm v2 currently describes local slot worktrees and local tmux-backed agents.

Difficulty-tier and model-routing behavior from PAN-1791 is also layered on top. The current coordinator enforces readiness, file scope, capacity, duplicate-spawn, merge, and recovery rules. Future routing can choose different models or tiers for a slot without changing the core derive/reconcile/dispatch loop.
