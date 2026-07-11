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
   `classifyInFlightSlots()` classifies slots as `running`, `ready-to-merge`, `failed`, or `stalled`. It checks a slot's durable completion marker first (see [Durable Slot Completion](#durable-slot-completion) below); a matching marker makes the slot `ready-to-merge` with signal `durable-completion` regardless of session state. Otherwise a pane exit code of 0 makes a slot ready to merge. A missing session, missing agent, non-zero pane exit, or unknown dead-pane exit makes it failed. A live pane with no branch-tip commit progress and no pane-output progress past the stall threshold becomes stalled.

5. Verify and merge ready slots.
   `mergeReadySlots()` calls `verifyAndMergeSlot()` for each slot that is not blocked. On success it writes the item `done` through `applyTaskOperationToPlanFile()`. On merge conflicts it records a per-slot failed-merge recovery block; the coordinator then skips that slot on subsequent passes while continuing to merge and dispatch the remaining slots.

6. Garbage collect merged slots.
   `gcMergedSlots()` removes merged slot worktrees and branches after the slot has been incorporated into the parent feature branch.

7. Dispatch the next wave.
   `dispatchNextWave()` calls `getDispatchableItems(doc, mergedItemIds)`, filters to slot-eligible items, applies file-overlap serialization, checks global capacity, allocates the lowest free slot index, claims the vBRIEF item through the write door, and spawns `agent-<issue>-slot-N`.

8. Recover failed or stalled slots.
   Failed merge and stalled-slot records are stored per slot. A block pauses automatic advancement for that specific slot only; the coordinator keeps working on the rest of the issue. `pan swarm status` lists all blocked slots and labels them `failed-merge-blocked` so they are not misreported as `ready-to-merge`. Recovery is applied slot-by-slot with `pan swarm recover <id> <slotIndex>`.

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

`pan swarm recover <id> <slotIndex> --action retry|drop|handoff` targets a single blocked slot. Failed-merge and stalled-slot blocks are stored per-slot, so one blocked slot does not halt the rest of the swarm. The coordinator continues merging and dispatching other slots while any slot remains blocked.

| Action | Effect |
| --- | --- |
| `retry` | Archives the conflicted slot attempt (renames its branch and worktree to a superseded attempt record) so the old attempt cannot re-assert, unblocks the item, clears the per-slot block, and redispatches a fresh attempt through `dispatchNextWave()`. |
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

If neither changes before the stall threshold elapses, the slot becomes `stalled`. Deacon records a per-slot recovery block and stops advancing that specific slot until the operator chooses `retry`, `drop`, or `handoff` for that slot. Other slots continue normally.

The default stall threshold is 30 minutes. It can be overridden with `PAN_SWARM_STALL_THRESHOLD_MS` for test or operational tuning.

## Durable Slot Completion

A slot can finish its work and exit its agent cleanly yet leave no durable signal: the workspace record's `statusOverrides` may be absent (the bug PAN-2372 fixed), and a vanished tmux session is rebuildable, not proof of completion. Swarm v2 now records completion on the permanent plane and, when that record is missing, infers it from git state.

### Durable marker — `swarm.slotCompletions`

When a slot work agent runs `pan done <issue>`, the CLI writes a completion marker into the per-issue record at `swarm.slotCompletions[String(slotIndex)]` and reads it back to confirm the write landed (`persistAndVerifySwarmSlotCompletion()` in `src/lib/cloister/deacon-swarm-record.ts`). A marker carries `slotIndex`, an optional `itemId`, `agentId`, and `completedAt`.

`classifyInFlightSlots()` checks this marker at the top of the per-slot loop, before any session, agent, or pane classification. A marker whose `itemId` is absent or matches the slot classifies the slot `ready-to-merge` with signal `durable-completion`. Because the marker is the strongest completion evidence, it beats a vanished session that would otherwise classify as `failed`.

The coordinator clears the marker through the record door when the slot leaves flight:

- **merge** — `mergeReadySlots()` clears the slot's marker after it writes the item `done`;
- **requeue / supersede** — `archiveFailedSwarmSlot()` clears the marker so a fresh attempt on the same `slotIndex` is not falsely observed as already complete.

### Inferred completion — `swarm.infer_completion`

For a slot that has committed clean, branch-ahead work but written no marker — the agent exited without signaling, or the marker write raced — `classifyDoneWithoutSignal()` infers completion from git state: a branch-ahead count of at least 1 and a state-plane-clean worktree (see below). The default mode is `auto`:

- **`auto`** (default) — nudge the slot's agent once (`run pan done <issue>`), then after two consecutive stable observations (unchanged commit time, output digest, and ahead count) classify the slot `ready-to-merge` with signal `inferred`.
- **`nudge`** — nudge once and never converge; the slot stays `awaiting-completion-signal` until an explicit `pan done` lands. Use this when an operator-visible signal is required.
- **`off`** — no nudge and no inference; `classifyDoneWithoutSignal()` returns `null` and the slot is left to normal stall/failed classification.

Set the mode in `~/.overdeck/cloister.toml` under `[swarm] infer_completion`, or override it per process with the `PAN_SWARM_INFER_COMPLETION=auto|nudge|off` environment variable. The previous default was `nudge`; it is now `auto`, so a slot that genuinely finished is not stuck awaiting a signal that never arrives.

### State-plane-clean worktree

Both inference paths treat the slot worktree as clean when the only `git status` dirt is state-plane state — `.pan/continue.json`, the workspace record door, and the other durable paths the swarm writes to the permanent plane (the full set is enumerated in `STATE_PLANE_PATHS`). Their presence must not block a slot from being inferred complete. `defaultIsSlotWorktreeClean()` in `src/lib/cloister/deacon-swarm-completion.ts` delegates to `isStatePlaneOnlyStatus()`. A genuinely dirty worktree — uncommitted implementation edits — still blocks inference.

## Synthesis Slots

When a vBRIEF item is a convergence point, Deacon may dispatch a synthesis slot before implementation. The synthesis slot writes concise context into item metadata. The following implementation slot receives an active-slice prompt containing that synthesis context.

This keeps downstream implementation prompts bounded while preserving the relevant outputs from multiple parent items.

## Out of Scope

Remote Fly slots from PAN-1773 are layered on top of this model. Swarm v2 currently describes local slot worktrees and local tmux-backed agents.

Difficulty-tier and model-routing behavior from PAN-1791 is also layered on top. The current coordinator enforces readiness, file scope, capacity, duplicate-spawn, merge, and recovery rules. Future routing can choose different models or tiers for a slot without changing the core derive/reconcile/dispatch loop.
