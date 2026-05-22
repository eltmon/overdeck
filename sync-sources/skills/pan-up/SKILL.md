---
name: pan-up
description: "pan up — start the Panopticon dashboard (Node 22, port 3010)"
triggers:
  - start panopticon
  - start dashboard
  - pan up
  - launch panopticon
allowed-tools:
  - Bash
  - Read
---

# Start Panopticon Services

## Overview

This skill guides you through starting all Panopticon services, including the dashboard, API server, and optionally Traefik for local domain routing.

## When to Use

- User wants to start Panopticon dashboard
- User wants to launch services after reboot
- User needs to restart services after configuration changes
- User asks "how do I start panopticon?"

## What Gets Started

When you run `pan up`, the following services start:

1. **Dashboard Frontend** (port 3001)
   - React-based UI for monitoring agents
   - Kanban board with issues
   - Real-time terminal output viewer
   - Agent control interface

2. **API Server** (port 3002)
   - Express.js backend
   - WebSocket for real-time updates
   - REST API for agent management
   - Issue tracker integration

3. **Traefik** (optional, if enabled)
   - Reverse proxy for local domains
   - Routes `feature-123.localhost` to workspace containers
   - Automatic HTTPS with self-signed certs
   - Service discovery

## Basic Usage

```bash
# Start all services
pan up

# Start in foreground (see logs)
pan up

# Start without Traefik
pan up --skip-traefik

# Start on custom ports
DASHBOARD_PORT=4001 API_PORT=4002 pan up
```

## Step-by-Step Workflow

### Step 1: Verify Prerequisites

Before starting services, ensure Panopticon is installed:

```bash
# Check if pan command exists
which pan

# Check system health
pan doctor
```

### Step 2: Check Current Status

See if services are already running:

```bash
# Check for running services
pan status

# Check specific ports
lsof -i :3001  # Dashboard
lsof -i :3002  # API
```

If services are already running, you may need to stop them first:
```bash
pan down
```

### Step 3: Start Services

```bash
pan up
```

**What happens:**
1. Checks if ports 3001/3002 are available
2. Builds dashboard if needed
3. Starts API server in background
4. Starts dashboard frontend in background
5. Starts Traefik (if enabled in config)
6. Prints service URLs

**Expected output:**
```
✓ API server started on port 3002
✓ Dashboard started on port 3001
✓ Traefik started (if enabled)

Dashboard: http://localhost:3001
API: http://localhost:3002

Use 'pan status' to check running agents
Use 'pan down' to stop services
```

### Step 4: Verify Services

```bash
# Check all services are running
pan status

# Test dashboard is accessible
curl http://localhost:3001

# Test API is accessible
curl http://localhost:3002/api/health
```

Visit the dashboard in your browser:
```
http://localhost:3001
```

### Step 5: Check Logs (if issues)

If services don't start properly:

```bash
# View dashboard logs
cat ~/.panopticon/logs/dashboard.log

# View API logs
cat ~/.panopticon/logs/api.log

# View Traefik logs (if enabled)
cat ~/.panopticon/logs/traefik.log

# Or run in foreground to see real-time logs
pan up
```

## Configuration Options

Edit `~/.panopticon.env` to customize service startup:

```env
# Dashboard port (default: 3001)
DASHBOARD_PORT=3001

# API server port (default: 3002)
API_PORT=3002

# Auto-start dashboard on pan up
AUTO_START_DASHBOARD=true

# Enable Traefik
TRAEFIK_ENABLED=true

# Traefik port (default: 80)
TRAEFIK_PORT=80

# Traefik HTTPS port (default: 443)
TRAEFIK_HTTPS_PORT=443
```

## Advanced Usage

### Start in Development Mode

```bash
# Start with hot reload for development
cd ~/panopticon-cli/src/dashboard
npm run dev
```

This starts both frontend and backend in dev mode with auto-reload.

### Start Specific Services

```bash
# Start only dashboard (no API)
cd ~/panopticon-cli/src/dashboard/frontend
npm start

# Start only API (no dashboard)
cd ~/panopticon-cli/src/dashboard/server
npm start

# Start only Traefik
docker-compose -f ~/.panopticon/traefik/docker-compose.yml up -d
```

### Custom Ports

```bash
# Use environment variables
DASHBOARD_PORT=4001 API_PORT=4002 pan up

# Or edit ~/.panopticon.env permanently
echo "DASHBOARD_PORT=4001" >> ~/.panopticon.env
echo "API_PORT=4002" >> ~/.panopticon.env
pan up
```

