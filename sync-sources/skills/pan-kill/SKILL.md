---
name: pan-kill
description: "pan kill <id> — stop a running agent (workspace and branch preserved)"
triggers:
  - pan kill
  - stop agent
  - kill agent
  - terminate agent
  - abort agent
allowed-tools:
  - Bash
  - Read
---

# Stop Agent

## Overview

`pan kill` (alias `pan stop`) stops an agent and closes its terminal through the host's terminal
backend: `pane.close` on Herdr (the default), `kill-session` on tmux. The workspace, branch, and
xBRIEF are preserved.

Always stop agents with `pan kill`, never with raw `tmux kill-session` or `herdr pane close`. A raw
terminal kill skips the state write, the orphan-launcher sweep, and the Docker teardown; a raw tmux
kill on a Herdr host reaches nothing at all (PAN-3947).

## When to Use

- Agent is stuck or not making progress
- Need to reassign the work
- Agent completed work and should be stopped
- Emergency stop needed
- Freeing up system resources

## Quick Command

```bash
# Every agent of an issue (work, planning, review/test specialists, strike, swarm slots)
pan kill ISSUE-123

# Exactly one agent
pan kill agent-issue-123-test
```

## Workflow

### 1. Check Agent Status First

```bash
pan status
pan show ISSUE-123
```

### 2. Graceful Shutdown (Recommended)

Give the agent a chance to save state:

```bash
# ALWAYS use pan tell, never raw send-keys
pan tell ISSUE-123 "Please commit your progress and stop working."

# Then stop it
pan kill ISSUE-123
```

### 3. Verify Stopped

```bash
pan status
```

The agent must no longer be listed as running. If it still is, see Troubleshooting.

## Pause Instead of Kill

`pan pause ISSUE-123 --reason "<why>"` stops the agent the same way and also sets a persistent
pause gate so nothing restarts it until `pan unpause ISSUE-123`.

## Kill All Agents

Use `/pan-stop-all-agents` — it drains every work agent and its specialists while preserving
conversations and shared sidecars.

## Preserving Work

```bash
# Preserve workspace state (per stash-discipline: agents commit or surface; never stash)
cd /path/to/workspaces/feature-issue-123
git add -A && git commit -m "WIP: state before kill"
```

## After Killing

1. **Resume later** — `pan start ISSUE-123` spawns a new agent
2. **Do it yourself** — work in the existing workspace manually
3. **Abandon** — remove the workspace if the work is no longer needed

## Troubleshooting

**Agent still listed as running after `pan kill`:** the terminal did not close. Find it on the
host's backend:

```bash
# Herdr host: panes carry the agent id in their agentId token
herdr pane list

# tmux host: agents live on the overdeck socket, never the default one
tmux -L overdeck list-sessions | grep ISSUE-123
```

Then run `pan kill <agent-id>` again. Close a pane by hand only if the backend is unreachable from
`pan`, and report it as a bug.

## Related Skills

- `/pan-status` — check agent status
- `/pan-tell` — send a message before killing
- `/pan-pause` — stop and hold an agent
