---
name: pan-swarm
description: Start and recover Overdeck swarm slots for planned issues with `pan swarm`; use for parallel work dispatch or failed-slot recovery.
---

# Pan Swarm

Use `pan swarm` when an issue has a finalized vBRIEF plan and the operator wants Deacon-managed parallel slot execution.

## Start a Swarm

Run:

```bash
pan swarm PAN-2203
```

If the plan is not swarm eligible, stop and report the printed reason. Do not manually spawn slot agents.

When `pan swarm PAN-2203` succeeds, it ensures the issue workspace exists, dispatches the first wave of slot agents, and leaves ongoing merge, garbage collection, and next-wave dispatch to Deacon.

## Recover a Failed Slot

Run:

```bash
pan swarm recover PAN-2203 1 --action retry
```

Use `--action retry` to unblock and redispatch the failed item, `--action drop` to mark the item done after operator review, or `--action handoff` to keep the failed slot blocked for manual resolution.

## Freeze and Resume Coordination

Run:

```bash
pan swarm freeze PAN-2203 --reason "investigating slot churn"
pan swarm resume PAN-2203
```

`pan swarm freeze` places a per-issue operator hold: the Deacon skips all swarm coordination for the issue — no slot reconciliation, merging, garbage collection, or new dispatch — until the hold is lifted. Slot agents that are already running keep running. `--reason <text>` records why the hold was placed.

`pan swarm resume` lifts the hold; coordination picks the issue back up on the next Deacon patrol cycle. Both commands are idempotent: freezing an already-frozen issue or resuming an unfrozen issue succeeds with an "already" notice.

## Stop a Swarm

Run:

```bash
pan swarm stop PAN-2203 --reason "runaway slot dispatch"
```

`pan swarm stop` sets the same per-issue hold as `pan swarm freeze` FIRST (so the Deacon cannot re-spawn slots mid-stop), then stops every live slot agent for the issue via the agent lifecycle (agents-table status is updated, not just tmux-killed). Slot branches and worktrees are preserved — stopping deletes no work. With zero live slots it still succeeds and sets the hold. Run `pan swarm resume` to re-enable coordination afterwards.
