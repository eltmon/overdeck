---
name: pan-tell
description: Send a message to a running agent
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
- Know the agent's session name (usually `agent-ISSUE-ID`)

## Quick Command

```bash
# ALWAYS use pan work tell - it handles Enter correctly
pan work tell ISSUE-123 "Your message here"
```

**DO NOT use raw `tmux send-keys`** - agents frequently forget the separate Enter command, causing messages to sit unsent in the terminal.

## Why pan work tell?

1. **Automatically sends Enter** - No forgotten second command
2. **Properly escapes quotes** - Handles special characters
3. **Saves to mail queue** - Backup if agent misses the message
4. **Validates session exists** - Fails fast if agent not running

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
pan work tell ISSUE-123 "Please focus on the login bug first, then the signup flow."
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
pan work tell ISSUE-123 "Additional context: The user table has a unique constraint on email. Make sure to handle duplicates."
```

### Report Errors

```bash
pan work tell ISSUE-123 "Error from testing: TypeError: Cannot read property 'id' of undefined at line 45 in UserService.ts"
```

### Change Priorities

```bash
pan work tell ISSUE-123 "Pause current work. Priority change: Fix the production bug first, then return to this feature."
```

### Request Status Update

```bash
pan work tell ISSUE-123 "Please update STATE.md with your current progress and any blockers."
```

### Provide Approval/Feedback

```bash
pan work tell ISSUE-123 "Looks good! Please commit your changes and update the issue status."
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
pan work status
```

**Message not received:**
```bash
# If you used raw tmux, the Enter was probably forgotten
# Always use pan work tell instead:
pan work tell ISSUE-123 "Your message here"

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
