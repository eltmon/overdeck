---
name: pan-restart
description: Restart the Panopticon dashboard (frontend and API server)
---

# Restart Panopticon Dashboard

This skill restarts the Panopticon dashboard services.

## Usage

Run `/pan-restart` to restart both the frontend (port 3010) and API server (port 3011).

## What It Does

1. Kills any existing dashboard processes
2. Starts `npm run dev` in the dashboard directory
3. Waits for services to be ready
4. Verifies both frontend and API are responding

## Execution

```bash
# Kill existing processes
pkill -f "tsx.*server/index" 2>/dev/null
pkill -f "vite.*dashboard" 2>/dev/null
sleep 1

# Start dashboard
cd /home/eltmon/projects/panopticon/src/dashboard
nohup npm run dev > /tmp/panopticon-dashboard.log 2>&1 &

# Wait for startup
sleep 3

# Verify services
echo "Checking frontend (port 3010)..."
curl -s -o /dev/null -w "%{http_code}" http://localhost:3010 && echo " OK" || echo " FAILED"

echo "Checking API (port 3011)..."
curl -s -o /dev/null -w "%{http_code}" http://localhost:3011/api/health && echo " OK" || echo " FAILED"

echo ""
echo "Dashboard restarted. View at: http://localhost:3010"
```

## Troubleshooting

If the dashboard fails to start:

1. Check logs: `tail -50 /tmp/panopticon-dashboard.log`
2. Check for port conflicts: `lsof -i :3010 -i :3011`
3. Ensure dependencies are installed: `cd /home/eltmon/projects/panopticon/src/dashboard && npm install`
