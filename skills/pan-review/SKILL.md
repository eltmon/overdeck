---
name: pan-review
audience: operator
description: "pan review <subcommand> — manage code review lifecycle: pending work, requesting review, resetting cycles"
triggers:
  - pan review
  - review pending
  - request review
  - reset review
  - code review
allowed-tools:
  - Bash
  - Read
---

# pan review

Run the command now:

```bash
pan review <subcommand>
```

## Usage

```
pan review pending              # List completed work awaiting review
pan review request <id>         # Request re-review after fixing feedback
pan review reset <id>           # Reset review/test/merge cycles
pan review reset <id> --session # Also clears saved Claude session
```

## What It Does

Manages the review pipeline for completed agent work. Use `pending` to see what needs
review, `request` to re-trigger review after addressing feedback, and `reset` to clear
the entire review cycle (useful when a review agent is stuck or you need a fresh pass).

## When to Use

- Checking what work is waiting for review
- Re-triggering review after fixing issues raised in a review pass
- Resetting a stuck or failed review pipeline

## See Also

- `pan approve <id>` — approve and merge passing work
- `pan show <id>` — inspect agent state
- `pan done <id>` — signal initial work completion
