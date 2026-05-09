---
name: pan-status
description: "pan status — show running agents overview and system health"
triggers:
  - panopticon status
  - check agents
  - show running agents
  - pan status
  - what's running
allowed-tools:
  - Bash
  - Read
---

# Panopticon Status Overview

## Lead with the pipeline-status table

**Before running any of the steps below**, surface the cross-room visual board
from the `pipeline-status` skill. That table — one row per in-flight PAN
issue, one column per workflow phase, with checkmark/X cells — is the
headline. Everything in this document is the appendix to it.

```
Invoke first: pipeline-status
Then: continue with the system/health detail below
```

If the user wants only the visual table ("status snapshot", "where are we",
"status board"), stop after `pipeline-status` and don't run the rest. If they
want full system detail or asked specifically for "pan status" / "system
health" / "what's running", run `pipeline-status` first as a header and then
continue with the detailed sections below.

## Overview

This skill guides you through checking the status of all Panopticon components, including running agents, workspaces, services, and system health.

## When to Use

- User wants to see what agents are running
- User wants to check system health
- User needs to monitor workspace status
- User asks "what's happening?" or "what's running?"
- Regular health checks and monitoring

## Basic Usage

```bash
# Check all running agents (shorthand for work status)
pan status

# Full agent status with details
pan status

# Verbose output with resource usage
pan status --verbose

# Check system health
pan doctor

# List all workspaces
pan workspace list
```

## What Status Shows

### Agent Status

```bash
pan status
# or
pan status
```

**Output includes:**
- Agent ID (issue ID)
- Status (running, idle, crashed, completed)
- Uptime (how long agent has been running)
- Workspace path
- tmux session name
- Recent activity

**Example output:**
```
Running Agents (3):

PAN-3: Feature - Add user authentication
  Status: running
  Uptime: 2h 15m
  Workspace: ~/panopticon/workspaces/feature-pan-3
  Session: agent-PAN-3
  Activity: Writing tests (2 minutes ago)

PAN-5: Bug - Fix login redirect
  Status: idle
  Uptime: 45m
  Workspace: ~/panopticon/workspaces/bug-pan-5
  Session: agent-PAN-5
  Activity: Waiting for user input (10 minutes ago)

PAN-7: Refactor - Simplify API layer
  Status: running
  Uptime: 3h 30m
  Workspace: ~/panopticon/workspaces/refactor-pan-7
  Session: agent-PAN-7
  Activity: Running tests (just now)
```

### Workspace Status

```bash
pan workspace list
```

**Output includes:**
- Workspace ID
- Issue title
- Created date
- Status (active, idle, stopped)
- Running containers
- Disk usage

**Example output:**
```
Workspaces (5):

feature-pan-3: Add user authentication
  Created: 2024-01-15 10:30
  Status: active
  Containers: 3 running (app, db, redis)
  Disk: 1.2 GB
  Agent: running

bug-pan-5: Fix login redirect
  Created: 2024-01-15 14:00
  Status: active
  Containers: 2 running (app, db)
  Disk: 850 MB
  Agent: idle

feature-pan-7: Simplify API layer
  Created: 2024-01-14 09:15
  Status: active
  Containers: 2 running (app, db)
  Disk: 1.1 GB
  Agent: running
```

### System Health

```bash
pan doctor
```

**Output includes:**
- Node.js version
- Docker status
- tmux availability
- Git version
- Required dependencies
- Configuration status
- Dashboard status
- Tracker connectivity

**Example output:**
```
Panopticon System Health

✓ Node.js v18.17.0
✓ Docker 24.0.5 (running)
✓ Docker Compose v2.20.2
✓ tmux 3.3a
✓ Git 2.40.1
✓ Configuration file exists (~/.panopticon.env)
✓ Linear API connected
✓ Dashboard running (http://localhost:3001)
✓ API server running (http://localhost:3002)

Status: All systems operational
```

## Detailed Status Checks

### Check Specific Agent

```bash
# Show detailed status for one agent
pan status PAN-3

# Attach to agent's tmux session (Ctrl+b d to detach)
tmux attach -t agent-PAN-3

# View agent's recent output
tmux capture-pane -t agent-PAN-3 -p | tail -20
```

### Check Service Status

```bash
# Check if dashboard is running
curl http://localhost:3001

# Check if API is running
curl http://localhost:3002/api/health

# Check Traefik status (if enabled)
docker ps | grep traefik

# Check workspace containers
docker ps | grep panopticon
```

### Check Resource Usage

```bash
# Verbose status with CPU/memory
pan status --verbose

# Check Docker resources
docker stats

# Check disk usage
df -h ~/panopticon/workspaces/

# Check memory usage
free -h
```

## Status Interpretation

### Agent States

| State | Meaning | Action |
|-------|---------|--------|
| **running** | Agent actively working | Normal - no action needed |
| **idle** | Agent waiting for input/task | May need message or new task |
| **completed** | Agent finished work | Review with `pan review pending` |
| **crashed** | Agent encountered error | Check logs, use `pan recover` |
| **blocked** | Agent stuck or waiting | Send message with `pan tell` |

### Workspace States

| State | Meaning | Action |
|-------|---------|--------|
| **active** | Workspace in use, containers running | Normal - no action needed |
| **idle** | Workspace exists but no agent | May want to destroy or spawn agent |
| **stopped** | Containers stopped | Restart with `pan start` |
| **error** | Workspace in error state | Check Docker, may need to destroy |

### Service States

