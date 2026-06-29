# B (wave 2) — Decompose `deacon.ts` into deep modules

**Epic:** B · **Branch:** `codebase-health/deacon-decomp` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam on this branch; the orchestrator reviews + merges.

---

## Glossary
- **`deacon.ts`** = `src/lib/cloister/deacon.ts` (~7,100 lines), the lifecycle-watchdog core. `runPatrol()` calls each `check*`/`reconcile*` function once per cycle. **B1 already extracted the inspect/timeout cluster** into `deacon-inspect.ts` — do not touch that.
- **Behavior-preserving move** = relocate code **verbatim** into a new sibling module + wire imports so runtime behavior is byte-identical. **No logic changes.**
- **Re-export** = `export { x } from './deacon-<seam>.js'` in `deacon.ts` so external importers keep working unchanged.
- **Notifier** = the callbacks `setAgentStoppedNotifier` / `setAgentStatusChangedNotifier` / `setMergeReadyNotifier` set by external code. **These setters/owners stay in `deacon.ts`** — extracted modules call them via imported functions, never own the subscription.

## Goal
Carve four cohesive clusters out of `deacon.ts` into sibling modules, **behavior-preserving**, to take it from ~7,100 lines toward ~3,000. Each seam is its own commit so it can be reviewed independently.

## Seams (extract in this order — safest first; commit per seam)

> For each: `grep -n` the function names to find exact boundaries, move them + the **module-level state Maps/Sets and constants they exclusively use** into the new file, add the imports the moved code needs, update `runPatrol`'s calls to the imported names, and re-export anything imported elsewhere. Verify after **each** seam (see Verification) before starting the next.

1. **`deacon-api-recovery.ts`** (MED) — `checkApiErrorAgents`, `maybeProactivelyCompactContext` + their state (`apiErrorRecoveryState`, `contextOverflowRecoveryState`, `contextProactiveCompactState`, `stuckOverflowNativeRecoveryState`) + the `API_ERROR_*` / `CONTEXT_*` constants.
2. **`deacon-review.ts`** (MED-HIGH) — the review-convoy cluster: `reviewConvoyLiveness`, `handleReviewCoordinatorDied`, `handleWorkCompleted`, `checkOrphanedReviewStatuses`, `recoverStalledReviewConvoys`, `checkMissingReviewStatuses`, `checkStuckReviewing`, `checkCompletedButUnsignaledReviews`, `monitorReviewConvoySignals`, `cleanupOrphanedReviewSessions`, `synthesizeReviewFromReports`, the reviewer-session-cleanup helpers, + state (`stalledReviewConvoyRecoveryState`, `reviewReportsPresentNudges`, `unsignaledReviewNudges`). **`mergeReadyNotifier` stays owned by `deacon.ts`** — call it via an imported function/param.
3. **`deacon-merge.ts`** (HIGH) — `checkReadyForMergeStuck`, `reconcileStaleMergeStatus`, `reconcileFalseMerged`, `reconcileClosedPrReadyForMerge`, `reconcileMergedButReviewing`, `checkFailedMergeRetry`, `autoCloseOut`, `checkFirstCompletionAgents` + their cooldown Maps/Sets + constants. `autoCloseOut`'s dynamic `import('postMergeLifecycle')` stays a dynamic import.
4. **`deacon-auto-resume.ts`** (VERY HIGH — do last, its own commit) — `recoverOrphanedAgents(+Once)`, `handleAgentHeartbeatDeadEvent`, `handleAgentStoppedEvent`, `autoResumeStoppedWorkAgents`, `reconcileAgentLiveness`, `nudgeStalledResumeWorkAgents`, `nudgeIdleWorkAgentsWithOpenBeads`, `cleanupOrphanedPlanningSessions`, `isRapidPostResumeDeath`, `isPreKickoffLaunchDeath` + state (`recoverOrphanedAgentsInFlight`, `orphanFailureRecordedForAutoResume`) + constants. Keep the notifier **setters** in `deacon.ts`; the moved code calls the notifier via an imported getter/param. Preserve the `getNoResumeMode()`/concurrency-gate calls exactly.

## Requirements
**FR-1** Each seam's functions live in its new module; `deacon.ts` imports them and `runPatrol` calls them unchanged (same order, same args).
**FR-2** Every symbol imported by any other file is re-exported from `deacon.ts` (verify with `grep -rn` before/after). No external import path changes.
**FR-3** Each seam is a separate commit (`refactor(cloister): extract <seam> from deacon.ts`).
**FR-4** After each seam: `npm run typecheck` + `npm run lint` + `npm run build` pass; deacon tests pass.

**NFR-1** Behavior-preserving only — no logic edits, no renames (Karpathy #3).
**NFR-2** No new explicit `any` (A1 ratchet live).
**NFR-3** **No import cycle**: extracted modules import from leaf modules (`agents.js`, `tmux.js`, `review-status.js`, etc.), **never from `deacon.ts`**. Cross-cluster shared helpers: leave the helper in `deacon.ts` and import it, OR move to a small shared `deacon-shared.ts`. If a clean break isn't possible for a seam, **commit the seams that worked and report the blocker** — do not force a cycle or change logic.

## Verification (run after EACH seam)
```
npm run typecheck && npm run lint && npm run build
# then deacon tests:
npx vitest run --configLoader runner $(grep -rl deacon tests/unit | tr '\n' ' ')
```
All green before the next seam. The full suite runs in CI on the PR.

## Acceptance criteria
- `deacon.ts` shrinks by roughly the moved clusters; `deacon-{api-recovery,review,merge,auto-resume}.ts` exist.
- `grep -rn` shows all externally-used symbols still resolve (via re-export).
- `npm run typecheck`/`lint`/`build` exit 0; deacon tests green.
- `git diff` for each seam is a pure move + import wiring (no logic change).

## Intersecting rules (restated)
No bandaids; surgical moves only; no `execSync` (server-reachable); async tmux only (`sendKeysAsync`); A1 ratchet (no new `any`); worktree discipline (verify `git branch --show-current` = `codebase-health/deacon-decomp`; never `git checkout <branch>`; never `git stash`); conventional commits, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers to the orchestrator (especially any forced import cycle in the review/merge/auto-resume seams).

## Out of scope
Harness-branch logic inside deacon (that's the separate Harness-interface effort); any logic/behavior change; `runPatrol` restructuring beyond swapping calls to imports.
