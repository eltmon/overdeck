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

`pan reload` fetches `origin/main`, creates a temporary detached worktree at that commit, and runs `bun install` followed by `npm run build` there — never in the primary working tree. If the primary tree has uncommitted changes or its `HEAD` differs from `origin/main`, the command notes that those changes are excluded and continues with the canonical build. If installation or build fails, it leaves the current dashboard running and exits non-zero; after a successful build, it keeps the detached worktree as the active deployment root and launches its `dist/dashboard/server.js` with its canonical runtime dependencies and workspace packages intact, leaves the primary checkout's `node_modules/` untouched, refreshes the primary `dist/` CLI mirror with a dependency link back to that deployment root, then restarts the dashboard and waits for `http://127.0.0.1:3011/api/health`. Deployments alternate between two fixed generation worktrees. A failure before the new process is left running restores the prior marker and primary `dist/` and removes the failed generation. A new dashboard that exits before it becomes healthy counts as such a failure (PAN-3899): the build is never promoted, the global `pan` CLI is not repointed, and the next `pan restart` launches the last good build. A health timeout while the new process is still alive keeps the new deployment active, because that process is deliberately left running so a slow boot can finish or a failed boot can be inspected. Retries still reuse one of the two fixed slots, so failures cannot accumulate unbounded dependency trees.

`npm run build` already rebuilds the dashboard **server** bundle (via `build-post-cli.mjs` → `build:dashboard:server:bundle`), so `pan reload` picks up server/deacon code changes — you do **not** need a separate `npm run build:dashboard:server`. The `bun install` step runs first so a merge/rebase that added a runtime dependency (e.g. `chokidar`) can't produce a freshly-built server that boot-crashes with `ERR_MODULE_NOT_FOUND`.

## Options

- `--skip-build` — restart the current bundle without running `bun install` or `npm run build`.
- `--force` — explicitly bypass the deploy-window gate. Without it, a refused agent-issued reload queues the deploy, reports its age and distinct verification blockers, and self-fires at the next safe verification boundary. Do not retry-loop or use `--force` to interrupt healthy verification; reserve the bypass for exceptional operator recovery.
- `--health-timeout <ms>` — set the dashboard health-check budget. The default is `30000`.
- `--deacon` — accepted for symmetry; Deacon is always on after a reload.
- `--no-deacon` — refused before anything is built or stopped. A Deacon-off dashboard runs as a read-only peer, and a peer cannot hold the host dashboard port, so the reload would stop the running dashboard and leave none.
- `--resume` / `--no-resume` — enable or disable agent auto-resume on the reloaded dashboard.

Without `--resume`/`--no-resume`, `pan reload` keeps the running dashboard's resume gate (PAN-3899). Before it restarts anything it reads the gate from `/api/health` (`bootGates`, or the server's env markers for an older server), retrying once with a longer budget, and hands it to the replacement, so a deploy keeps the resume choice of the last `pan restart`. Only a dashboard of this checkout counts. The Deacon gate is not carried: reload always boots Deacon on, and stamps the resolved gates into the new server's env, so a stray `OVERDECK_DISABLE_DEACON` in the invoking shell cannot change it. It prints `Boot gates: …` and then where the resume gate came from. When the gate cannot be read (no answer, a non-JSON body, another checkout on the port), it says why and uses the default, `resume=on`.

## Notes

- Do not use `pkill`, `fuser`, or manual port cleanup. The command uses the dashboard lifecycle code.
- The dashboard serves the UI on port `3010` and the API on port `3011` by default.
- The dashboard must run the built `dist/dashboard/server.js` under Node 22.
