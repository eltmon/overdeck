---
name: pan-admin-tracker
audience: operator
description: "pan admin tracker <cmd> — tracker-specific operations (Linear states, cleanup, sync)"
triggers:
  - pan admin tracker
  - tracker operations
  - linear states
  - setup tracker
allowed-tools:
  - Bash
---

# pan admin tracker

Run the command now:

```bash
pan admin tracker <subcommand>
```

## Usage

```
pan admin tracker linear-states    # List Linear workflow states
pan admin tracker linear-cleanup   # Clean up stale Linear issues
pan admin tracker sync             # Sync issue state from tracker
```

## What It Does

Provides tracker-specific operations for Linear, GitHub Issues, and other connected
issue trackers. Use this for querying tracker state, running cleanup jobs, or debugging
sync issues.

## When to Use

- Checking what workflow states exist in Linear
- Cleaning up orphaned or stale issues
- Debugging tracker sync problems

## See Also

- `pan admin config <cmd>` — tracker connection settings
- `pan issues` — list issues across trackers
