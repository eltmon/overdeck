---
name: pan-logs
audience: operator
description: View and analyze agent and system logs
triggers:
  - pan logs
  - agent logs
  - view logs
  - check logs
  - log analysis
allowed-tools:
  - Bash
  - Read
  - Grep
---

# View Logs

## Overview

This skill guides you through viewing, filtering, and analyzing logs from agents, the dashboard, and system components.

## When to Use

- Debugging agent behavior
- Troubleshooting errors
- Monitoring system activity
- Auditing agent actions
- Post-mortem analysis

## Quick Commands

```bash
# View agent output
tmux capture-pane -t agent-ISSUE-123 -p | tail -100

# View dashboard logs
cat ~/.panopticon/logs/dashboard.log

# View all recent activity
pan logs
```

## Agent Logs

### Live Output

```bash
# Watch agent in real-time (Ctrl+b d to detach)
tmux attach -t agent-ISSUE-123

# Or stream output without attaching
while true; do
  tmux capture-pane -t agent-ISSUE-123 -p | tail -1
  sleep 1
done
```

### Capture Full Session

```bash
# Capture entire scrollback buffer
tmux capture-pane -t agent-ISSUE-123 -p -S - > agent-full-output.txt

# Capture with timestamps (requires configuration)
tmux capture-pane -t agent-ISSUE-123 -p -e > agent-output-with-escapes.txt
```

### Search Agent Output

```bash
# Search for errors
tmux capture-pane -t agent-ISSUE-123 -p -S - | grep -i error

# Search for tool calls
tmux capture-pane -t agent-ISSUE-123 -p -S - | grep -E "(Read|Write|Edit|Bash)"

# Search for specific patterns
tmux capture-pane -t agent-ISSUE-123 -p -S - | grep "TODO"
```

### Multiple Agents

```bash
# Capture all agents
for session in $(tmux list-sessions -F "#{session_name}" | grep "^agent-"); do
  echo "=== $session ===" > logs/${session}.txt
  tmux capture-pane -t $session -p -S - >> logs/${session}.txt
done
```

## Dashboard Logs

### Server Logs

```bash
# If running in foreground, logs go to stdout
# If running as background process:
cat ~/.panopticon/logs/server.log

# Tail live
tail -f ~/.panopticon/logs/server.log
```

### API Requests

```bash
# Filter API calls
grep "POST\|GET\|PUT\|DELETE" ~/.panopticon/logs/server.log

# Filter by endpoint
grep "/api/agents" ~/.panopticon/logs/server.log
```

## System Logs

### Panopticon Commands

```bash
# Command history (if configured)
cat ~/.panopticon/logs/commands.log

# Or check shell history
history | grep "pan "
```

### Docker Logs (if using)

```bash
# Traefik logs
docker logs traefik --tail 100

# All container logs
docker compose logs --tail 50
```

## Log Levels

When viewing logs, look for:

| Level | Indicates |
|-------|-----------|
| ERROR | Something failed, needs attention |
| WARN | Potential issues, may need monitoring |
| INFO | Normal operations |
| DEBUG | Detailed diagnostic info |

## Log Analysis

### Count Errors

```bash
# Count errors per agent
for session in $(tmux list-sessions -F "#{session_name}" | grep "^agent-"); do
  count=$(tmux capture-pane -t $session -p -S - | grep -ci error)
  echo "$session: $count errors"
done
```

### Timeline of Actions

```bash
# If logs have timestamps, extract timeline
grep -E "^\[.*\]" agent-output.txt | head -50
```

### Tool Usage Analysis

```bash
# Count tool calls by type
tmux capture-pane -t agent-ISSUE-123 -p -S - | \
  grep -oE "(Read|Write|Edit|Bash|Grep|Glob)" | \
  sort | uniq -c | sort -rn
```

## Log Retention

### Save Important Logs

```bash
# Create log archive for an issue
mkdir -p ~/.panopticon/archives/ISSUE-123
tmux capture-pane -t agent-ISSUE-123 -p -S - > ~/.panopticon/archives/ISSUE-123/agent.log
cp workspace/.planning/STATE.md ~/.panopticon/archives/ISSUE-123/
git -C workspace log --oneline -20 > ~/.panopticon/archives/ISSUE-123/commits.log
```

### Clean Old Logs

```bash
# Remove logs older than 7 days
find ~/.panopticon/logs -type f -mtime +7 -delete

# Archive and compress old logs
tar -czf logs-archive-$(date +%Y%m%d).tar.gz ~/.panopticon/logs/*.log
```

## Configuring Log Output

### Enable tmux Logging

Add to `~/.tmux.conf`:
```
# Automatic logging
set -g history-limit 50000
```

### Dashboard Logging

In dashboard config:
```javascript
// Enable verbose logging
LOG_LEVEL=debug
LOG_FILE=~/.panopticon/logs/dashboard.log
```

## Troubleshooting

### No Output from Agent

```bash
# Check if session exists
tmux has-session -t agent-ISSUE-123

# Try capturing with different parameters
tmux capture-pane -t agent-ISSUE-123 -p -J

# Check if there's a specific window/pane
tmux list-panes -t agent-ISSUE-123
```

### Logs Too Large

```bash
# Truncate log file
> ~/.panopticon/logs/server.log

# Rotate logs
mv server.log server.log.1
```

### Missing Timestamps

```bash
# Add timestamps when capturing
tmux capture-pane -t agent-ISSUE-123 -p -S - | \
  while IFS= read -r line; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line"
  done
```

## Related Skills

- `/pan:diagnose` - Troubleshooting
- `/pan:health` - System health check
- `/pan:status` - Agent status
