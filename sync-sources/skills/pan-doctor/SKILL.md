---
name: pan-doctor
description: "pan doctor [options] — check Overdeck system health, dependencies, and configuration"
triggers:
  - pan doctor
  - system health
  - health check
  - overdeck status
  - check overdeck
allowed-tools:
  - Bash
  - Read
---

# System Health Check

## Overview

This skill guides you through checking the health of your Overdeck installation, including configuration, dependencies, and running services.

## When to Use

- After initial installation
- Troubleshooting agent issues
- Before starting a new work session
- Verifying configuration changes
- Periodic maintenance

## Quick Command

```bash
pan doctor
```

## Health Check Workflow

### 1. Run Diagnostics

```bash
# Full health check
pan doctor

# Expected output:
# ✓ Configuration file exists
# ✓ Linear API key configured
# ✓ GitHub token configured
# ✓ Skills directory exists
# ✓ tmux available
# ✓ Docker available
# ⚠ orphan-proposed-specs: proposed vBRIEF specs without work agents, grouped by project with remediation hints
```

### 2. Check Configuration

```bash
# View current config
cat ~/.overdeck.env

# Required settings:
# LINEAR_API_KEY=lin_api_xxx
# GITHUB_TOKEN=ghp_xxx (optional but recommended)
# WORKSPACE_ROOT=/path/to/workspaces
```

### 3. Check Running Services

```bash
# Dashboard status
curl -s http://localhost:3011/api/health || echo "Dashboard not running"

# Running agents
tmux list-sessions | grep agent

# Docker containers
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(traefik|overdeck)"
```

### 4. Check Skills

```bash
# List installed skills
pan skills

# Verify skills are synced
ls -la ~/.claude/skills/ | head -20
```

### 5. Check Dependencies

```bash
# Node.js version (18+ required)
node --version

# npm version
npm --version

# tmux version
tmux -V

# Docker version
docker --version

# Git version
git --version
```

## Health Checklist

| Component | Check Command | Expected |
|-----------|---------------|----------|
| Config | `cat ~/.overdeck.env` | File exists with keys |
| Node.js | `node --version` | v18+ |
| tmux | `tmux -V` | Any version |
| Docker | `docker info` | Running |
| Skills | `ls ~/.overdeck/skills/` | Skills present |
| Symlinks | `ls -la ~/.claude/skills/` | Symlinks to overdeck |
| Linear | `pan doctor` | API key valid |

## Component Status

### Dashboard

```bash
# Start dashboard
cd ~/.overdeck/dashboard && npm run dev

# Check health endpoint
curl http://localhost:3011/api/health

# View dashboard
open http://localhost:3010
```

### Traefik (if using)

```bash
# Check traefik
docker ps | grep traefik

# Traefik dashboard
curl -k https://traefik.pan.localhost:8080/api/overview
```

### Agents

```bash
# List all agents
tmux list-sessions -F "#{session_name}" | grep "^agent-"

# Check agent health
for session in $(tmux list-sessions -F "#{session_name}" | grep "^agent-"); do
  echo "=== $session ==="
  tmux capture-pane -t $session -p | tail -5
done
```

## Common Issues

### Configuration Missing

```bash
# Create config file
pan init

# Or manually
cat > ~/.overdeck.env << 'EOF'
LINEAR_API_KEY=your_key_here
GITHUB_TOKEN=your_token_here
WORKSPACE_ROOT=/home/user/workspaces
EOF
```

### Skills Not Synced

```bash
# Re-sync skills
pan sync

# Force overwrite
pan sync --force
```

### Dashboard Won't Start

```bash
# Check port in use
lsof -i :3010
lsof -i :3011

# Kill conflicting processes
kill $(lsof -t -i:3010)
kill $(lsof -t -i:3011)

# Restart
cd ~/.overdeck/dashboard && npm run dev
```

### tmux Issues

```bash
# Kill stuck server
tmux kill-server

# Fresh start
tmux new-session -d -s test
tmux kill-session -t test
```

## Maintenance Tasks

### Update Overdeck

```bash
npm update -g overdeck
pan init  # Re-copy bundled skills
pan sync  # Re-sync to AI tools
```

### Clean Up Old Workspaces

```bash
# List workspaces
ls -la $WORKSPACE_ROOT/

# Remove completed ones
rm -rf $WORKSPACE_ROOT/old-issue/
```

### Reset Configuration

```bash
# Backup and reset
cp ~/.overdeck.env ~/.overdeck.env.backup
pan init
```

## Related Skills

- `/pan:diagnose` - Deep troubleshooting
- `/pan:install` - Initial setup
- `/pan:sync` - Skill synchronization
