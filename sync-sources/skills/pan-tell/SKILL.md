---
name: pan-tell
description: "pan tell <id> <msg> — send a message to a running agent's tmux session"
triggers:
  - pan tell
  - message agent
  - send to agent
  - tell agent
  - agent message
allowed-tools:
  - Bash
  - Read
---

# Send Message to Agent

## Overview

This skill guides you through sending messages to running autonomous agents via their tmux sessions.

## When to Use

- Agent needs additional context or clarification
- You want to redirect the agent's focus
- Providing feedback on work in progress
- Sending error messages for the agent to fix
- Interrupting to change priorities

## Prerequisites

- Agent must be running in a tmux session
- `<id>` accepts an issue ID (`PAN-1148`), a full agent ID (`agent-pan-1148`, `strike-pan-1723`, `conv-20260928-7563`), a conversation (`conv/2972`, `conv:2972`, or a dashboard URL), or a bare number when it is unambiguous

## Quick Command

```bash
# ALWAYS use pan tell - it handles Enter correctly
pan tell ISSUE-123 "Your message here"

# Message a conversation by its dashboard number
pan tell conv/2972 "Your message here"
```

**DO NOT use raw `tmux send-keys`** - agents frequently forget the separate Enter command, causing messages to sit unsent in the terminal.

## Why pan tell?

1. **Automatically sends Enter** - No forgotten second command
2. **Properly escapes quotes** - Handles special characters
3. **Saves to mail queue** - Backup if agent misses the message
4. **Validates session exists** - Fails fast if agent not running
5. **Reaches the main agent** - for Claude Code targets it checks the agent selector and switches input back to the main agent before sending; it refuses (exit 1, message saved to mail) when it cannot confirm the switch.

## Steer a running turn

A plain `pan tell` queues behind a busy agent: Claude Code feeds the message in at the next tool boundary, or after the turn. To change course now, steer:

```bash
pan tell --steer ISSUE-123 "Stop the refactor. Fix the failing login test first."
```

`--steer` types the message and presses Claude Code's send-now chord (Ctrl+X Ctrl+S) instead of Enter. Claude Code interrupts the running turn and sends the message at once; an idle agent just receives it. The dashboard composer does the same with Ctrl+Enter (Cmd+Enter on macOS).

- **Supported:** local Claude Code agents and conversations.
- **Refused (exit 1, nothing sent or mailed):** other harnesses (Codex, Kimi, ACP, OpenCode, Muse, Prime Agent), remote (Fly) agents, and paused, suspended or stopped agents, which have no running turn to interrupt. Drop `--steer` to send a normal message. Steer Pi from the dashboard composer.
- **Old PTY supervisor:** an agent launched before steer support presses Enter instead; `pan tell` prints that the message was delivered as a normal submit.

## Queue until limits reset

When a conversation hit its usage limit, queue the message on the server instead of waiting:

```bash
pan tell --when-limit-resets conv/2972 "Pick up where you left off."
```

The message is stored in the dashboard database and sent by the scheduled-message patrol about a minute after the limit resets (or within a minute when no limit is active). When the reset time is unknown it tries again every 15 minutes.

- **Supported:** Claude Code conversations only. Agents, other harnesses and vault browse copies are refused (exit 1, nothing queued).
- **Refused:** `--steer` with `--when-limit-resets` — a queued message has no running turn to interrupt. `/pan` commands cannot be queued.
- **Check the queue:** `pan conv pending <conv>` lists undelivered queued messages. Edit or cancel them from the conversation timeline in the dashboard.

## A conversation on another machine

To reach a conversation that a linked machine runs, name it `@<machine>/<conv>` (the machine's label or environment id):

```bash
pan tell @desk/conv-20261101-1234 "Rebase on main before you push."
pan tell @desk/conv-20261101-1234 "Rebase on main before you push." --message-id rebase-1
```

The message goes through this machine's dashboard and the machine link (PAN-4650). It prints `Delivered to <conv> on <machine>`, or the owner's error and exits 1. `--message-id <id>` makes a repeat land once (default: a fresh id); on a local target it is the delivery idempotency key. `--steer` works; `--when-limit-resets` and `--force` exit 1 for a remote target. Only conversations are accepted after `@<machine>/` — an agent name exits 1 with "pan tell @<label>/… targets conversations only".

## Workflow

### 1. Find the Agent Session

```bash
# List all agent sessions
tmux list-sessions | grep agent

# Example output:
# agent-MIN-123: 1 windows (created Mon Jan 20 10:00:00 2025)
# agent-MIN-456: 1 windows (created Mon Jan 20 11:00:00 2025)
```

### 2. Check Current Agent Status

```bash
# See what the agent is currently doing
tmux capture-pane -t agent-ISSUE-123 -p | tail -20
```

### 3. Send Your Message

```bash
# Send the message (Enter is sent automatically)
pan tell ISSUE-123 "Please focus on the login bug first, then the signup flow."
```

### 4. Verify Message Was Received

```bash
# Wait a moment, then check
sleep 2
tmux capture-pane -t agent-ISSUE-123 -p | tail -10
```

## Common Message Types

### Provide Additional Context

```bash
pan tell ISSUE-123 "Additional context: The user table has a unique constraint on email. Make sure to handle duplicates."
```

### Report Errors

```bash
pan tell ISSUE-123 "Error from testing: TypeError: Cannot read property 'id' of undefined at line 45 in UserService.ts"
```

### Change Priorities

```bash
pan tell ISSUE-123 "Pause current work. Priority change: Fix the production bug first, then return to this feature."
```

### Request Status Update

```bash
pan tell ISSUE-123 "Please update STATE.md with your current progress and any blockers."
```

### Provide Approval/Feedback

```bash
pan tell ISSUE-123 "Looks good! Please commit your changes and update the issue status."
```

## Tips

1. **Be specific** - Agents work best with clear, actionable instructions
2. **Include error details** - Copy exact error messages when reporting issues
3. **Reference files** - Mention specific file paths when relevant
4. **Check receipt** - Always verify the agent received and responded to your message

## Troubleshooting

**Session not found:**
```bash
# List all sessions to find the correct name
tmux list-sessions

# Check if agent is running
pan status
```

**Message not received:**
```bash
# If you used raw tmux, the Enter was probably forgotten
# Always use pan tell instead:
pan tell ISSUE-123 "Your message here"

# Check the pane
tmux capture-pane -t agent-ISSUE-123 -p | tail -20
```

**Agent not responding:**
```bash
# The agent might be in the middle of a long operation
# Wait and check again, or attach to watch
tmux attach -t agent-ISSUE-123
# Ctrl+b d to detach
```

## Related Skills

- `/pan:status` - Check agent status
- `/pan:kill` - Stop an agent
- `/pan:approve` - Approve and merge agent work
