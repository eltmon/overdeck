---
name: pan-close
audience: operator
description: "pan close <id> — close-out ceremony for a completed and merged issue"
triggers:
  - pan close
  - close issue
  - close out
  - finalize issue
allowed-tools:
  - Bash
---

# pan close

Run the command now:

```bash
pan close <issue-id>
```

## What It Does

Runs the close-out ceremony after a successful merge: cleans up the workspace, removes
the feature branch, archives agent state, and marks the issue as done in the tracker.
Lighter than `pan wipe` — preserves history and does not force-delete.

## When to Use

- After `pan approve` has merged the PR and you want to clean up
- Completing the lifecycle for a finished issue

## See Also

- `pan approve <id>` — approve and merge (run this first)
- `pan wipe <id>` — forceful cleanup including branches (for abandoned work)
