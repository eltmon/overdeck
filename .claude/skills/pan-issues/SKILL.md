---
name: pan-issues
description: "pan issues — list and triage work across all connected issue trackers"
triggers:
  - pan issues
  - list issues
  - triage issues
  - show issues
  - what issues
allowed-tools:
  - Bash
  - Read
---

# pan issues

Run the command now:

```bash
pan issues
```

## What It Does

Lists open issues across all connected trackers (Linear, GitHub Issues, etc.), showing
status, priority, and which ones have active agents. Useful for deciding what to work on
next or getting a cross-tracker overview.

## When to Use

- Deciding which issue to start next
- Getting an overview of all open work
- Cross-tracker triage

## See Also

- `pan start <id>` — spawn an agent for an issue
- `pan status` — show running agents (not all issues)
- `pan show <id>` — inspect a specific issue's agent state
