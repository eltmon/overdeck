# B2 — Extract container/docker routes out of `routes/workspaces.ts`

**Epic:** B (Carve deep modules) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/b2` (stacked on `codebase-health/b-kickoff` → main) · **Executor:** GLM-5.2 (handoff), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR, do NOT touch the pipeline.** Commit on this branch; the orchestrator reviews and merges.

---

## Glossary
- **God file** — `src/dashboard/server/routes/workspaces.ts` is ~6,638 lines, a dashboard HTTP route module built on **Effect.js** (routes composed via `Layer`).
- **Route module + Layer composition** — each `routes/*.ts` exports route handlers that are merged into a layer; `workspaces.ts` composes them. **You must match the existing idiom** — read a sibling module in `src/dashboard/server/routes/` and how `workspaces.ts` currently registers its routes, and mirror it exactly.
- **probe cache** — `probeCache` Map + `setCachedProbe`/`getCachedProbe`/`pruneProbeCache`, used only by the container routes. Local state; moves with them.
- **Behavior-preserving extraction** — move handlers + their private helpers into a new module, register them identically, so every route responds exactly as before.

## Problem
`workspaces.ts` is the second-largest file in the repo. B2 extracts the **container/docker cluster** — the lowest-risk, most self-contained seam (no coupling to the merge queue, review status, or EventStore) — to start decomposing it.

## Scope — the cluster to extract
Locate by route path / function name (`grep -n`); approximate regions noted but **use names, not line numbers**:
- Routes: `POST /api/workspaces/:issueId/containerize`, `POST /api/workspaces/:issueId/containers/:containerName/:action`, `POST /api/workspaces/:issueId/memory-summary`, `POST /api/workspaces/:issueId/refresh-db`.
- Helpers used **only** by those routes: `getContainerStatusAsync`, `probeContainerPortAsync`, `extractContainerServiceHealth`, `repairFlywayIfNeeded`, `setCachedProbe`, `getCachedProbe`, `pruneProbeCache`, and the `probeCache` Map.
- Verify with `grep` that each helper is used **only** by the four routes before moving it. Anything also used elsewhere stays in `workspaces.ts` and is imported.

Target module: `src/dashboard/server/routes/workspaces/container-ops.ts` (create the `workspaces/` subdirectory).

## Requirements
**FR-1** — The four container routes + their exclusive helpers + `probeCache` live in `routes/workspaces/container-ops.ts`.
**FR-2** — The routes are registered identically: `container-ops.ts` exports a layer (matching the existing pattern) and `workspaces.ts` composes it into its route layer. Every route keeps its exact method + path.
**FR-3** — Shared singletons stay put and are imported, never duplicated: `pendingOperations`, `activityLog`, `getProjectPath`, `getWorkspaceInfoForIssue`, `_serverManagedMerges`, etc. remain owned by their current module; `container-ops.ts` imports what it needs.
**FR-4** — Behavior unchanged: `npm run typecheck`, `npm run lint`, `npm run build` pass; no test green on `main` now fails.

**NFR-1** — Behavior-preserving only — no logic edits, no renames (Karpathy #3).
**NFR-2** — No new explicit `any` (A1 ratchet live; `npm run lint` enforces).
**NFR-3** — No new circular import. If composition forces `container-ops.ts` to import from `workspaces.ts` AND vice-versa in a way that breaks `npm run build`, prefer moving the genuinely-shared helper to a small shared module — but if that balloons scope, **stop and report to the orchestrator**.
**NFR-4** — No `execSync` anywhere reachable from the server (existing rule). Preserve the async patterns already in the moved code.

## Steps
1. Read 1–2 sibling modules in `src/dashboard/server/routes/` and the route-composition section of `workspaces.ts` to learn the exact Layer idiom.
2. `grep -n` the four route registrations + each helper; `grep -rn` each helper across `src/` to confirm it's container-only (else leave + import).
3. Create `routes/workspaces/container-ops.ts`; move routes + exclusive helpers + `probeCache`; add imports for shared symbols (from `../workspaces.js` or their true source).
4. Export the container-ops layer; in `workspaces.ts`, remove the moved code and merge the imported layer into the composed route layer.
5. Verify (FR-4): `npm run typecheck && npm run lint && npm run build`. Then confirm the routes still exist (search the composed layer) and run workspace/route tests (`grep -rl workspaces tests/`); all green.

## Acceptance criteria
- **AC-1 (FR-1/2):** `container-ops.ts` holds the four routes + helpers; `workspaces.ts` composes its layer; all four paths still registered.
- **AC-2 (FR-3):** no shared singleton is duplicated (`grep` shows `probeCache` only in container-ops; `_serverManagedMerges`/`pendingOperations` still single-owned).
- **AC-3 (FR-4/NFR-3):** `npm run typecheck`, `npm run lint`, `npm run build` exit 0; route tests green.
- **AC-4 (NFR-1):** diff is a pure move + wiring; no logic change.

## Intersecting repo rules (restated)
- **Dashboard server is Node-22 / no `execSync`** — don't introduce blocking calls; keep async.
- **A1 `no-explicit-any` ratchet is live** — no new `any` (Effect boundaries: prefer precise types; if truly unavoidable a file would need to enter the allowlist — instead, **report to the orchestrator**, don't add `any`).
- **Surgical, behavior-preserving** — move only.
- **Worktree discipline:** verify `git branch --show-current` = `codebase-health/b2`; never `git checkout <branch>`; never `git stash`.
- **Commit per step**, conventional commits, never `--no-verify`. Suggested: `refactor(dashboard): extract container-ops routes from workspaces.ts`.
- **Do NOT run `pan done` / open a PR.** Report blockers to the orchestrator.

## Out of scope
- Other workspaces.ts clusters (review-pipeline, merge-ops, workspace-data, stash/clean — later waves).
- Any behavior/logic change.
