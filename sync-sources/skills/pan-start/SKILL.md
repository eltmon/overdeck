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
pan start PAN-123 --model gpt-5.6-sol --swarm off --review-mode full
pan start PAN-123 --review-model gpt-5.6-sol  # Pin the convoy review model
pan start PAN-123 --remote --tier durable  # Remote Fly.io workspace with persistent volume
pan start PAN-123 --remote --tier ephemeral  # Remote Fly.io workspace that winds down on stale heartbeat
```

## What It Does

`pan start <id>` is the single paved-road entry point: it takes an issue from whatever
state it is in to running work.

- **No plan exists** — `pan start` auto-plans (non-interactive), materializes vBRIEF tasks, and
  starts the work agent when planning finalizes.
- **Plan exists** — `pan start` creates the workspace if needed and spawns the work agent
  from the existing vBRIEF and vBRIEF tasks.
- **Already running** — `pan start` exits 0 with a no-op message naming `pan tell <id>` for
  messaging and the tmux attach command.

Planning depth is controlled by `--plan`:

```bash
pan start PAN-1071 --plan interactive   # Q&A planning first, then work
pan start PAN-1071 --plan auto          # non-interactive planning, then work (default)
pan start PAN-1071 --plan skip          # synthesize a minimal vBRIEF and vBRIEF tasks, then work
```

The default planning mode comes from `planning.default_mode` in `~/.overdeck/config.yaml`;
the shipped default is `auto`. The legacy `--auto` flag is deprecated and is now an alias
for `--plan skip`.

Start-time policy flags are persisted on the issue before planning or work begins. `--model`
sets the durable work-model override used by later respawns, `--swarm` accepts `off`, `auto`,
or `always`, `--review-mode` accepts `quick`, `full`, or `none`, and `--review-model` pins the
model used by the review convoy. Omitted flags leave existing and inherited policy untouched.

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
