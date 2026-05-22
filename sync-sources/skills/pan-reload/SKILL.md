---
name: pan-reload
description: Build Panopticon, then restart the dashboard only if the build succeeds.
---

# Pan Reload

Use this after code changes that should run in the local Panopticon dashboard.

## Command

```bash
pan reload
```

`pan reload` runs `npm run build` first. If the build fails, it leaves the current dashboard running and exits non-zero. If the build succeeds, it restarts the dashboard and waits for `http://127.0.0.1:3011/api/health`.

## Options

- `--skip-build` — restart the current bundle without running `npm run build`.
- `--health-timeout <ms>` — set the dashboard health-check budget. The default is `30000`.
- `--no-deacon` — restart without Cloister/Deacon auto-start.

## Notes

- Do not use `pkill`, `fuser`, or manual port cleanup. The command uses the dashboard lifecycle code.
- The dashboard serves the UI on port `3010` and the API on port `3011` by default.
- The dashboard must run the built `dist/dashboard/server.js` under Node 22.
