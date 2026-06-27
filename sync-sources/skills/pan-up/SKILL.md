---
name: pan-up
description: "pan up — start the Overdeck dashboard (Node 22, port 3011)"
triggers:
  - start overdeck
  - start dashboard
  - pan up
  - launch overdeck
allowed-tools:
  - Bash
  - Read
---

# Start Overdeck Services

## Overview

`pan up` starts the Overdeck dashboard server (and Traefik if enabled). The
server is a single Node 22 process running the pre-built
`dist/dashboard/server.js` — it serves the API, the WebSocket endpoints, and
the built frontend all on **port 3011**. With Traefik enabled, the dashboard
is reachable at `https://pan.localhost`.

Never run the dashboard under Bun or via tsx — see the dashboard-Node22-only
rule. If the dist is stale after server code changes, run `npm run build`
first (or use `/pan-reload`, which builds then restarts).

## When to Use

- User wants to start the Overdeck dashboard
- User wants to launch services after reboot
- User needs to restart services after configuration changes

## What Gets Started

1. **Dashboard server** (port 3011, Node 22, `dist/dashboard/server.js`)
   - REST API (`/api/*`), Effect RPC WebSocket (`/ws/rpc`), terminal
     streaming (`/ws/terminal`)
   - Serves the built React frontend
   - Starts Cloister/Deacon orchestration unless `--no-deacon`
2. **Traefik** (optional, if enabled)
   - Reverse proxy for `https://pan.localhost` and workspace domains
     (`feature-pan-XXX.pan.localhost`)

In **dev mode** (`pan dev`, not `pan up`), the Vite frontend dev server runs
separately on port 3010 and proxies API calls to the server on 3011.

## Basic Usage

```bash
# Start dashboard + Traefik
pan up

# Run in background
pan up --detach

# Skip Traefik startup
pan up --skip-traefik

# Skip Cloister/Deacon auto-start (escape hatch)
pan up --no-deacon

# Disable agent auto-resume for this boot
pan up --no-resume
```

## Desktop App

`pan up` opens the Overdeck Electron desktop app if it is installed in one of
the supported locations. Otherwise it falls back to the default browser.

### Install the desktop app

- **Linux**
  - Download the AppImage and place it at `~/Applications/Overdeck*.AppImage`.
  - Or create a symlink at one of:
    - `~/.local/bin/overdeck`
    - `~/.local/share/applications/overdeck`
    - `/usr/local/bin/overdeck`
    - `/opt/overdeck/overdeck`
- **macOS**
  - Copy `Overdeck.app` to `/Applications` or `~/Applications`.
- **Windows**
  - Install to `%LOCALAPPDATA%\Programs\overdeck\Overdeck.exe`.

When a supported install is found, `pan up` launches the app window. Without an
install, `pan up` opens the dashboard in your default browser.

## Step-by-Step Workflow

### Step 1: Check current status

```bash
pan status          # running agents + system health
ss -tlnp | grep 3011  # is the server already listening?
```

If a dashboard is already running and misbehaving, prefer `/pan-restart` or
`/pan-dashboard-restart` over a blind `pan down && pan up`.

### Step 2: Start

```bash
pan up
```

### Step 3: Verify

```bash
curl -s http://127.0.0.1:3011/api/health   # {"status":"ok",...}
```

Then open `https://pan.localhost` (Traefik) or `http://localhost:3011`.

### Step 4: Check logs (if issues)

```bash
tail -100 ~/.overdeck/logs/dashboard.log
cat ~/.overdeck/restart-status.json       # last restart outcome
tail -20 ~/.overdeck/logs/supervisor.log  # watchdog health-check history
```

## Troubleshooting

### Port 3011 already in use

```bash
ss -tlnp | grep 3011     # find the PID
pan down                 # stop services cleanly
```

### Server starts but API calls return empty

The supervisor watchdog (port 3012) polls `http://127.0.0.1:3011/api/health`
every 10s and restarts the dashboard after 3 consecutive failures. If your
requests return empty, check `~/.overdeck/restart-status.json` — you may be
mid-restart. Wait ~10s and retry.

### Terminal panel stuck "Connection lost / Reconnecting"

The server is likely running under Bun — node-pty exits with code 0 under
Bun's addon layer. Stop it and start with `pan up` (Node 22).

### Stale dist

After changing dashboard server code, `pan up` runs whatever is in `dist/`.
Run `npm run build` first, or use `/pan-reload`.

## Related Skills

- `/pan-down` - Stop services
- `/pan-restart` - Scoped restart (dashboard by default)
- `/pan-reload` - Build, then restart only if the build succeeds
- `/pan-dashboard-restart` - Detached restart when pan up/restart hang
- `/pan-status` - Check running agents and services
- `/pan-network` - Configure Traefik and local domains

## More Information

- Dashboard URL: `https://pan.localhost` (Traefik) or `http://localhost:3011`
- Logs: `~/.overdeck/logs/`
- Run `pan up --help` for current options