| Service | Healthy | Unhealthy | Check |
|---------|---------|-----------|-------|
| Dashboard | Accessible at :3001 | Connection refused | `pan up`, check logs |
| API | Returns 200 from /health | Connection refused | `pan up`, check logs |
| Traefik | `docker ps` shows running | Not found | Check config, `pan up` |
| Docker | `docker ps` works | Command fails | Start Docker daemon |

## Monitoring Workflows

### Quick Health Check

```bash
# One-liner to check everything
pan status && pan doctor
```

### Continuous Monitoring

```bash
# Watch agent status (updates every 2 seconds)
watch -n 2 pan status

# Monitor specific agent output
watch -n 2 "tmux capture-pane -t agent-PAN-3 -p | tail -10"

# Monitor Docker containers
watch -n 2 docker ps
```

### Dashboard Monitoring

Visit http://localhost:3001 for real-time visual monitoring:
- See all agents in one view
- Watch terminal output live
- Check resource usage graphs
- View activity timeline

## Troubleshooting Status Issues

### No agents showing

**Problem:** `pan status` shows no running agents, but you created them

**Solutions:**
```bash
# Check tmux sessions directly
tmux list-sessions

# Look for agent sessions
tmux list-sessions | grep agent

# If sessions exist but not showing, check:
cat ~/.panopticon/agents/*.json

# Restart status tracking
pan down && pan up
```

### Agent shows as crashed

**Problem:** `pan status` shows agent in crashed state

**Solutions:**
```bash
# Check agent logs
cat ~/.panopticon/logs/agent-<id>.log

# Try to recover
pan recover <id>

# Attach to session to see error
tmux attach -t agent-<id>

# If unrecoverable, kill and restart
pan kill <id>
pan start <id>
```

### Workspace shows wrong status

**Problem:** Workspace status doesn't match reality

**Solutions:**
```bash
# Check Docker containers directly
docker ps -a | grep <workspace-id>

# Refresh workspace status
pan workspace list --refresh

# Manually check workspace directory
ls ~/panopticon/workspaces/<workspace-id>/
```

### `pan doctor` shows errors

**Problem:** Health check reports issues

**Solutions:**

**Node.js version too old:**
```bash
nvm install 18
nvm use 18
```

**Docker not running:**
```bash
sudo systemctl start docker  # Linux
# Or start Docker Desktop (macOS/Windows)
```

**Dashboard not accessible:**
```bash
pan up
lsof -i :3001  # Check if port is in use
```

**Tracker not connected:**
```bash
# Check API key in config
cat ~/.panopticon.env | grep API_KEY

# Test connection manually
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"{ viewer { name } }"}'
```

## Status Scripts

### Custom Status Dashboard

```bash
#!/bin/bash
# ~/scripts/pan-dashboard.sh

clear
echo "=== Panopticon Status Dashboard ==="
echo ""

echo "Services:"
pan doctor | grep "✓\|✗"
echo ""

echo "Agents:"
pan status
echo ""

echo "Workspaces:"
pan workspace list
echo ""

echo "Resources:"
echo "Memory: $(free -h | grep Mem | awk '{print $3 "/" $2}')"
echo "Disk: $(df -h ~/panopticon/workspaces/ | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}')"
```

Run with:
```bash
chmod +x ~/scripts/pan-dashboard.sh
watch -n 5 ~/scripts/pan-dashboard.sh
```

### Alert on Agent Crash

```bash
#!/bin/bash
# ~/scripts/agent-monitor.sh

while true; do
  if pan status | grep -q "crashed"; then
    echo "Alert: Agent crashed!" | mail -s "Panopticon Alert" user@example.com
    # Or use desktop notification
    notify-send "Panopticon Alert" "An agent has crashed"
  fi
  sleep 60
done
```

## Status Checklist

Regular health check checklist:

- [ ] Run `pan status` - check all agents are in expected state
- [ ] Run `pan doctor` - verify system health
- [ ] Check dashboard at http://localhost:3001
- [ ] Review `pan review pending` for completed work
- [ ] Check disk usage: `df -h ~/panopticon/workspaces/`
- [ ] Review logs for errors: `grep ERROR ~/.panopticon/logs/*.log`
- [ ] Check Docker containers: `docker ps`
- [ ] Monitor resource usage: `docker stats` or `htop`

## Performance Indicators

### Healthy System

- All agents in "running" or "idle" state
- No crashed agents
- Dashboard accessible and responsive
- `pan doctor` shows all green checkmarks
- Docker containers running without restarts
- Low CPU/memory usage (<80%)
- Adequate disk space (>10GB free)

### Needs Attention

- 1+ agents crashed
- High resource usage (>90%)
- Low disk space (<5GB)
- Frequent container restarts
- Dashboard slow or unresponsive
- Tracker connection failures

### Critical Issues

- All agents crashed
- Disk full
- Docker daemon not running
- Dashboard unreachable
- Unable to create new workspaces

## Next Steps

Based on status:

**If everything looks good:**
- Continue working
- Create new workspaces as needed
- Monitor periodically

**If agents are idle:**
- Send new tasks: `pan tell <id> "Next task..."`
- Approve completed work: `pan approve <id>`

**If agents crashed:**
- Use `/session-health` skill
- Try `pan recover <id>`
- Check logs and fix issues

**If resources are low:**
- Clean up old workspaces: `pan workspace destroy <id>`
- Run `docker system prune`
- Archive completed work

## Related Skills

- `/pan-help` - Command reference
- `/pan-up` / `/pan-down` - Service management
- `/session-health` - Fix crashed agents
- `/pan-issue` - Create new workspaces
- `/pan-approve` - Review completed work

## More Information

- Dashboard: http://localhost:3001
- Run `pan status --help` for more options
- Run `pan doctor` for system health
- Use `pan status --verbose` for detailed info
