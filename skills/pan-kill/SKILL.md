---
name: pan-kill
description: Stop a running agent
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

This skill guides you through gracefully stopping a running autonomous agent and cleaning up its resources.

## When to Use

- Agent is stuck or not making progress
- Need to reassign the work
- Agent completed work and should be stopped
- Emergency stop needed
- Freeing up system resources

## Quick Command

```bash
# Using pan CLI
pan work kill ISSUE-123

# Or directly via tmux
tmux kill-session -t agent-ISSUE-123
```

## Workflow

### 1. Check Agent Status First

Before killing, understand what the agent is doing:

```bash
# List running agents
pan work status

# Or via tmux
tmux list-sessions | grep agent

# See recent activity
tmux capture-pane -t agent-ISSUE-123 -p | tail -30
```

### 2. Graceful Shutdown (Recommended)

Give the agent a chance to save state:

```bash
# Send shutdown message (use pan work tell - handles Enter automatically)
pan work tell ISSUE-123 "Please save your progress to STATE.md and stop working."

# Wait for acknowledgment
sleep 10
tmux capture-pane -t agent-ISSUE-123 -p | tail -10

# Then kill the session
tmux kill-session -t agent-ISSUE-123
```

### 3. Immediate Stop (If Needed)

```bash
# Kill immediately
tmux kill-session -t agent-ISSUE-123
```

### 4. Verify Stopped

```bash
# Confirm session is gone
tmux list-sessions | grep agent-ISSUE-123

# Should return nothing
```

### 5. Clean Up (Optional)

```bash
# The workspace remains for inspection
ls -la /path/to/workspaces/ISSUE-123/

# View any uncommitted work
cd /path/to/workspaces/ISSUE-123
git status
git diff
```

## Kill All Agents

```bash
# Kill all agent sessions
tmux list-sessions -F "#{session_name}" | grep "^agent-" | xargs -I {} tmux kill-session -t {}

# Verify all gone
tmux list-sessions | grep agent
```

## Preserving Work

Before killing, you may want to preserve the agent's progress:

```bash
# Attach and review
tmux attach -t agent-ISSUE-123
# Ctrl+b d to detach

# Or capture the full session
tmux capture-pane -t agent-ISSUE-123 -p -S - > agent-output.txt

# Save workspace state
cd /path/to/workspaces/ISSUE-123
git stash  # Save uncommitted changes
```

## After Killing

Options for the work:

1. **Resume later** - Use `pan work issue ISSUE-123` to spawn a new agent
2. **Do it yourself** - Work in the existing workspace manually
3. **Abandon** - Remove the workspace if work is no longer needed

## Troubleshooting

**Session won't die:**
```bash
# Force kill with signal
tmux kill-session -t agent-ISSUE-123

# If that fails, find and kill the process
ps aux | grep "agent-ISSUE-123"
kill -9 <PID>
```

**Multiple agents for same issue:**
```bash
# List all matching sessions
tmux list-sessions | grep ISSUE-123

# Kill each one
tmux kill-session -t agent-ISSUE-123
tmux kill-session -t agent-ISSUE-123-2
```

**Can't find the session:**
```bash
# List ALL tmux sessions
tmux list-sessions

# Check if process is running outside tmux
ps aux | grep claude
```

## Related Skills

- `/pan:status` - Check agent status
- `/pan:tell` - Send message before killing
- `/pan:rescue` - Recover work from killed agents
