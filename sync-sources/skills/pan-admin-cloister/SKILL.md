---
name: pan-admin-cloister
description: "pan admin cloister <cmd> — lifecycle watchdog management: status, start, stop, freeze, unfreeze, brake, emergency-stop"
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

Manage the Cloister lifecycle watchdog — the daemon that monitors running agents,
handles verification gates after completion, and triggers the review → test →
ship specialist pipeline.

## Usage

```
pan admin cloister status [--json]   # Show watchdog service status and agent health
pan admin cloister start             # Start the watchdog (no-op if already running)
pan admin cloister stop              # Stop the watchdog (running agents continue)
pan admin cloister freeze            # Globally pause the Deacon — patrols fire but skip all actions
pan admin cloister unfreeze          # Resume the Deacon from a global pause
pan admin cloister brake [--json]    # Trim running WORK agents down to the concurrency cap (idle-first, resumable)
pan admin cloister emergency-stop    # Kill ALL agents immediately — destructive
```

Stopping the watchdog does NOT stop running work agents — they continue in
their tmux sessions. It only suspends the post-completion automation (verification
gate, review/test/ship handoff). Restart with `pan admin cloister start` to
re-engage automation.

`freeze`/`unfreeze` are distinct from `start`/`stop`: freeze leaves the patrol
timer running but short-circuits every cycle (no resumes, no review/test/ship
dispatch, no recovery). The flag persists in `app_settings` across restarts and
is read fresh each patrol, so it takes effect on the next tick. Use freeze when
you want the watchdog process alive (status/logs still work) but all automatic
action held — e.g. while landing changes that affect spawn behavior.

## When to use each subcommand

- **`status`** — first stop for diagnosing why a completed agent didn't
  trigger review, or why a workspace seems stalled mid-pipeline.
- **`start`** — after a host reboot, after `stop`, or when `pan status` shows
  no watchdog process.
- **`stop`** — when debugging the watchdog itself, or when you want to make
  manual lifecycle interventions without the daemon racing you.
- **`freeze`** — hold ALL automatic action (resumes + review/test/ship dispatch +
  recovery) while keeping the watchdog process alive. The go-to when you're
  changing spawn/concurrency behavior and don't want the deacon acting mid-change.
- **`unfreeze`** — resume normal patrols after a `freeze`. Auto-resume and
  dispatch are bounded by the concurrency governor (`cloister.concurrency`).
- **`brake`** — the *measured* alternative to `emergency-stop`. Stops only work
  agents **above** the configured concurrency cap (`cloister.concurrency.max_work_agents`),
  idle ones first, leaving them resumable so the deacon re-admits them as slots
  free. Use when the running count has drifted over the cap (forced `pan start`s,
  an unfreeze backlog) and you want to drain back to the limit without killing
  in-flight work. Non-destructive to source/git; review/test/ship are untouched.
- **`emergency-stop`** — last resort. Kills every running agent (work, review,
  test, ship, planning). Workspaces and branches survive but tmux sessions
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
