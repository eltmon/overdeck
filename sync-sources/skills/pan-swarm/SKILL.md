---
name: pan-swarm
description: "pan swarm <id> — dispatch parallel work agents across a vBRIEF plan using dependency-wave scheduling. Slot agents are registered to the issue and visible in the dashboard."
triggers:
  - pan swarm
  - swarm
  - dispatch a swarm
  - run a swarm
  - parallel work agents
allowed-tools:
  - Bash
  - Read
---

# pan swarm

`pan swarm <id>` spawns parallel work agents ("slots") across the items of an
issue's vBRIEF plan, scheduled by the plan's dependency DAG (`plan.edges`).
A wave is the set of items whose dependencies are all met; slots within a wave
run concurrently.

## Slot agents are issue-tied and dashboard-visible

Every slot `pan swarm` spawns is registered with Panopticon — a
`~/.panopticon/agents/agent-<id>-<N>/state.json` carrying `issueId`, a tmux
session on the `panopticon` socket, and a swarm-runtime entry. The dashboard's
resource-discovery service nests them under the issue automatically, with
openable terminals. This is the default — nothing extra is required.

Agents spawned via Claude Code's `Agent`/subagent tool are NOT registered and
stay invisible — never use that tool for work. See the `work-agents-via-pan`
rule.

## Prerequisite

The issue must be planned first — `pan plan <id>` (or `pan plan <id> --auto`)
produces the vBRIEF + beads. `pan swarm` reads the promoted spec.

## Options

| Flag | Purpose |
| --- | --- |
| `--dry-run` | Print the wave plan; spawn nothing. Always run this first. |
| `--wave <n>` | Dispatch only wave N. |
| `--auto-advance` | Dispatch, and advance to the next wave when the current one completes. |
| `--no-auto-advance` | Disable automatic next-wave dispatching. |
| `--model <model>` | Override the slot model. Default: config `roles.work.model`. |
| `--max-slots <n>` | Cap concurrent agents. |
| `--host` | Bypass the workspace docker stack-health gate; spawn on the host. |
| `--yes` | Confirm `--host` in non-interactive contexts. |
| `--task <op>` | vBRIEF task op: `next` \| `show` \| `claim` \| `done` \| `block` \| `unblock` \| `cancel`. |
| `--item <id>` | vBRIEF item ID for `show`/`claim`/`done`/`block`. |
| `--reason <text>` | Reason for a task status mutation. |
| `--sequence <n>` | Expected `plan.sequence` for CAS-protected task mutations. |

Sub-command: `pan swarm recover <issueId> <slotId> --action <retry|drop|handoff> [--yes]`
— recover a failed-merge slot.

## Operating loop

A swarm advances wave-by-wave. Each slot does its item, runs gates, opens a PR
against the feature branch, then idles. To carry it through:

1. **Dry-run** — `pan swarm <id> --dry-run` to review the wave structure.
2. **Dispatch** — `pan swarm <id> --auto-advance`.
3. **Monitor** — watch slot PRs against `feature/<id>` and the workspace
   `statusOverrides` in `workspaces/feature-<id>/.pan/continue.json` (the
   authoritative item-status source; the main-repo spec stays all-`pending`).
4. **Merge slot PRs** — when a batch's PRs are open and `CLEAN`, merge them into
   the feature branch. The deacon's `detectMergedSwarmSlots` patrol then flips
   the items done and advances.
5. **Re-dispatch** if the swarm does not pick up the next batch on its own:
   `pan swarm <id> --auto-advance` again.

The final `feature/<id>` → `main` PR is always a human merge.

## Known caveats — PAN-1336 (operator handles these by hand until it lands)

- **No slot-PR auto-merge.** `--auto-advance` only advances after slot PRs are
  *merged*; nothing merges them. Merge them yourself with `gh pr merge`.
- **`graphify-out/` conflicts.** Every slot regenerates the tracked graph
  artifacts, so parallel slots collide there. Resolve with a detached worktree,
  taking either side (it is regenerable):
  `git worktree add --detach /tmp/m origin/feature/<id>`, merge each slot
  branch with `-X theirs`, then `git push origin HEAD:feature/<id>`.
- **Zombie slots.** Finished slots idle without terminating and consume the
  agent cap, shrinking later batches. Retire them with `pan pause <id>-<N>`
  (the deacon honors a pause; `pan kill` gets auto-resumed).

When PAN-1336 lands, steps 4–5 and these caveats become automatic.

## See also

- `/pan-plan` — produce the vBRIEF the swarm consumes
- `/pan-pause` — retire idle slots
- `/pan-status` — running agents overview
