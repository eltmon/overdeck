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

When `pan swarm PAN-2203` succeeds, it ensures the issue workspace exists, then runs the same coordination pass the Deacon patrol runs — reconcile live slot state, merge ready slots, garbage-collect merged slots, and dispatch the next wave — and leaves ongoing coordination to Deacon.

Re-running `pan swarm PAN-2203` is idempotent: the coordination pass reconciles already-dispatched work (live sessions, unmerged slot branches, recorded assignments) and spawns nothing new for it, so a second back-to-back run does not duplicate slots or race the Deacon. If the issue is under an operator hold (`pan swarm freeze` / `pan swarm stop`), the command dispatches nothing and points at `pan swarm resume`.

## Inspect Swarm State

Run:

```bash
pan swarm status PAN-2203
```

`pan swarm status` is read-only — it performs no writes, no git mutation, and no dispatch. It prints one row per reconciled slot (index, item, lifecycle, branch merged/unmerged, agent session alive/dead), the hold state (whether the Deacon is skipping the issue and how to resume), and capacity (tmux-alive slot sessions against the reserved swarm slot limit).

## Recover a Failed Slot

Run:

```bash
pan swarm recover PAN-2203 1 --action retry
```

Use `--action retry` to unblock and redispatch the failed item, `--action drop` to mark the item done after operator review, or `--action handoff` to keep the failed slot blocked for manual resolution.

## Reset a Swarm (Work-Preserving)

Run:

```bash
pan swarm reset PAN-2203
```

Reset stops the swarm (hold first, so the Deacon cannot re-spawn slots mid-cleanup), pushes every unmerged local slot branch to origin BEFORE deleting anything, removes all slot worktrees and local slot branches, clears the recorded slot assignments and any failed-merge block, marks lingering live-status slot agent rows stopped, and retires dead slot agent records through the canonical agent removal door. Slot agents with live tmux sessions are reported and never removed. If pushing an unmerged branch fails, the reset aborts with nothing deleted — pass `--force` only when you accept losing the origin backup. Use `--reason <text>` to record why on the hold.

After a reset the hold remains set: run `pan swarm resume PAN-2203` to re-enable coordination, then `pan swarm PAN-2203` to dispatch a fresh wave. Re-running reset on an already-clean issue succeeds and does nothing.

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
