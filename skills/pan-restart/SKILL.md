---
name: pan-restart
description: Restart the Panopticon dashboard using pan up (the only safe way)
---

# Restart Panopticon Dashboard

Restarts the Panopticon dashboard using `pan up`, which is the canonical restart method.

## Usage

Run `/pan-restart` to restart the dashboard. `pan up` handles gracefully stopping the old
instance (via port-based kill) and starting a new one.

## Execution

```bash
# Build first if code was changed
cd /home/eltmon/Projects/panopticon-cli && npm run build

# Restart via pan up — handles killing old process on ports 3010/3011 automatically
pan up

# Verify
curl -s http://localhost:3011/api/health | head -1
```

Expected output: `{"status":"ok"...}`

## Important Notes

- NEVER use `pkill -f "node.*server"` or similar — it can kill unrelated Node processes
- NEVER use `npm run dev` — the dashboard must run under Node 22 via the built dist
- Always run `npm run build` first if you changed dashboard server or CLI code
- `pan up` is idempotent — it kills the old process first, then starts the new one
