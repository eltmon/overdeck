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
pan reset-session PAN-123  # Clear mutable saved-session pointers before a fresh start
pan start PAN-123 --fresh  # Start fresh only when no resumable session remains
pan start PAN-123 --harness codex  # Explicitly use the Codex harness
pan start PAN-123 --model gpt-5.6-sol --swarm off --review-mode full
pan start PAN-123 --review-model gpt-5.6-sol  # Pin the convoy review model
pan start PAN-123 --plan-model k3 --model k3  # Auto-plan AND work on Kimi k3
pan start PAN-123 --remote --tier durable  # Remote Fly.io workspace with persistent volume
pan start PAN-123 --remote --tier ephemeral  # Remote Fly.io workspace that winds down on stale heartbeat
```

## What It Does

`pan start <id>` is the single paved-road entry point: it takes an issue from whatever
state it is in to running work.

- **No plan exists** — `pan start` auto-plans (non-interactive), materializes xBRIEF tasks, and
  starts the work agent when planning finalizes.
- **Plan exists** — `pan start` creates the workspace if needed and spawns the work agent
  from the existing xBRIEF and xBRIEF tasks.
- **Already running** — `pan start` exits 0 with a no-op message naming `pan tell <id>` for
  messaging and the tmux attach command.
- **Swarm active** — the bare parent agent is the foreman. `pan start` attaches to or restores that foreman instead of refusing because slot agents exist; it never creates a competing serial parent.

Planning depth is controlled by `--plan`:

```bash
pan start PAN-1071 --plan interactive   # Q&A planning first, then work
pan start PAN-1071 --plan auto          # non-interactive planning, then work (default)
pan start PAN-1071 --plan skip          # synthesize a minimal xBRIEF and xBRIEF tasks, then work
```

The default planning mode comes from `planning.default_mode` in `~/.overdeck/config.yaml`;
the shipped default is `auto`. The legacy `--auto` flag is deprecated and is now an alias
for `--plan skip`.

Start-time policy flags are persisted on the issue before planning or work begins. `--model`
sets the durable work-model override used by later respawns, `--swarm` accepts `off`, `auto`,
or `always`, `--review-mode` accepts `quick`, `full`, or `none`, and `--review-model` pins the
model used by the review convoy. Omitted flags leave existing and inherited policy untouched.
Swarm mode controls automatic foreman creation, not Deacon slot dispatch. `off` keeps serial work,
while `auto` and `always` allow a readiness-eligible foreman loop.
When this start also kicks off planning (no plan exists yet), `--plan-model <model>` overrides
the planning agent's model for that session only — it is a one-shot override, not persisted
policy, and it never changes the work agent's model (`--model`).

If an agent is paused, `pan start <id>` refuses to spawn until you run `pan unpause <id>`.
Use `--force` only when you intentionally want to clear that pause gate and start anyway.

For projects with workspace Docker configured, `pan start` checks stack health before
spawning. Use `--host` only as an explicit break-glass override; interactive shells always
prompt, while non-interactive callers must pass `--yes` to confirm.

If a stopped agent has a saved Claude session, `pan start` refuses and points you to
`pan resume <id>` (continue that session) or `pan reset-session <id>` (clear mutable
session pointers before a new start). `--fresh` runs the lifecycle guard before it wipes
local agent state, so a refused command leaves the state directory intact. Append-only
durable session records are not abandoned by either command; if one still makes the
session resumable, resume it rather than deleting or inventing durable-plane markers.

## Slow or hanging workspace prep

Workspace preparation bounds its slow external phases with these default budgets:

| Phase | Budget | Timeout behavior |
| --- | ---: | --- |
| `state-reconcile` | 60s | Fail fast |
| `sync-main` | 240s | Warn and continue to spawn |
| `tracker-context` | 60s | Warn, use empty tracker context, and continue to spawn |
| `spawn` | 600s | Fail fast |

Ora spinner text updates render only on a TTY, so non-interactive callers receive plain
progress lines and a heartbeat every 15 seconds while a phase is still running:

```text
[prep] still running: sync-main (45s elapsed)
```

A fail-fast timeout exits with the step name and budget. A degraded timeout warns and keeps
preparation moving toward agent spawn. Supervisors that invoke `pan start` non-interactively
should allow an outer budget of at least 300 seconds under load; RUN-35 completed after earlier
120-second and 200-second supervisors timed out while workspace preparation was still making progress.

## When to Use

- Starting work on a new issue
- Launching an agent after planning is complete

## See Also

- `pan plan <id>` — create an execution plan before starting
- `pan show <id>` — inspect agent state while it works
- `pan tell <id>` — send a message to the running agent
- `pan done <id>` — signal the agent has completed its work
