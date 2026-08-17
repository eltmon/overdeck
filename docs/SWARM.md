# Swarm v2

Swarm v2 uses one resident foreman work agent, `agent-<issue>`, to drive parallel xBRIEF items through deterministic CLI gates. Each slot remains an ordinary registered work agent in its own worktree. The Deacon only enumerates and garbage-collects slot resources, reports slot events, and revives a missing foreman.

Start or attach to the foreman with:

```bash
pan swarm PAN-2203
```

The command validates swarm readiness, ensures the feature workspace, and spawns or messages the foreman. It never dispatches a slot itself. The foreman stays resident and owns the wave loop until the plan is complete, held, or handed back to the operator.

## Workspaces and state

The parent feature workspace belongs to the foreman:

```text
workspaces/feature-<issue>/
feature/<issue>
agent-<issue>
```

Each parallel item gets an isolated slot:

```text
workspaces/feature-<issue>-slot-<N>/
feature/<issue>-slot-<N>
agent-<issue>-slot-<N>
```

There is no canonical `SwarmRuntime` sidecar. The foreman derives current state from the xBRIEF DAG, issue record, branches, worktrees, agent rows, and tmux sessions. Durable swarm facts use the issue record write door, including holds, assignments, intervention counts, completion observations, completion markers, failed-merge blocks, superseded attempts, and reclaimed items.

## Foreman wave loop

The foreman repeats these steps. Each mutation goes through a named gate, so reconnecting after a crash is safe.

1. Run `pan swarm status <id> --json` to reconcile the foreman, hold, capacity, and slot lifecycle state.
2. Select only items allowed by `getDispatchableItems()`. A blocking parent must be complete before its dependent can start.
3. Run `pan swarm dispatch <id> --json` once. The dispatch gate applies readiness, file-overlap, capacity, hold, and duplicate-slot checks before it claims and spawns work.
4. Run `pan swarm wait <id> --timeout 300 --json` instead of polling transcripts. Slot completion, failure, hold, or foreman state changes wake the loop.
5. For each completion-ready slot, run `pan swarm merge <id> <slot> --json`. The merge gate refuses live or unsignaled work, verifies the item, merges it, marks it done, and clears its completion marker.
6. Run the feature-branch integration checks named by the project before advancing the next wave.
7. Resolve failures with `pan swarm recover <id> <slot> --action retry|drop|handoff|reclaim`. The foreman chooses the recovery action; the Deacon only reports the event.
8. Repeat from status. If `autoAdvance` is false, wait for operator acknowledgement between waves.

The Deacon patrol calls `swarmJanitorPass()`. That pass never dispatches, merges, or selects recovery. It removes merged or orphaned slot resources, emits `[swarm-event]` messages for stopped, completed, or stalled slots, and restores one missing foreman when policy and capacity allow. Three consecutive foreman respawn failures set `swarm.hold` and emit an operator halt report.

## Command gates

### Status and wait

```bash
pan swarm status PAN-2203
pan swarm status PAN-2203 --json
pan swarm wait PAN-2203 --timeout 300 --json
```

Status is read-only. It reports the foreman session, durable hold, intervention counters, reserved capacity, and reconciled slots. Wait returns a structured delta after a slot, foreman, or hold transition.

### Dispatch

```bash
pan swarm dispatch PAN-2203 --json
```

The gate dispatches at most one safe wave. It refuses held issues and blocked dependents, serializes overlapping `files_scope` values, uses the reserved swarm capacity, and releases a claim if spawn fails. It also refuses an occupied slot index when a live session, unmerged branch, recorded assignment, or existing slot worktree already owns it.

### Merge

```bash
pan swarm merge PAN-2203 1 --json
```

The gate accepts only `ready-to-merge` slots. It runs the item's verification commands in the slot workspace, merges into the parent feature branch, writes item completion through the task door, clears the durable completion marker, and reaps merged slot resources. A conflict writes a per-slot failed-merge block.

### Recover

```bash
pan swarm recover PAN-2203 1 --action retry
pan swarm recover PAN-2203 1 --action drop
pan swarm recover PAN-2203 1 --action handoff
pan swarm recover PAN-2203 1 --action reclaim
```

Each action increments `swarm.interventions[slot][failureClass]`. The fourth automatic intervention in one class is refused unless the operator passes `--operator`.

| Action | Result |
| --- | --- |
| `retry` | Archive the failed attempt, clear its block and assignment, and return the item to a future gated dispatch. |
| `drop` | Mark the item complete after the operator confirms its output is unnecessary. |
| `handoff` | Keep the block and record that manual resolution owns the slot. |
| `reclaim` | Archive and unblock the slot, then record that the foreman will implement the item serially in the parent workspace. |

### Freeze, stop, resume, and reset

```bash
pan swarm freeze PAN-2203 --reason "investigating"
pan swarm stop PAN-2203 --reason "stop slot work"
pan swarm resume PAN-2203
pan swarm reset PAN-2203 --reason "clean restart"
```

Freeze writes `swarm.hold`; running slots remain alive, but the foreman must stop mutation. Stop writes the hold first and then stops live slot agents without deleting branches or worktrees. Resume clears the hold. Reset preserves work by pushing unmerged slot branches before removing local slot resources; it aborts if that backup fails unless the operator explicitly uses `--force`. The hold remains after reset.

## Policy

`off` uses serial work and prevents automatic foreman creation. `auto` lets the janitor create a foreman when the xBRIEF is swarm-eligible. `always` requires readiness rather than silently falling back to serial work. Manual `pan swarm <id>` remains available for an eligible plan regardless of inherited mode.

`autoAdvance` controls foreman pacing. `true` lets the foreman advance after integration checks. `false` requires operator acknowledgement between waves. It never authorizes the Deacon to dispatch slots.

Set issue policy with `pan staffing <id> --swarm off|auto|always|default`. Global and project settings use the same fields: `mode`, `maxSlots`, and `autoAdvance`.

## Completion and stalls

`pan done <issue>` from a slot writes `swarm.slotCompletions[slot]`. `classifyInFlightSlots()` checks that marker before runtime state, so a matching marker remains completion evidence after a session disappears. The merge gate clears it after success; requeue and supersede paths clear it before slot reuse.

If the marker is missing, `swarm.infer_completion` controls git-based inference:

- `auto` and `nudge` request `pan done` from a live slot but never infer its completion from branch state alone.
- `off` disables both behavior paths.

When a slot has no live agent, clean current-item commits can still prove durable completion. Polyrepo checks count commits in the item's real repositories, not wrapper bookkeeping. Completion observations live in `swarm.completionObservations`, so a Deacon restart does not reset the evidence. State-plane-only worktree changes count as clean; uncommitted implementation changes do not.

The Deacon retains progress fingerprints in its process for stall detection. If branch-tip and pane-output fingerprints do not change for 30 minutes, it sends one `[swarm-event] slot N stalled` message to the foreman. It writes no recovery block and makes no recovery decision. `PAN_SWARM_STALL_THRESHOLD_MS` overrides the threshold for tests or operations.

## Tiered execution

The foreman may execute a small, high-confidence item in context or delegate it to a standing tier session. This is still supervised work: the foreman owns the claim, verifies the result, commits one item, pushes it, and advances task state. Independent slot agents must still be created through `pan swarm dispatch`; an unsupervised subagent is never a slot.

## Scope

This document covers local tmux-backed slots. Remote execution and model-tier routing may choose where a gate starts work, but they do not change foreman ownership, the record write door, or the dispatch and merge gates.
