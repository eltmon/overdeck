---
name: pan-stop-all-agents
description: "Drain Panopticon: kill every running work agent and its review/test specialists, optionally stop the dashboard, and preserve conversation tmux sessions and shared sidecars."
triggers:
  - stop all agents
  - kill all agents
  - drain panopticon
  - shut down panopticon
  - stop dashboard and kill agents
  - panopticon shutdown
allowed-tools:
  - Bash
  - Read
---

# Drain Panopticon (Stop All Agents)

## Overview

Cleanly stops every running work agent plus its associated review-coordinators and test specialists, and (optionally) the dashboard — without touching conversation tmux sessions (`conv-*`) or shared sidecars (CLIProxy, Traefik, TLDR).

## When to Use

- User says "stop all agents", "kill all agents", "drain panopticon"
- User says "stop dashboard and kill all agents"
- Memory pressure / pre-reboot drain
- Wanting a clean slate without losing chat history

## What Gets Killed vs. Preserved

| Tmux session prefix          | Action      | Why |
| ---------------------------- | ----------- | --- |
| `agent-<issue>`              | **kill**    | Work agents |
| `review-coordinator-*`       | **kill**    | Review pipeline tied to a work agent |
| `specialist-*-test-agent`    | **kill**    | Test specialist tied to a work agent |
| `conv-*`                     | **PRESERVE**| Conversation tmux for `pan.localhost/conv/<id>` — these are user-facing chats, not work runs |
| `panopticon` (server)        | **PRESERVE** unless stopping dashboard |
| CLIProxy, Traefik, TLDR      | **PRESERVE** — shared sidecars |

The dashboard is treated as a separate axis: stop it explicitly only if asked.

## Workflow

### 1. Confirm scope before destroying anything

`pan kill` is destructive. Always print the list and confirm before running unless the
user has already explicitly said "kill all agents".

```bash
# List live tmux sessions, classified
tmux -L panopticon ls 2>/dev/null | awk -F: '{print }' | sort | awk '
  /^agent-/                  { agents[++a] =  }
  /^review-coordinator-/     { reviews[++r] =  }
  /^specialist-/             { specs[++s] =  }
  /^conv-/                   { convs[++c] =  }
  END {
    print "Work agents to kill ("a"):";          for (i=1;i<=a;i++) print "  " agents[i]
    print "Review coordinators to kill ("r"):";  for (i=1;i<=r;i++) print "  " reviews[i]
    print "Test specialists to kill ("s"):";     for (i=1;i<=s;i++) print "  " specs[i]
    print "Conversations to PRESERVE ("c"):";    for (i=1;i<=c;i++) print "  " convs[i]
  }
'
```

Show this list to the user. Wait for confirmation if they have not already pre-authorized.

### 2. Kill work agents via the CLI (preferred)

Use `pan kill <issue-id>` so Cloister updates state cleanly. Derive the issue ID from
the session name: `agent-pan-895` → `pan kill PAN-895`, `agent-min-215` → `pan kill MIN-215`.

```bash
# Loop over agent sessions and kill each via pan
tmux -L panopticon ls 2>/dev/null \
  | awk -F: '/^agent-/ {print }' \
  | sed 's/^agent-//' \
  | tr 'a-z' 'A-Z' \
  | while read id; do
      pan kill "$id" || true
    done
```

If `pan kill` fails (e.g., agent is in a broken state.json), fall back to tmux:

```bash
tmux -L panopticon kill-session -t agent-<issue>
```

…and **fix the broken state.json as a real bug** (do not ignore it — see CLAUDE.md
"No Bandaids"). State files live at `~/.panopticon/agents/<id>/state.json`. The most
common breakage is a doubled trailing `}` from a partial write.

### 3. Kill review coordinators and test specialists

These are spawned per-agent and don't have CLI verbs of their own. Killing the tmux
session is the right move; their lifecycle is fully derived from the work agent.

```bash
for prefix in review-coordinator- specialist-; do
  tmux -L panopticon ls 2>/dev/null \
    | awk -F: -v p="^$prefix" ' { print  }' \
    | while read sess; do
        tmux -L panopticon kill-session -t "$sess" || true
      done
done
```

### 4. Verify only conversations and the server remain

```bash
tmux -L panopticon ls 2>/dev/null | awk -F: '{print }' | sort
# Expect only: conv-* sessions, plus possibly the panopticon control session.
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
curl -sk https://pan.localhost/api/health || echo "dashboard down (expected if stopped)"

# Memory should drop noticeably after killing 5+ work agents
free -h | head -2
```

## Why preserve `conv-*`

`conv-*` tmux sessions back the conversation views at `pan.localhost/conv/<id>`. They
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

- **Killing `conv-*` sessions** — these are chat views, not work agents. Always filter
  to `^agent-`, `^review-coordinator-`, `^specialist-` prefixes.
- **Using `tmux kill-session` instead of `pan kill`** — bypasses Cloister's state
  cleanup. Only fall back to tmux if `pan kill` errors.
- **Calling `pan down` when only "kill agents" was asked** — leave the dashboard up
  unless explicitly told to stop it.
- **Assuming the agent ID matches the session name verbatim** — sessions are lower-case
  (`agent-pan-895`); `pan kill` expects upper-case issue IDs (`PAN-895`).
- **Working around a malformed state.json** — fix the file (and file an issue for the
  writer that produced it). No bandaids.

## Related Skills

- `/pan-kill` — kill a single agent
- `/pan-down` — stop the dashboard only
- `/pan-restart` — restart dashboard, leave sidecars
- `/pan-status` — see what's running before/after
- `/conv-lookup` — read conversation sessions (the things you're preserving)
