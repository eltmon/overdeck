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

`pan reload` runs `bun install` and then `npm run build` first. If either fails, it leaves the current dashboard running and exits non-zero. If both succeed, it restarts the dashboard and waits for `http://127.0.0.1:3011/api/health`.

`npm run build` already rebuilds the dashboard **server** bundle (via `build-post-cli.mjs` → `build:dashboard:server:bundle`), so `pan reload` picks up server/deacon code changes — you do **not** need a separate `npm run build:dashboard:server`. The `bun install` step runs first so a merge/rebase that added a runtime dependency (e.g. `chokidar`) can't produce a freshly-built server that boot-crashes with `ERR_MODULE_NOT_FOUND`.

## Options

- `--skip-build` — restart the current bundle without running `bun install` or `npm run build`.
- `--health-timeout <ms>` — set the dashboard health-check budget. The default is `30000`.
- `--no-deacon` — restart without Cloister/Deacon auto-start.

## Notes

- Do not use `pkill`, `fuser`, or manual port cleanup. The command uses the dashboard lifecycle code.
- The dashboard serves the UI on port `3010` and the API on port `3011` by default.
- The dashboard must run the built `dist/dashboard/server.js` under Node 22.
