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
pan start PAN-123 --force  # Clear a paused agent gate and start anyway
pan start PAN-123 --host   # Break-glass: bypass workspace Docker stack-health gate
pan start PAN-123 --fresh  # Drop the saved session and start a new one (e.g. switch model)
pan start PAN-123 --harness codex  # Explicitly use the Codex harness
```

## What It Does

Creates a git worktree at `workspaces/feature-<id>/`, installs dependencies, then spawns
an autonomous Claude Code agent in a tmux session (`agent-<id>`). The agent loads the
issue spec, creates a plan, and begins implementation.

If an agent is paused, `pan start <id>` refuses to spawn until you run `pan unpause <id>`.
Use `--force` only when you intentionally want to clear that pause gate and start anyway.

For projects with workspace Docker configured, `pan start` checks stack health before
spawning. Use `--host` only as an explicit break-glass override; interactive shells always
prompt, while non-interactive callers must pass `--yes` to confirm.

If a stopped agent has a saved Claude session, `pan start` refuses and points you to
`pan resume <id>` (continue that session). Use `--fresh` to deliberately discard the
saved session and start a brand-new one — for example, to relaunch a stopped agent on a
different model, where the existing session can't resume under different provider routing.
`--fresh` is non-destructive: it clears only the resume pointer, never the JSONL transcript,
and refuses while the agent is still running (stop it first with `pan kill <id>`).

## When to Use

- Starting work on a new issue
- Launching an agent after planning is complete

## See Also

- `pan plan <id>` — create an execution plan before starting
- `pan show <id>` — inspect agent state while it works
- `pan tell <id>` — send a message to the running agent
- `pan done <id>` — signal the agent has completed its work
