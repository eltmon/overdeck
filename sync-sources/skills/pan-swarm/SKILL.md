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
