---
name: pan-start
audience: operator
description: "pan start <id> — spawn a work agent for an issue in its own tmux session and workspace"
triggers:
  - pan start
  - start working on
  - work on issue
  - spawn agent
  - create workspace
allowed-tools:
  - Bash
  - Read
---

# pan start

Run the command now:

```bash
pan start <issue-id>
```

## Usage

```
pan start PAN-123          # Spawn agent for issue PAN-123
pan start MIN-456          # Works with any tracker prefix
```

## What It Does

Creates a git worktree at `workspaces/feature-<id>/`, installs dependencies, then spawns
an autonomous Claude Code agent in a tmux session (`agent-<id>`). The agent loads the
issue spec, creates a plan, and begins implementation.

## When to Use

- Starting work on a new issue
- Launching an agent after planning is complete

## See Also

- `pan plan <id>` — create an execution plan before starting
- `pan show <id>` — inspect agent state while it works
- `pan tell <id>` — send a message to the running agent
- `pan done <id>` — signal the agent has completed its work
