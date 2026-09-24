---
name: pan-swarm
description: Start or operate a foreman-driven Overdeck swarm with gated dispatch, merge, observation, and recovery commands.
---

# Pan Swarm

Use `pan swarm` only for a finalized, swarm-eligible xBRIEF. The resident parent work agent is the foreman. It owns decisions and drives deterministic CLI gates; the Deacon only runs janitor, liveness, and event-reporting duties.

## Start or attach

```bash
pan swarm PAN-2203
```

This validates readiness, ensures the parent workspace, and spawns or messages `agent-pan-2203` as the foreman. It does not dispatch slots. Re-running it attaches to the live foreman instead of creating a duplicate.

## Foreman loop

1. Read `.pan/continue.json`, then run `pan swarm status PAN-2203 --json`.
2. Run `pan swarm dispatch PAN-2203 --json` for one safe wave.
3. Run `pan swarm wait PAN-2203 --timeout 300 --json` until state changes.
4. Run `pan swarm merge PAN-2203 <slot> --json` only for a completion-ready slot.
5. Run the parent feature-branch integration checks.
6. Recover failures through `pan swarm recover`; do not invent a direct state edit.
7. Repeat. If resolved `autoAdvance` is false, get operator acknowledgement before the next dispatch.

`status` is read-only. `wait` returns a structured delta instead of requiring transcript polling. The dispatch gate enforces DAG blockers, file-scope isolation, holds, capacity, and duplicate-slot checks. The merge gate verifies work before it writes item completion and clears the slot marker.

## Recovery

```bash
pan swarm recover PAN-2203 1 --action retry
pan swarm recover PAN-2203 1 --action drop
pan swarm recover PAN-2203 1 --action handoff
pan swarm recover PAN-2203 1 --action reclaim
```

- `retry` archives the attempt and returns the item to gated dispatch.
- `drop` completes an item only after operator review confirms it is unnecessary.
- `handoff` preserves the block for manual resolution.
- `reclaim` archives and unblocks the slot, then assigns the item to the foreman for serial implementation.

Every action increments a durable counter by slot and failure class. A fourth automatic intervention is refused; only an operator may override it with `--operator`.

When a `[swarm-event]` reports a stopped, completed, or stalled slot, run `status --json`, reconcile the evidence, and choose the next gate. A stall message is detection only. The Deacon writes no stall recovery block.

## Holds and cleanup

```bash
pan swarm freeze PAN-2203 --reason "investigating"
pan swarm stop PAN-2203 --reason "stop running slots"
pan swarm resume PAN-2203
pan swarm reset PAN-2203 --reason "clean restart"
```

Freeze writes `swarm.hold`; stop writes the hold before stopping slot agents. Resume clears the hold. Reset pushes unmerged slot branches before local deletion and leaves the hold set. Do not continue the foreman loop while held.

## Completion

A slot finishes with `pan done <issue>`, which writes a durable completion marker. If the signal is missing, the configured completion classifier may nudge or infer completion from stable git evidence. The foreman still uses `pan swarm merge`; it never merges a live or unverified slot directly.

## Context and handoff

Commit and push one item before advancing it. If context becomes unsafe, write current wave state and next actions to `.pan/continue.json`, then use the normal persistent-session handoff. The replacement foreman starts with `status --json` and resumes the same loop.
