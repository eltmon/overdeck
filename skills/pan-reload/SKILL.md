# Pan Reload

Rebuild and restart the Panopticon dashboard after code changes.

## When to Use

Use this skill after merging changes to panopticon-cli that affect:
- Dashboard frontend (`src/dashboard/frontend/`)
- Dashboard server (`src/dashboard/server/`)
- CLI commands (`src/cli/`)
- Library code (`src/lib/`)

## Steps

1. **Build the project:**
```bash
cd /home/eltmon/projects/panopticon && npm run build
```

2. **Restart the dashboard:**
```bash
/home/eltmon/projects/panopticon/scripts/restart-dashboard.sh
```

3. **Verify the dashboard is running:**
```bash
curl -s http://localhost:3011/api/health | head -1
```

Expected output: `{"status":"ok"...}`

## Quick One-Liner

For agents that need a single command:
```bash
cd /home/eltmon/projects/panopticon && npm run build && ./scripts/restart-dashboard.sh
```

## Troubleshooting

If the dashboard fails to start:
1. Check for port conflicts: `fuser 3010/tcp 3011/tcp`
2. Kill stale processes: `fuser -k 3010/tcp 3011/tcp`
3. Check logs: `tail -50 /tmp/dashboard.log`
