---
name: pan-admin-cloister
description: "pan admin cloister <cmd> — lifecycle watchdog: status, restart, pause, resume"
triggers:
  - pan admin cloister
  - cloister status
  - watchdog
  - lifecycle watchdog
allowed-tools:
  - Bash
---

# pan admin cloister

Run the command now:

```bash
pan admin cloister <subcommand>
```

## Usage

```
pan admin cloister status          # Show watchdog state
pan admin cloister restart         # Restart the watchdog
pan admin cloister pause <id>      # Pause monitoring for an issue
pan admin cloister resume <id>     # Resume monitoring
```

## What It Does

Manages the Cloister lifecycle watchdog — the daemon that monitors running agents,
handles verification gates after completion, and triggers review/test/merge pipelines.

## When to Use

- Diagnosing why a completed agent didn't trigger review
- Restarting the watchdog after a crash
- Temporarily pausing automation for an issue while debugging

## See Also

- `pan admin specialists <cmd>` — manage review/test/merge agents
- `pan recover <id>` — recover a crashed work agent
- `pan show <id> --health` — agent health and heartbeat
