# B (wave 2 follow-on) — Extract merge-ops from `routes/workspaces.ts`

**Epic:** B · **Branch:** `codebase-health/merge-ops` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit on this branch; the orchestrator reviews + merges.

---

## Context
`routes/workspaces.ts` has already had 3 seams extracted (workspace-data, stash-clean, review-pipeline, review-control — all on `main`). This is the **4th and final, highest-coupled seam: merge-ops.** It was deferred from the main workspaces decomposition because it's the riskiest. Follow the **existing pattern** of the sibling modules in `src/dashboard/server/routes/workspaces/` (read `container-ops.ts` + `review-pipeline.ts` first as templates for the Effect `Layer` wiring).

## Goal
Behavior-preserving extraction of the merge/approve routes + their exclusive helpers from `routes/workspaces.ts` into a new `src/dashboard/server/routes/workspaces/merge-ops.ts`, registered via a `mergeOpsRouteLayer` composed back in `workspaces.ts`.

## Scope — routes to move (locate by path with `grep -n`)
`POST /api/issues/:id/merge`, `POST /api/issues/:id/approve`, `POST /api/issues/:id/forge-approve`, `POST /api/issues/:id/forge-merge`, `POST /api/issues/:id/sync-main`, `GET /api/queue/merge`, `POST /internal/pipeline/notify` — plus the helpers used **only** by them (`triggerMerge`, `pushApproveMain`, `reconcileGitHubMergeStatus`, dequeue helpers, etc.; `grep -rn` each to confirm it's merge-only — anything also used elsewhere stays in `workspaces.ts` and is imported).

## Requirements
**FR-1** The merge routes + exclusive helpers live in `routes/workspaces/merge-ops.ts`; `workspaces.ts` composes `mergeOpsRouteLayer` exactly like the other sibling layers; every route keeps its method + path.
**FR-2** **Shared singletons imported, never duplicated:** `_serverManagedMerges` is imported from `specialists.js`; the SQLite merge-queue functions (`enqueueMerge`/`dequeueMerge`/`markMergeProcessing`/`getAllActiveQueues`/…) stay in `lib/overdeck/merge.js` and are imported; `pendingOperations`/`activityLog`/`getProjectPath`/`getWorkspaceInfoForIssue` stay owned by `workspaces.ts`.
**FR-3** Dynamic imports stay dynamic (e.g. `notifyPipelineSync` via `import('../../../lib/pipeline-notifier.js')` — adjust the relative depth for the new file's location).
**FR-4** Affected tests repointed to the new import paths and passing.
**FR-5** `npm run typecheck` + `npm run lint` + `npm run build` pass; route/merge tests pass.

**NFR-1** Behavior-preserving only — no logic edits, no renames.
**NFR-2 — `any` handling (IMPORTANT, do the FAST path):** for `any` that already exists in the moved code, **do NOT convert it** — this is a pure move. Instead, **add the new file `src/dashboard/server/routes/workspaces/merge-ops.ts` to `eslint-any-allowlist.json`** (the baseline quarantine) so the A1 ratchet passes. Converting `any`→`unknown` is separate future cleanup, not part of a behavior-preserving move. (This avoids the slow per-`any` conversion.)
**NFR-3** No `execSync` (server-reachable). No new import cycle; if forced, prefer a small shared module, else report.
**NFR-4** If the new `routes/workspaces/` file is gitignored by the `workspaces/` worktree-ignore, it's already handled (B2 added `!src/dashboard/server/routes/workspaces/`); confirm `git status` tracks the new file.

## Verification
```
npm run typecheck && npm run lint && npm run build
npx vitest run --configLoader runner $(grep -rl "merge\|approve\|workspaces" tests/unit | tr '\n' ' ')
```

## Acceptance criteria
- `merge-ops.ts` holds the merge/approve routes; `workspaces.ts` composes its layer; all paths still registered.
- `_serverManagedMerges` single-owned (imported from specialists.js); SQLite queue stays in `lib/overdeck/merge.js`.
- New file added to `eslint-any-allowlist.json` (not converted); `npm run lint` exit 0.
- typecheck/build exit 0; merge/route tests green; diff is a pure move + wiring + allowlist entry.

## Intersecting rules (restated)
No bandaids; surgical moves; dashboard Node-22 / no `execSync` / async only; A1 ratchet (no NEW `any` — use the allowlist for MOVED any per NFR-2); worktree discipline (branch = `codebase-health/merge-ops`; never `git checkout <branch>` / `git stash`); conventional commits, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers (esp. `_serverManagedMerges` coupling) to the orchestrator.

## Out of scope
The other (already-extracted) seams; any logic change; converting existing `any` to precise types (separate cleanup).