## Troubleshooting

### Port already in use

**Problem:** Error: `EADDRINUSE: address already in use :::3001`

**Solutions:**
```bash
# Find what's using the port
lsof -i :3001
lsof -i :3002

# Kill the conflicting process
kill -9 <PID>

# Or use different ports
DASHBOARD_PORT=4001 API_PORT=4002 pan up
```

### Services start but dashboard unreachable

**Problem:** `pan up` succeeds but http://localhost:3001 doesn't load

**Solutions:**
```bash
# Check if frontend built correctly
ls ~/panopticon-cli/src/dashboard/frontend/build/

# Rebuild if missing
cd ~/panopticon-cli/src/dashboard/frontend
npm run build

# Check firewall isn't blocking
sudo ufw allow 3001
sudo ufw allow 3002

# Try accessing API directly
curl http://localhost:3002/api/health
```

### Traefik won't start

**Problem:** Traefik fails to start or conflicts with ports 80/443

**Solutions:**
```bash
# Check what's using port 80/443
sudo lsof -i :80
sudo lsof -i :443

# Stop conflicting service (e.g., Apache, nginx)
sudo systemctl stop apache2
sudo systemctl stop nginx

# Or disable Traefik
echo "TRAEFIK_ENABLED=false" >> ~/.panopticon.env
pan up

# Or use custom ports
TRAEFIK_PORT=8080 TRAEFIK_HTTPS_PORT=8443 pan up
```

### Dashboard shows blank page

**Problem:** Dashboard loads but shows white screen

**Solutions:**
```bash
# Check browser console for errors
# (F12 → Console tab)

# Verify API is reachable
curl http://localhost:3002/api/health

# Check CORS settings
cat ~/.panopticon.env | grep CORS

# Rebuild frontend
cd ~/panopticon-cli/src/dashboard/frontend
rm -rf build node_modules
npm install
npm run build

# Restart services
pan down
pan up
```

### Services don't stay running

**Problem:** Services start but stop immediately

**Solutions:**
```bash
# Run in foreground to see errors
pan up

# Check logs
cat ~/.panopticon/logs/dashboard.log
cat ~/.panopticon/logs/api.log

# Verify Node.js version
node --version  # Should be v18+

# Reinstall dependencies
cd ~/panopticon-cli/src/dashboard
npm install
npm run build
```

## Process Management

### Check Running Processes

```bash
# Using pan
pan status

# Using ps
ps aux | grep panopticon

# Using lsof
lsof -i :3001
lsof -i :3002
```

### Background vs Foreground

```bash
# Foreground (default) - see logs in real time
pan up

# Detached background mode
pan up --detach

# Ctrl+C stops foreground services
```

## Auto-Start on Boot

### Using systemd (Linux)

Create `/etc/systemd/system/panopticon.service`:

```ini
[Unit]
Description=Panopticon Dashboard
After=network.target docker.service

[Service]
Type=simple
User=youruser
ExecStart=/usr/local/bin/pan up
ExecStop=/usr/local/bin/pan down
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable panopticon
sudo systemctl start panopticon
```

### Using launchd (macOS)

Create `~/Library/LaunchAgents/com.panopticon.dashboard.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.panopticon.dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/pan</string>
        <string>up</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

Load:
```bash
launchctl load ~/Library/LaunchAgents/com.panopticon.dashboard.plist
```

## Health Checks

After starting services, verify health:

```bash
# Overall health check
pan doctor

# Check specific endpoints
curl http://localhost:3001/  # Should return HTML
curl http://localhost:3002/api/health  # Should return {"status":"ok"}

# Check WebSocket connection
# Visit http://localhost:3001 and check browser console for "WebSocket connected"
```

## Next Steps

After services are running:

1. **Access dashboard**: http://localhost:3001
2. **Check agent status**: `pan status`
3. **List issues**: `pan issues`
4. **Create workspace**: `pan start <id>`
5. **Monitor in dashboard**: Click on agent in UI

## Related Skills

- `/pan-down` - Stop services
- `/pan-status` - Check running agents and services
- `/pan-quickstart` - Complete setup workflow
- `/pan-help` - Command reference
- `/pan-network` - Configure Traefik and local domains

## More Information

- Dashboard URL: http://localhost:3001
- API URL: http://localhost:3002
- Logs: `~/.panopticon/logs/`
- Configuration: `~/.panopticon.env`
- Run `pan up --help` for more options
