---
name: pan-admin-cloister
description: "pan admin cloister <cmd> — deacon-lite management: status, start, stop, emergency-stop"
triggers:
  - pan admin cloister
  - cloister status
  - watchdog
  - lifecycle watchdog
  - emergency stop agents
allowed-tools:
  - Bash
---

# pan admin cloister

Manage deacon-lite — the surviving watchdog. It observes and nudges or
notifies; it never reconciles a stored copy of pipeline state. Its four
routines: nudge work agents idle too long with unpushed work, nudge agents
stuck on a repeated API error, reconcile the dashboard's agent-liveness
cache against the terminal backend's own inventory, and reap agents left
behind on closed issues.

## Usage

```
pan admin cloister status [--json]   # Show watchdog service status and agent health
pan admin cloister start             # Start the watchdog (no-op if already running)
pan admin cloister stop              # Stop the watchdog (running agents continue)
pan admin cloister emergency-stop    # Kill ALL agents immediately — destructive
```

Stopping the watchdog does NOT stop running work agents — they continue in
their sessions. It only suspends deacon-lite's own nudges and liveness
reconciliation. Restart with `pan admin cloister start` to re-engage it.

## When to use each subcommand

- **`status`** — first stop for diagnosing why an idle agent wasn't nudged,
  or why the dashboard's liveness view looks stale.
- **`start`** — after a host reboot, after `stop`, or when `pan status` shows
  no watchdog process.
- **`stop`** — when debugging the watchdog itself, or when you want to make
  manual lifecycle interventions without it racing you.
- **`emergency-stop`** — last resort. Kills every running agent (work, review,
  test, planning). Workspaces and branches survive but sessions
  are destroyed. Use when something has gone catastrophically wrong (runaway
  fork, memory exhaustion, billing alert).

## Confirm before emergency-stop

Treat `emergency-stop` like `pan wipe`: confirm with the user before invoking
it. It's not destructive to source or git state, but it terminates in-flight
work and the user will need to recover or restart agents.

## See also

- `pan admin specialists <cmd>` — manage review/test/ship specialist pool
- `pan recover <id>` — recover a crashed work agent
- `pan show <id> --health` — agent health and heartbeat
- `pan resources` — RAM/swap usage by agent
- `roles/work.md` — work-agent role definition
