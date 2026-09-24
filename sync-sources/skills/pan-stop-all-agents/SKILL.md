---
name: pan-stop-all-agents
description: "Drain Overdeck: kill every running work agent and its review/test specialists on the host terminal backend (Herdr or tmux), optionally stop the dashboard, and preserve conversations and shared sidecars."
triggers:
  - stop all agents
  - kill all agents
  - drain overdeck
  - shut down overdeck
  - stop dashboard and kill agents
  - overdeck shutdown
allowed-tools:
  - Bash
  - Read
---

# Drain Overdeck (Stop All Agents)

## Overview

Cleanly stops every running work agent plus its review and test specialists, and (optionally) the dashboard — without touching conversations (`conv-*`) or shared sidecars (CLIProxy, Traefik, TLDR).

## When to Use

- User says "stop all agents", "kill all agents", "drain overdeck"
- User says "stop dashboard and kill all agents"
- Memory pressure / pre-reboot drain
- Wanting a clean slate without losing chat history

## What Gets Killed vs. Preserved

| What                                              | Action       | Why |
| ------------------------------------------------- | ------------ | --- |
| Work agents (`agent-<issue>`, swarm slots)        | **kill**     | Work runs |
| Review/test specialists (`agent-<issue>-review`, `agent-<issue>-test`, …) | **kill** | Tied to the work agent; `pan kill <issue>` stops them with it |
| Planning (`planning-<issue>`) and strike (`strike-<issue>`) agents | **kill** | Same issue-scoped runs |
| Conversations (`conv-*`)                          | **PRESERVE** | Chats behind `overdeck.localhost/conv/<id>`, not work runs |
| Dashboard                                         | **PRESERVE** unless stopping it |
| CLIProxy, Traefik, TLDR                           | **PRESERVE** | Shared sidecars |

Agents run on the host's terminal backend: Herdr by default, tmux only under
`terminal.backend: tmux`. List them with `GET /api/agents`, which reads that
backend, and stop them with `pan kill`, which closes the pane on either one.
Never list or kill agents with `tmux -L overdeck`: on a Herdr host it sees none
of them. Conversations still run on tmux until PAN-3921.

The dashboard is treated as a separate axis: stop it explicitly only if asked.

## Workflow

### 1. Confirm scope before destroying anything

`pan kill` is destructive. Always print the list and confirm before running unless the
user has already explicitly said "kill all agents".

```bash
# Live agents (a live pane on the host backend), grouped by issue
curl -s http://localhost:3011/api/agents | jq -r '
  [.[] | select(.hasLiveTmuxSession == true) | select(.id | startswith("conv-") | not)]
  | group_by(.issueId)[]
  | "\(.[0].issueId): \([.[].id] | join(", "))"'
```

`/api/agents` also lists agents stopped within the last hour; the
`hasLiveTmuxSession` filter (true for a live pane on either backend) drops them.

Show this list to the user. Wait for confirmation if they have not already pre-authorized.

### 2. Kill every live agent's issue via the CLI

`pan kill <issue-id>` stops every agent of that issue (work, planning,
review/test specialists, strike, swarm slots), writes its state, sweeps orphan
launchers and tears down its Docker stack.

```bash
curl -s http://localhost:3011/api/agents \
  | jq -r '.[] | select(.hasLiveTmuxSession == true) | select(.id | startswith("conv-") | not) | .issueId' \
  | sort -u \
  | while read -r issue; do
      pan kill "$issue" --force || echo "pan kill $issue FAILED"
    done
```

If `pan kill` fails for an issue, retry with the one agent id
(`pan kill agent-pan-895-review --force`). If it still fails (e.g. a broken
state.json), close the pane on the backend that hosts it, as a last resort:

```bash
# Herdr host: the pane carrying the agent id in its agentId token
herdr pane list
herdr pane close <pane-id>

# tmux host, or a pre-Herdr agent still on tmux
tmux -L overdeck kill-session -t agent-<issue>
```

…and **fix the broken state.json as a real bug** (do not ignore it — see CLAUDE.md
"No Bandaids"). State files live at `~/.overdeck/agents/<id>/state.json`. The most
common breakage is a doubled trailing `}` from a partial write.

### 3. Verify no agent is alive

```bash
# pan status probes each agent live (Herdr or tmux); /api/agents caches for ~5s
pan status --json | jq -r '.[] | select(.alive) | select(.id | startswith("conv-") | not) | .id'
# Expect no output. Conversations stay up.
```

### 4. Verify conversations survived

```bash
curl -s http://localhost:3011/api/conversations | jq -r '.[] | select(.status == "active") | .tmuxSession'
```

### 5. (Optional) Stop the dashboard

Only if the user asked to stop the dashboard. Use `pan down`, NOT `kill -9`.

```bash
pan down
```

Sidecars (CLIProxy, Traefik, TLDR) are intentionally left running — `pan down` only
takes the dashboard down. If the user wants a full teardown including sidecars,
they should ask explicitly; do not assume.

### 6. Verify

```bash
# Dashboard health (should fail if stopped, succeed if left up)
curl -sk https://overdeck.localhost/api/health || echo "dashboard down (expected if stopped)"

# Memory should drop noticeably after killing 5+ work agents
free -h | head -2
```

## Why preserve `conv-*`

`conv-*` tmux sessions back the conversation views at `overdeck.localhost/conv/<id>`. They
are durable chat history, not work runs — the JSONL session files are sacred (see
CLAUDE.md). Killing a `conv-*` session loses the live attach point even if the JSONL
survives, and there is rarely a reason to do so during a "stop all agents" drain.

If a `conv-*` session genuinely needs to go (e.g. it's wedged), the user must ask for
that specific session by name.

## Why preserve sidecars

CLIProxy, Traefik, and TLDR are shared infrastructure. Other tools and agents on the
machine depend on them (CLIProxy bridges ChatGPT subscription auth; Traefik routes all
`*.localhost`; TLDR serves code summaries). `pan restart`'s default behavior already
encodes this: dashboard restarts, sidecars are left alone. Mirror that here.

## Common Mistakes

- **Killing `conv-*` sessions** — these are chat views, not work agents. Drive the drain
  from `/api/agents`, which lists agents only, and drop any `conv-` id.
- **Listing agents with `tmux -L overdeck ls`** — on a Herdr host (the default) it finds
  no agents, so the drain silently does nothing.
- **Using `tmux kill-session` or `herdr pane close` instead of `pan kill`** — bypasses
  Cloister's state write, the orphan-launcher sweep and the Docker teardown. Only close a
  pane by hand if `pan kill` errors.
- **Calling `pan down` when only "kill agents" was asked** — leave the dashboard up
  unless explicitly told to stop it.
- **Passing an agent id where an issue id is meant** — `pan kill PAN-895` stops every
  agent of the issue; `pan kill agent-pan-895` stops only that one agent. The loop above
  uses the `issueId` field from `/api/agents`.
- **Working around a malformed state.json** — fix the file (and file an issue for the
  writer that produced it). No bandaids.

## Related Skills

- `/pan-kill` — kill a single agent
- `/pan-down` — stop the dashboard only
- `/pan-restart` — restart dashboard, leave sidecars
- `/pan-status` — see what's running before/after
- `/conv-lookup` — read conversation sessions (the things you're preserving)
