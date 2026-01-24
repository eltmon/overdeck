---
name: pan-diagnose
description: Troubleshoot common Panopticon issues
triggers:
  - pan diagnose
  - troubleshoot panopticon
  - debug panopticon
  - panopticon not working
  - fix panopticon
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Troubleshooting Guide

## Overview

This skill helps diagnose and fix common issues with Panopticon installation, configuration, and operation.

## Issue Categories

1. [Installation Issues](#installation-issues)
2. [Configuration Issues](#configuration-issues)
3. [Agent Issues](#agent-issues)
4. [Dashboard Issues](#dashboard-issues)
5. [Skill Issues](#skill-issues)
6. [Network Issues](#network-issues)

---

## Installation Issues

### "pan: command not found"

```bash
# Check if installed
npm list -g panopticon

# Install globally
npm install -g panopticon

# Or use npx
npx panopticon doctor

# Check PATH
echo $PATH | tr ':' '\n' | grep npm
```

### "Cannot find module" errors

```bash
# Reinstall dependencies
npm install -g panopticon --force

# Clear npm cache if needed
npm cache clean --force
npm install -g panopticon
```

### Node.js version issues

```bash
# Check version
node --version

# Need Node 18+
# Use nvm to switch
nvm install 18
nvm use 18
```

---

## Configuration Issues

### "LINEAR_API_KEY not found"

```bash
# Check config file exists
cat ~/.panopticon.env

# Create/update config
echo "LINEAR_API_KEY=lin_api_xxx" >> ~/.panopticon.env

# Verify
grep LINEAR_API_KEY ~/.panopticon.env
```

### "Invalid Linear API key"

```bash
# Test the key
curl -H "Authorization: lin_api_xxx" \
  https://api.linear.app/graphql \
  -d '{"query": "{ viewer { id } }"}'

# Get a new key from: Linear > Settings > API > Personal API Keys
```

### "GitHub token invalid"

```bash
# Test the token
curl -H "Authorization: token ghp_xxx" \
  https://api.github.com/user

# Create new token: GitHub > Settings > Developer settings > Personal access tokens
# Required scopes: repo, read:org
```

### Config file permissions

```bash
# Fix permissions (should be readable only by owner)
chmod 600 ~/.panopticon.env
```

---

## Agent Issues

### Agent won't start

```bash
# Check tmux is available
which tmux
tmux -V

# Try starting manually
tmux new-session -d -s test-agent "echo 'test'; sleep 5"
tmux capture-pane -t test-agent -p
tmux kill-session -t test-agent

# Check for existing session
tmux list-sessions | grep agent-ISSUE
```

### Agent is stuck

```bash
# Check what it's doing
tmux capture-pane -t agent-ISSUE-123 -p | tail -50

# Look for:
# - API rate limits
# - Waiting for user input
# - Long-running commands
# - Error messages

# Try sending a message (ALWAYS use pan work tell, NOT raw tmux)
pan work tell ISSUE-123 "What is your current status?"
```

**WARNING:** DO NOT use raw `tmux send-keys` - agents often forget the Enter key. Always use `pan work tell` which handles this correctly.

### Agent crashed

```bash
# Check if session exists
tmux has-session -t agent-ISSUE-123 2>/dev/null && echo "Running" || echo "Not running"

# If dead, check workspace for clues
cd /path/to/workspaces/ISSUE-123
cat .planning/STATE.md

# Resume with new agent
pan work issue ISSUE-123
```

### Multiple agents for same issue

```bash
# List all
tmux list-sessions | grep ISSUE-123

# Kill duplicates
tmux kill-session -t agent-ISSUE-123-old
```

---

## Dashboard Issues

### Dashboard won't start

```bash
# Check port availability
lsof -i :3010  # Frontend
lsof -i :3011  # Backend API

# Kill processes using ports
kill $(lsof -t -i:3010) 2>/dev/null
kill $(lsof -t -i:3011) 2>/dev/null

# Start fresh
cd ~/.panopticon/dashboard
npm run dev
```

### "CORS error" in browser

```bash
# Check API is running
curl http://localhost:3011/api/health

# Check frontend is pointing to correct API
# Should be http://localhost:3011

# Try different browser or incognito mode
```

### Dashboard shows stale data

```bash
# Restart the API server
pkill -f "node.*dashboard.*server"
cd ~/.panopticon/dashboard/server && npm run dev

# Hard refresh browser
# Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
```

### WebSocket not connecting

```bash
# Check server logs
cd ~/.panopticon/dashboard/server
npm run dev 2>&1 | grep -i websocket

# Check firewall
sudo ufw status
```

---

## Skill Issues

### Skills not showing up

```bash
# Check sync status
pan skills

# Re-sync
pan sync --force

# Verify symlinks
ls -la ~/.claude/skills/ | grep panopticon

# Check Claude Code recognizes them
# Restart Claude Code after syncing
```

### "Skill already exists"

```bash
# Check what's there
ls -la ~/.claude/skills/skill-name

# If it's a project skill, symlink won't be created (by design)
# If you want to override, remove the project skill first
```

### Skill not triggering

```bash
# Check trigger patterns in SKILL.md
cat ~/.panopticon/skills/skill-name/SKILL.md | head -20

# Ensure you're using exact trigger phrases
# Try: /skill-name instead of natural language
```

---

## Network Issues

### Can't reach Linear API

```bash
# Test connectivity
curl -v https://api.linear.app/graphql

# Check DNS
nslookup api.linear.app

# Check proxy settings
echo $HTTP_PROXY $HTTPS_PROXY
```

### Traefik not routing

```bash
# Check Traefik is running
docker ps | grep traefik

# Check Traefik logs
docker logs traefik

# Verify DNS resolution
ping myapp.pan.localhost

# Check /etc/hosts
grep pan.localhost /etc/hosts
```

### WSL2 networking

```bash
# Get WSL2 IP
hostname -I

# Check Windows can reach WSL2
# From Windows: ping <wsl-ip>

# Port forwarding (from Windows PowerShell as Admin)
netsh interface portproxy show all
```

---

## Collecting Diagnostics

For bug reports, collect:

```bash
# System info
echo "=== System ===" > diagnostics.txt
uname -a >> diagnostics.txt
node --version >> diagnostics.txt
npm --version >> diagnostics.txt

# Config (redact secrets!)
echo "=== Config ===" >> diagnostics.txt
cat ~/.panopticon.env | sed 's/=.*/=REDACTED/' >> diagnostics.txt

# Status
echo "=== Doctor ===" >> diagnostics.txt
pan doctor >> diagnostics.txt 2>&1

# tmux
echo "=== tmux ===" >> diagnostics.txt
tmux list-sessions >> diagnostics.txt 2>&1

# Skills
echo "=== Skills ===" >> diagnostics.txt
ls -la ~/.panopticon/skills/ >> diagnostics.txt
ls -la ~/.claude/skills/ >> diagnostics.txt

cat diagnostics.txt
```

## Related Skills

- `/pan:health` - Quick health check
- `/pan:install` - Reinstallation
- `/pan:setup` - Configuration
