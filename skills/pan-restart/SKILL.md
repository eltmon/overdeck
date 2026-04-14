---
name: pan-restart
description: "pan up — restart the dashboard (handles stale builds, port conflicts on 3010/3011)"
---

# Restart Panopticon Dashboard

Use this whenever the Panopticon dashboard needs a restart, reload, or rebuild-backed restart.

This is the canonical path for:
- dashboard restart requests
- server code changes that need a rebuild + restart
- `EADDRINUSE` / "address already in use" on port `3010` or `3011`
- cases where an old dashboard process did not die cleanly

## Usage

Run `/pan-restart` to restart the dashboard.

`pan up` is the correct command because it:
- builds/runs the proper dashboard runtime path
- kills the old dashboard listeners by port
- restarts cleanly on the expected ports

## Execution

```bash
# Build first if code was changed
cd /home/eltmon/Projects/panopticon-cli && npm run build

# Canonical restart path
# pan up kills old listeners on 3010 (frontend) and 3011 (API) before starting
pan up

# Verify API is back
curl -s http://localhost:3011/api/health | head -1
```

Expected output: `{"status":"ok"...}`

## Important Notes

- If you see `listen EADDRINUSE` on `3010` or `3011`, that means the old dashboard is still bound to the port. Use this skill; do NOT start another server manually.
- NEVER use `pkill -f "node.*server"` or similar — it can kill unrelated Node processes.
- NEVER use `npm run dev` for the dashboard restart path — production-style dashboard runs under Node 22 via built dist.
- Always run `npm run build` first if you changed dashboard server or CLI code.
- `pan up` is idempotent for restart purposes: it kills the old process first, then starts the new one.
- Prefer this skill whenever the request mentions restart, reload, stale server state, or port conflicts on `3010`/`3011`.
