# PAN-444: Auto-deploy — rebuild + restart dashboard server after merge to main

## Problem

After merging a feature branch to main, the running dashboard server holds stale content-hashed chunk references in its Node.js module cache. tsdown code-splitting produces filenames like `close-issue-BVnGI6Mw.js`. When new code merges, the build produces new hashes, but the running process still tries to `import()` the old filenames — `ERR_MODULE_NOT_FOUND`.

This broke PAN-440's post-merge lifecycle:
```
Cannot find module 'close-issue-BVnGI6Mw.js'
TypeError: onMergeComplete is not a function
```

## Root Cause

`postMergeLifecycle()` in `src/lib/cloister/merge-agent.ts` runs **inside the dashboard server process**. Its lifecycle steps use dynamic imports (`await import('../lifecycle/archive-planning.js')`, etc.) that resolve to content-hashed chunk filenames. After the merge-agent specialist builds new dist/ files, the old chunk files are overwritten — the running process's cached import paths point to files that no longer exist.

## Decision: Detached deploy script + pending lifecycle file

### Why not just "build and continue"?

Even if we rebuild `dist/` first, the running Node.js process still has old chunk references baked into its module graph. The **only** fix is to restart the server so the new process loads the new chunk filenames.

### Why not restart inline?

`postMergeLifecycle` runs inside the server. Restarting the server kills the function mid-execution. The lifecycle never completes.

### Solution: Three-part handoff

1. **Step 0 in `postMergeLifecycle`**: Write pending task to `~/.panopticon/pending-post-merge.json`, spawn detached deploy script, return immediately.
2. **`scripts/post-merge-deploy.sh`**: Build (`npm run build && npm link`) -> kill server -> start new server (auto-detect bun dev vs node prod) -> wait for health check.
3. **Server startup hook in `main.ts`**: On boot, check for pending file. If found, delete it, then schedule `postMergeLifecycle()` after a short delay. The fresh process has correct chunk references — lifecycle completes successfully.

## Architecture

```
                    OLD SERVER PROCESS
                    ==================
merge completes
    |
    v
postMergeLifecycle()
    |
    +-- write ~/.panopticon/pending-post-merge.json
    |     { issueId, projectPath, sourceBranch, timestamp }
    |
    +-- spawn detached: scripts/post-merge-deploy.sh
    |
    +-- return (done — current process will be killed)


              DETACHED DEPLOY SCRIPT
              ======================
post-merge-deploy.sh
    |
    +-- npm run build && npm link
    |
    +-- kill server (ports 3010/3011/3012)
    |
    +-- start new server (detect mode: bun dev / node prod)
    |
    +-- poll /api/health (30s timeout)
    |
    +-- exit


                    NEW SERVER PROCESS
                    ==================
main.ts startup
    |
    +-- read pending-post-merge.json
    |
    +-- delete pending file
    |
    +-- after 3s delay: postMergeLifecycle(issueId, projectPath)
    |     (fresh imports — all chunks resolve correctly)
    |
    +-- notifyTldrDaemon(projectPath, sourceBranch)
```

## Scope

### In scope
- New `scripts/post-merge-deploy.sh` — build, restart, health check
- Modify `postMergeLifecycle()` — step 0: write pending file + spawn deploy script
- Modify `src/dashboard/server/main.ts` — startup hook for pending lifecycle
- Auto-detect server runtime mode (bun dev vs node prod)
- Health check verification before lifecycle resumes
- Stale pending file protection (ignore if > 1 hour old)

### Out of scope
- Git post-merge hooks (single code path in merge-agent flow)
- File watcher / auto-build daemon
- Hot module replacement for the server
- Changes to tsdown code-splitting configuration

## Edge Cases

| Case | Handling |
|------|----------|
| Build fails | Deploy script logs error, exits non-zero. Server stays on old code. Pending file remains for next startup. |
| Health check timeout | Deploy script exits 1. User investigates manually. |
| Stale pending file (> 1h) | Ignored on startup — likely from a failed deploy. Logged and deleted. |
| Multiple rapid merges | Latest pending file wins (overwrite). `_completedPostMerge` guard resets on restart. |
| Server already stopped | Deploy script starts fresh server, lifecycle runs. |
| Deploy script can't spawn | Logged as warning. Fall through to run lifecycle in current process (best-effort, may fail on stale chunks). |

## Files to Modify

1. **New: `scripts/post-merge-deploy.sh`** — Build + restart + health check script
2. **Modify: `src/lib/cloister/merge-agent.ts`** — Add step 0 to `postMergeLifecycle()`
3. **Modify: `src/dashboard/server/main.ts`** — Add pending lifecycle startup hook

## Acceptance Criteria

- [ ] After merge to main, `npm run build && npm link` runs automatically
- [ ] Dashboard server restarts with new code
- [ ] Health check passes before lifecycle resumes
- [ ] Post-merge lifecycle (close issue, move PRD, clean labels, etc.) completes in new process
- [ ] No `ERR_MODULE_NOT_FOUND` errors on dynamic imports after merge
- [ ] Works in both bun dev and node prod modes
- [ ] Typecheck, lint, and tests pass

## Difficulty

**medium** — 3 files modified/created, clear approach, standard patterns. Sonnet-appropriate.

## Specialist Feedback

- **[2026-04-04T21:16Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-04-04T21:24Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
