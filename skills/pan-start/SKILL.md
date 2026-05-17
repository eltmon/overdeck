---
name: pan-start
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
pan start PAN-123 --host   # Break-glass: bypass workspace Docker stack-health gate
```

## What It Does

Creates a git worktree at `workspaces/feature-<id>/`, installs dependencies, then spawns
an autonomous Claude Code agent in a tmux session (`agent-<id>`). The agent loads the
issue spec, creates a plan, and begins implementation.

For projects with workspace Docker configured, `pan start` checks stack health before
spawning. Use `--host` only as an explicit break-glass override; pass `--yes` to confirm
without an interactive prompt.

## When to Use

- Starting work on a new issue
- Launching an agent after planning is complete

## See Also

- `pan plan <id>` — create an execution plan before starting
- `pan show <id>` — inspect agent state while it works
- `pan tell <id>` — send a message to the running agent
- `pan done <id>` — signal the agent has completed its work
