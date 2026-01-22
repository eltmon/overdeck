# pan-restart

Safely restart Panopticon dashboard services without killing your own process.

## CRITICAL WARNING

**NEVER** use `kill -9` or `xargs kill` on ports 3010/3011 directly!

The Panopticon dashboard runs on these ports, and if you're a Claude Code agent spawned by the dashboard, killing these processes will terminate YOUR OWN SESSION.

## Safe Restart Pattern

Use `nohup` and background the process, then verify health:

```bash
# 1. Stop existing processes gracefully (if needed)
pkill -f "panopticon-dashboard" || true

# 2. Start dashboard in background with nohup
cd /home/eltmon/projects/panopticon/src/dashboard
nohup npm run dev > /tmp/dashboard.log 2>&1 &

# 3. Wait and verify
sleep 3
curl -s http://localhost:3011/api/health | jq -r '.status'
```

## What NOT To Do

```bash
# DANGEROUS - Will kill your own process if you're a dashboard-spawned agent!
lsof -ti:3010 -ti:3011 | xargs -r kill -9

# DANGEROUS - Same problem
fuser -k 3010/tcp 3011/tcp
```

## Why This Matters

When you're running as:
- A planning agent in the PlanDialog terminal
- A work agent spawned via the dashboard
- Any agent communicating through the dashboard's WebSocket

...the dashboard is YOUR parent process. Killing it kills you.

## Safe Alternatives

1. **For code changes**: The dashboard uses `tsx watch` which auto-reloads on file changes
2. **For full restart**: Use `nohup` pattern above
3. **For development**: Run `npm run dev` in a separate terminal you control

## Checking If Dashboard Is Running

```bash
# Check health endpoint
curl -s http://localhost:3011/api/health

# Check processes
pgrep -f "panopticon-dashboard" || echo "Not running"

# Check ports
lsof -i:3010 -i:3011
```
