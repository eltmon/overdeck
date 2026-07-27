---
name: pan-reload
description: Build Overdeck, then restart the dashboard only if the build succeeds.
---

# Pan Reload

Use this after code changes that should run in the local Overdeck dashboard.

## Command

```bash
pan reload
pan reload --force   # explicit operator bypass of the deploy-window gate
```

`pan reload` fetches `origin/main`, creates a temporary detached worktree at that commit, and runs `bun install` followed by `npm run build` there — never in the primary working tree. If the primary tree has uncommitted changes or its `HEAD` differs from `origin/main`, the command notes that those changes are excluded and continues with the canonical build. If installation or build fails, it leaves the current dashboard running and exits non-zero; after a successful build, it keeps the detached worktree as the active deployment root and launches its `dist/dashboard/server.js` with its canonical runtime dependencies and workspace packages intact, leaves the primary checkout's `node_modules/` untouched, refreshes the primary `dist/` CLI mirror with a dependency link back to that deployment root, then restarts the dashboard and waits for `http://127.0.0.1:3011/api/health`. Deployments alternate between two fixed generation worktrees. A failure before the new process is left running restores the prior marker and primary `dist/` and removes the failed generation. A health timeout keeps the new deployment active because the dashboard is deliberately left running so a slow boot can finish or a failed boot can be inspected. Retries still reuse one of the two fixed slots, so failures cannot accumulate unbounded dependency trees.

`npm run build` already rebuilds the dashboard **server** bundle (via `build-post-cli.mjs` → `build:dashboard:server:bundle`), so `pan reload` picks up server/deacon code changes — you do **not** need a separate `npm run build:dashboard:server`. The `bun install` step runs first so a merge/rebase that added a runtime dependency (e.g. `chokidar`) can't produce a freshly-built server that boot-crashes with `ERR_MODULE_NOT_FOUND`.

## Options

- `--skip-build` — restart the current bundle without running `bun install` or `npm run build`.
- `--force` — explicitly bypass the deploy-window gate. Without it, a refused agent-issued reload queues the deploy, reports its age and distinct verification blockers, and self-fires at the next safe verification boundary. Do not retry-loop or use `--force` to interrupt healthy verification; reserve the bypass for exceptional operator recovery.
- `--health-timeout <ms>` — set the dashboard health-check budget. The default is `30000`.
- `--no-deacon` — restart without Cloister/Deacon auto-start.

## Notes

- Do not use `pkill`, `fuser`, or manual port cleanup. The command uses the dashboard lifecycle code.
- The dashboard serves the UI on port `3010` and the API on port `3011` by default.
- The dashboard must run the built `dist/dashboard/server.js` under Node 22.
