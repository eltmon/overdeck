---
name: pan-down
audience: operator
description: "pan down — stop the Panopticon dashboard and services"
triggers:
  - stop panopticon
  - shutdown dashboard
  - pan down
  - stop services
allowed-tools:
  - Bash
  - Read
---

# Stop Panopticon Services

## Overview

This skill guides you through gracefully stopping all Panopticon services, including the dashboard, API server, Traefik, and optionally workspace containers.

## When to Use

- User wants to stop Panopticon services
- User needs to free up ports 3001/3002
- User wants to restart services (stop then start)
- System is shutting down or rebooting
- User asks "how do I stop panopticon?"

## What Gets Stopped

When you run `pan down`, the following services stop:

1. **Dashboard Frontend** (port 3001)
2. **API Server** (port 3002)
3. **Traefik** (if enabled)
4. **Workspace Containers** (optional)

## Basic Usage

```bash
# Stop all Panopticon services
pan down

# Stop services and workspace containers
pan down --all

# Stop services but keep Traefik running
pan down --no-traefik

# Force stop (kill processes)
pan down --force
```

## Step-by-Step Workflow

### Step 1: Check What's Running

Before stopping, see what's currently running:

```bash
# Check Panopticon status
pan status

# Check running agents
pan status

# Check dashboard and API processes
ps aux | grep panopticon
lsof -i :3001
lsof -i :3002
```

### Step 2: Save Any Pending Work

If agents are running, consider what to do with them:

```bash
# Check for agents
pan status

# Option 1: Let them finish
# Wait for agents to complete their work

# Option 2: Send message to agents
pan tell <id> "Saving work before shutdown"

# Option 3: Stop agents explicitly
pan kill <id>
```

### Step 3: Stop Services

```bash
pan down
```

**What happens:**
1. Gracefully stops API server
2. Gracefully stops dashboard frontend
3. Stops Traefik (if enabled)
4. Removes PID files
5. Cleans up log handles

**Expected output:**
```
✓ Stopping API server (PID 12345)
✓ Stopping dashboard (PID 12346)
✓ Stopping Traefik (if enabled)
✓ Services stopped successfully

Use 'pan up' to restart services
```

### Step 4: Verify Services Stopped

```bash
# Check nothing is listening on ports
lsof -i :3001  # Should return nothing
lsof -i :3002  # Should return nothing

# Verify pan status shows no services
pan status
```

## Configuration Options

Edit `~/.panopticon.env` to customize shutdown behavior:

```env
# Graceful shutdown timeout (seconds)
SHUTDOWN_TIMEOUT=30

# Stop workspace containers on pan down
STOP_WORKSPACES_ON_DOWN=false

# Keep Traefik running even when dashboard stops
KEEP_TRAEFIK_RUNNING=false
```

## Advanced Usage

### Stop Specific Services

```bash
# Stop only dashboard (keep API running)
# (No built-in command, use process management)
ps aux | grep "dashboard" | grep -v grep
kill <PID>

# Stop only API (keep dashboard running)
ps aux | grep "api-server" | grep -v grep
kill <PID>

# Stop only Traefik
docker-compose -f ~/.panopticon/traefik/docker-compose.yml down
```

### Stop and Clean Up Workspaces

```bash
# Stop services and all workspace containers
pan down --all

# Manually stop workspace containers
pan workspace list
pan workspace destroy <id>

# Nuclear option: stop all Docker containers
docker stop $(docker ps -q)
```

### Force Stop

If services won't stop gracefully:

```bash
# Force kill all processes
pan down --force

# Or manually force kill
pkill -9 -f panopticon
pkill -9 -f "dashboard"
pkill -9 -f "api-server"
```

## Troubleshooting

### Services won't stop

**Problem:** `pan down` completes but processes still running

**Solutions:**
```bash
# Check for orphaned processes
ps aux | grep panopticon | grep -v grep

# Force kill by PID
kill -9 <PID>

# Or kill all Node.js processes (careful!)
pkill -9 node

# Check for stuck Docker containers
docker ps
docker stop $(docker ps -q)
```

### Ports still in use after shutdown

**Problem:** `lsof -i :3001` still shows process after `pan down`

**Solutions:**
```bash
# Find what's using the port
lsof -i :3001

# Kill the specific process
kill -9 <PID>

# Check for zombie processes
ps aux | grep "<defunct>"

# Restart Docker if containers are stuck
sudo systemctl restart docker  # Linux
# Or restart Docker Desktop (macOS/Windows)
```

