# B (wave 2) — Decompose `routes/workspaces.ts` into deep modules

**Epic:** B · **Branch:** `codebase-health/workspaces-decomp` (off `main`) · **Executor:** GLM-5.2 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam on this branch; the orchestrator reviews + merges.

---

## Glossary
- **`routes/workspaces.ts`** = `src/dashboard/server/routes/workspaces.ts` (~6,100 lines), a dashboard HTTP route module built on **Effect.js** (routes composed via `Layer`). **B2 already extracted the container/docker routes** into `routes/workspaces/container-ops.ts` — follow that exact pattern and do not touch it.
- **Route module + Layer composition** = each submodule exports a `*RouteLayer`; `workspaces.ts` merges it via `Layer.mergeAll(...)`. **Match how `container-ops.ts` is wired** (`import { containerOpsRouteLayer } from './workspaces/container-ops.js'` + included in the composed layer) — read it first as the template.
- **Behavior-preserving move** = relocate routes + their exclusively-used helpers verbatim into a submodule, register identically. No logic changes.

## Goal
Carve the remaining big clusters out of `routes/workspaces.ts` into `routes/workspaces/*.ts` submodules, behavior-preserving, taking it from ~6,100 toward ~2,000. Each seam is its own commit.

## Seams (extract in this order — safest first; commit per seam)

> For each: identify the routes by path + the helpers used **only** by them (`grep -rn` each helper across `src/` — anything used elsewhere **stays** in `workspaces.ts` and is imported). Move into the submodule, export a `*RouteLayer`, merge it back. Verify after each seam.

1. **`routes/workspaces/workspace-data.ts`** (LOW) — read-only query routes: `GET /api/workspace-stack-health`, `GET /api/workspaces/:issueId`, `POST /api/workspaces`, `GET .../plan`, `GET .../uat-context`, `PATCH .../plan/inspection-policy`, `GET .../tldr`. **Re-export the shared helper `getWorkspaceInfoForIssue`** (used by other clusters too) so they can import it.
2. **`routes/workspaces/stash-clean.ts`** (LOW) — `GET/POST/DELETE .../stashes*`, `GET .../clean/preview`, `POST .../clean` + their git/stash helpers.
3. **`routes/workspaces/review-pipeline.ts`** (MED) — review lifecycle routes: `POST /api/review/:id/trigger|request|reset|purge|abort`, `DELETE .../pending`, `POST .../unstick|deacon-ignore|auto-merge` + review-specific helpers (`setReviewStatus`, `shouldTreatAsRerun`, `deliverQueuedFeedback`, `processResetReviewPipeline`, etc.). Keep the shared `pendingOperations`/`activityLog`/`EventStoreService` **owned by `workspaces.ts`** and import them.
4. **`routes/workspaces/merge-ops.ts`** (HIGH) — `POST /api/issues/:id/merge|approve|forge-approve|forge-merge|sync-main`, `GET /api/queue/merge`, `POST /internal/pipeline/notify` + `triggerMerge`, `pushApproveMain`, etc. **`_serverManagedMerges` is imported from `specialists.js` — import it, never duplicate.** The SQLite merge-queue functions stay in `lib/overdeck/merge.js`.

## Requirements
**FR-1** Each seam's routes + exclusive helpers live in its submodule; `workspaces.ts` composes each `*RouteLayer` exactly as it does `containerOpsRouteLayer`; every route keeps its method + path.
**FR-2** Shared singletons are imported, never duplicated: `pendingOperations`, `activityLog`, `_serverManagedMerges`, `getProjectPath`, `getWorkspaceInfoForIssue`, `EventStoreService`.
**FR-3** Each seam is a separate commit (`refactor(dashboard): extract <seam> from workspaces.ts`).
**FR-4** After each seam: `npm run typecheck` + `npm run lint` + `npm run build` pass; route/workspace tests pass.

**NFR-1** Behavior-preserving only — no logic edits, no renames.
**NFR-2** No new explicit `any` (A1 ratchet live; Effect boundaries: use precise types, never `any` — if truly stuck, report, don't add `any`).
**NFR-3** No `execSync` (server-reachable). No new import cycle — if composition forces one, prefer a small shared module; if that balloons, **commit the seams that worked and report**.
**NFR-4** If a new `routes/workspaces/` file is created and the `workspaces/` gitignore swallows it (as happened in B2), add the same scoped `!src/dashboard/server/routes/workspaces/` un-ignore — verify the new files are actually tracked (`git status` shows them).

## Verification (after EACH seam)
```
npm run typecheck && npm run lint && npm run build
npx vitest run --configLoader runner $(grep -rl workspaces tests/unit | tr '\n' ' ')
```
Confirm each moved route is still registered (search the composed layer). Full suite runs in CI.

## Acceptance criteria
- `workspaces.ts` shrinks substantially; `routes/workspaces/{workspace-data,stash-clean,review-pipeline,merge-ops}.ts` exist and are composed.
- No shared singleton duplicated (`grep` proves single ownership).
- typecheck/lint/build exit 0; route tests green; new files tracked.
- Each seam's `git diff` is a pure move + wiring.

## Intersecting rules (restated)
No bandaids; surgical moves; dashboard is Node-22 / no `execSync` / async only; A1 ratchet (no new `any`); worktree discipline (branch = `codebase-health/workspaces-decomp`; never `git checkout <branch>` / `git stash`); conventional commits, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers.

## Out of scope
The already-extracted container-ops; any logic change; the Epic E `myn` de-hardcode (separate effort — leave the hardcoded `'myn'` at `:2898` alone for now unless it moves verbatim with a seam).
