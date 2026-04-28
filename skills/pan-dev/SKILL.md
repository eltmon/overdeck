---
name: pan-dev
description: Start Panopticon in development mode with Vite HMR for the frontend and the Node 22 server
triggers:
  - pan dev
  - start panopticon dev
  - dev mode
  - start dashboard dev
allowed-tools:
  - Bash
  - Read
---

# Start Panopticon in Development Mode

Start the dashboard server (Node 22, bundled) and the Vite frontend dev server (HMR on port 3010) for active dashboard development. Traefik, skills sync, and TLDR are started the same as `pan up`.

## When to Use

- User is actively developing the Panopticon dashboard (frontend or server)
- User wants HMR for frontend changes
- User says "start panopticon in dev mode", "pan dev", or "bring up dev"

## Prerequisites

- Node 22 available at `~/.config/nvm/versions/node/v22.22.0/bin/node` (or in PATH)
- `npm run build` has been run at least once (server needs `dist/dashboard/server.js`)
- `node_modules` installed in both root and `src/dashboard/frontend/`

## Architecture

```
Browser → https://pan.localhost (Traefik)
         ↓
  Vite dev server (port 3010) ── HMR, serves React with hot reload
         ↓ proxies /api/* and /ws/*
  Node 22 server (port 3011) ── Effect API, WebSocket, terminal PTY
```

**Why not Bun for the server?** Two hard blockers:
1. `node-pty` native addon exits immediately under Bun (breaks `/ws/terminal`)
2. Circular ESM deps in source that Node strict ESM rejects

So the server always runs the pre-built `dist/dashboard/server.js` under Node 22. After server code changes, rebuild with `npm run build:dashboard:server` and restart the server process.

The frontend runs via Vite dev server with HMR — changes are reflected instantly without rebuild.

## Execution Steps

### Step 1: Kill any existing dashboard processes

```bash
# Kill existing server and frontend processes
pkill -f "node.*dist/dashboard/server\.js" 2>/dev/null
pkill -f "vite.*3010" 2>/dev/null
# Brief pause for port release
sleep 1
```

### Step 1b: Export the dev-mode env var

```bash
export PANOPTICON_DEV=1
```

This is read by `generatePanopticonTraefikConfig()` (src/lib/traefik.ts) so the
Traefik dynamic config routes the frontend to Vite (port 3010) instead of the
bundled Node server (3011). Without this, https://pan.localhost serves the
production-mode static build and you do not get HMR. Export it before any
subsequent step that may regenerate the Traefik config (notably any `pan up` or
`pan install` invocation in this shell).

### Step 2: Verify ports are free

```bash
lsof -i :3010 -i :3011 2>/dev/null
```

If ports are still occupied, kill the specific PIDs shown.

### Step 3: Run skills sync (same as pan up)

```bash
cd /home/eltmon/Projects/panopticon-cli && pan sync 2>&1 | tail -3
```

### Step 4: Start Traefik (if enabled) and regenerate dev-mode config

Check config first:
```bash
grep -A2 '\[traefik\]' ~/.panopticon/config.toml 2>/dev/null
```

If Traefik is enabled:
```bash
cd ~/.panopticon/traefik && docker compose up -d 2>&1
```

Regenerate the Traefik dynamic config in dev mode so the frontend route points
to Vite (3010) instead of the bundled server (3011):
```bash
PANOPTICON_DEV=1 node -e "
import('/home/eltmon/Projects/panopticon-cli/dist/cli/index.js').catch(()=>{});
import('/home/eltmon/Projects/panopticon-cli/src/lib/traefik.ts').catch(()=>{});
" 2>/dev/null

# Or, more reliably via tsx:
cd /home/eltmon/Projects/panopticon-cli && \
  PANOPTICON_DEV=1 npx tsx -e "import('./src/lib/traefik.ts').then(m => m.generatePanopticonTraefikConfig())" 2>&1
```

Verify the rendered file has the frontend on port 3010:
```bash
grep 'host.docker.internal' ~/.panopticon/traefik/dynamic/panopticon.yml
# Expected: 3010 (frontend) and 3011 (api). If both show 3011, the regen above
# did not run with PANOPTICON_DEV=1; check the env var.
```

### Step 5: Rebuild server if needed

If server code has changed since last build:
```bash
cd /home/eltmon/Projects/panopticon-cli && npm run build:dashboard:server 2>&1
```

If unsure, always rebuild — it takes ~2 seconds.

### Step 6: Start the API server (background)

```bash
cd /home/eltmon/Projects/panopticon-cli && \
  nohup /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js \
  > /tmp/panopticon-server.log 2>&1 &
echo "Server PID: $!"
```

### Step 7: Wait for server health

```bash
for i in $(seq 1 15); do
  if curl -s http://localhost:3011/api/health | grep -q ok; then
    echo "Server ready"
    break
  fi
  sleep 1
done
```

### Step 8: Start the Vite frontend dev server (background)

```bash
cd /home/eltmon/Projects/panopticon-cli/src/dashboard/frontend && \
  nohup npx vite --host 0.0.0.0 --port 3010 \
  > /tmp/panopticon-frontend.log 2>&1 &
echo "Frontend PID: $!"
```

### Step 9: Wait for frontend and verify

```bash
for i in $(seq 1 10); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3010 | grep -q 200; then
    echo "Frontend ready"
    break
  fi
  sleep 1
done
```

### Step 10: Start TLDR daemon (if .venv exists)

```bash
cd /home/eltmon/Projects/panopticon-cli
if [ -d .venv ]; then
  pan tldr start 2>/dev/null || echo "TLDR unavailable (non-fatal)"
fi
```

### Step 11: Report status

Print:
- Server: `http://localhost:3011` (API)
- Frontend: `http://localhost:3010` (Vite HMR)
- Traefik: `https://pan.localhost` (if enabled, proxies to Vite on 3010)
- Server log: `/tmp/panopticon-server.log`
- Frontend log: `/tmp/panopticon-frontend.log`

## After Server Code Changes

The server runs pre-built JS, so after editing `src/dashboard/server/**`:

```bash
cd /home/eltmon/Projects/panopticon-cli && npm run build:dashboard:server
pkill -f "node.*dist/dashboard/server\.js"
nohup /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js \
  > /tmp/panopticon-server.log 2>&1 &
```

## After Frontend Code Changes

Nothing needed — Vite HMR picks up changes automatically.

## Troubleshooting

### Vite can't proxy to server
Server isn't running or crashed. Check `/tmp/panopticon-server.log`.

### Terminal panel shows "Reconnecting"
Server is running under wrong runtime. Verify: `ps aux | grep server.js` should show Node 22, not Bun.

### Port 3010 already in use
```bash
lsof -i :3010
kill <PID>
```

### HMR not working through Traefik
Vite HMR WebSocket needs WSS through Traefik. The `vite.config.ts` handles this when `TRAEFIK_ENABLED=true`. Start the Vite server with:
```bash
TRAEFIK_ENABLED=true npx vite --host 0.0.0.0 --port 3010
```

## Stopping Dev Mode

```bash
pkill -f "node.*dist/dashboard/server\.js"
pkill -f "vite.*3010"
```

Or use `/pan-down` which handles all cleanup.
