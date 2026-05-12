---
name: pan-reload
description: Rebuild Panopticon and restart the dashboard after code changes.
---

# Pan Reload

Rebuild and restart the Panopticon dashboard after code changes.

## When to Use

Use this skill after making changes to panopticon-cli that affect:
- Dashboard frontend (`src/dashboard/frontend/`)
- Dashboard server (`src/dashboard/server/`)
- CLI commands (`src/cli/`)
- Library code (`src/lib/`)

## Steps

1. **Build the project:**
```bash
cd /home/eltmon/Projects/panopticon-cli && npm run build
```

2. **Restart the dashboard:**
```bash
pan up
```

3. **Verify the dashboard is running:**
```bash
curl -s http://localhost:3011/api/health | head -1
```

Expected output: `{"status":"ok"...}`

## Quick One-Liner

```bash
cd /home/eltmon/Projects/panopticon-cli && npm run build && pan up
```

## Important Notes

- `pan up` automatically kills the old process before starting the new one
- NEVER use `pkill` or manual process killing — use `pan up` instead
- The dashboard must run the built `dist/dashboard/server.js` under Node 22