### Can't stop Traefik

**Problem:** Traefik container won't stop

**Solutions:**
```bash
# Check Traefik status
docker ps | grep traefik

# Stop Traefik directly
docker stop traefik

# Or use Docker Compose
cd ~/.panopticon/traefik/
docker-compose down

# Force remove if stuck
docker rm -f traefik
```

### Agent sessions remain after shutdown

**Problem:** tmux sessions still exist after `pan down`

**Solutions:**
```bash
# List tmux sessions
tmux list-sessions

# Kill specific agent session
tmux kill-session -t agent-<id>

# Kill all agent sessions
tmux list-sessions | grep agent | cut -d: -f1 | xargs -n1 tmux kill-session -t

# Or kill tmux server entirely
tmux kill-server
```

### PID file exists but process doesn't

**Problem:** `pan up` fails saying services already running, but they're not

**Solutions:**
```bash
# Remove stale PID files
rm ~/.panopticon/pids/*.pid

# Clean up lock files
rm ~/.panopticon/locks/*.lock

# Try starting again
pan up
```

## Restart Workflow

To restart services:

```bash
# Method 1: Separate commands
pan down
sleep 2  # Give services time to fully stop
pan up

# Method 2: Restart command (if available)
pan restart

# Method 3: Force restart
pan down --force && pan up
```

## Graceful vs Forceful Shutdown

### Graceful Shutdown (default)

```bash
pan down
```

**What happens:**
- Sends SIGTERM to processes
- Waits for graceful shutdown (up to SHUTDOWN_TIMEOUT)
- Allows agents to save state
- Flushes logs to disk
- Closes database connections cleanly

**When to use:** Normal shutdown, routine maintenance

### Forceful Shutdown

```bash
pan down --force
```

**What happens:**
- Sends SIGKILL to processes
- Immediately terminates all processes
- No cleanup or state saving
- May leave orphaned resources

**When to use:** Services hung, emergency shutdown, debugging

## Cleanup After Shutdown

After stopping services, you may want to clean up:

```bash
# Clean up log files
rm ~/.panopticon/logs/*.log

# Clean up temporary files
rm -rf ~/.panopticon/tmp/*

# Clean up old workspaces (careful!)
pan workspace list
pan workspace destroy <id>

# Clean up Docker resources
docker system prune -f
```

## Monitoring Shutdown

Watch shutdown progress:

```bash
# Monitor in one terminal
watch -n 1 'lsof -i :3001; lsof -i :3002'

# Run shutdown in another terminal
pan down
```

## Auto-Shutdown

### On System Shutdown (systemd)

If using systemd service, it will stop automatically on shutdown.

### Manual Triggers

```bash
# Stop on user logout
# Add to ~/.bash_logout or ~/.zsh_logout
pan down

# Stop after idle timeout (using systemd timer)
# Create /etc/systemd/system/panopticon-idle.timer
```

## Recovery After Ungraceful Shutdown

If services were killed ungracefully (power loss, crash):

```bash
# Clean up stale resources
rm ~/.panopticon/pids/*.pid
rm ~/.panopticon/locks/*.lock

# Check for orphaned Docker containers
docker ps -a | grep panopticon
docker rm -f <container-id>

# Clean up tmux sessions
tmux kill-server

# Restart services
pan up

# Check health
pan doctor
```

## Safe Shutdown Checklist

Before shutting down:

- [ ] Check for running agents: `pan status`
- [ ] Save any pending work
- [ ] Stop or notify agents: `pan tell <id> "Shutting down"`
- [ ] Run graceful shutdown: `pan down`
- [ ] Verify ports are free: `lsof -i :3001 :3002`
- [ ] Check no orphaned processes: `ps aux | grep panopticon`
- [ ] Verify tmux sessions stopped: `tmux list-sessions`

## Next Steps

After stopping services:

- **Restart**: Use `pan up` to start again
- **Configuration**: Edit `~/.panopticon.env` while services are down
- **Updates**: Run `pan update` to update Panopticon
- **Cleanup**: Clean up logs and old workspaces

## Related Skills

- `/pan-up` - Start services
- `/pan-status` - Check running services and agents
- `/pan-help` - Command reference
- `/session-health` - Clean up stuck sessions

## More Information

- Configuration: `~/.panopticon.env`
- Logs: `~/.panopticon/logs/`
- PID files: `~/.panopticon/pids/`
- Run `pan down --help` for more options
