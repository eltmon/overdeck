---
name: pan-admin-hooks
audience: operator
description: "pan admin hooks install — install Claude Code heartbeat hooks for agent health monitoring"
triggers:
  - pan admin hooks
  - install hooks
  - setup hooks
  - heartbeat hooks
allowed-tools:
  - Bash
---

# pan admin hooks install

Run the command now:

```bash
pan admin hooks install
```

## What It Does

Installs Claude Code hooks into your `.claude/` configuration that emit heartbeat events
while agents are running. The Panopticon dashboard uses these heartbeats to track agent
health and detect stuck or crashed agents.

## When to Use

- First-time setup of a new development machine
- After reinstalling Claude Code
- If the dashboard shows agents as "unresponsive" that are actually running

## See Also

- `pan doctor` — verify hooks are installed and system is healthy
- `pan admin config <subcommand>` — manage other configuration
