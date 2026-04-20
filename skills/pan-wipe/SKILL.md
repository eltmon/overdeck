---
audience: operator
name: pan-wipe
description: "pan wipe <id> — destructive reset to Todo: remove workspace, branches, and agent state"
triggers:
  - pan wipe
  - wipe issue
  - deep wipe
  - destroy workspace
allowed-tools:
  - Bash
---
audience: operator

# pan wipe

**DESTRUCTIVE — irreversible.** Confirm with the user before running.

```bash
pan wipe <issue-id>
```

## What It Does

Performs the canonical destructive reset-to-Todo for an issue:
- Kills all tmux sessions for the issue
- Removes the workspace directory (`workspaces/feature-<id>/`)
- Removes agent state (`~/.panopticon/agents/<id>/`)
- Deletes local and remote feature branches
- Resets issue status in the tracker to Todo

## When to Use

- Abandoning a workspace that has gone completely off the rails
- Cleaning up completed/stale workspaces that were never closed
- Starting completely fresh on an issue

## Warning

This cannot be undone. If you want to restart an agent while keeping the workspace,
use `pan kill <id>` and then `pan start <id>` instead.

## See Also

- `pan kill <id>` — stop agent, keep workspace
- `pan close <id>` — close-out ceremony after successful merge
