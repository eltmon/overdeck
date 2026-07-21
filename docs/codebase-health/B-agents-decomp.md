# B (wave 2) — Decompose `agents.ts` into deep modules

**Epic:** B · **Branch:** `codebase-health/agents-decomp` (off `main`) · **Executor:** Kimi-k2.7-code (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam; the orchestrator reviews + merges.

---

## Glossary
- **`agents.ts`** = `src/lib/agents.ts` (~5,600 lines), the agent lifecycle/state library, imported by ~155 files (almost all via `from '.../agents.js'`). **B3 already extracted the read-only queries** into `agents/queries.ts` — follow that exact pattern (move + re-export from `agents.ts`) and don't touch it.
- **state-write guard** = `scripts/lint-state-writes.sh` (run by `npm run lint`) whitelists `writeAgentStateJsonSync` **in `src/lib/agents.ts`** as the only approved agent-state writer. **Never move that function or any state writer** — it would turn `lint:state-writes` red. The seams below are all non-writer clusters.
- **Behavior-preserving move + re-export** = relocate functions verbatim into `agents/<seam>.ts`, import what they need, and `export { ... } from './agents/<seam>.js'` in `agents.ts` so all ~155 importers keep working.

## Goal
Carve four cohesive, non-writer clusters out of `agents.ts` into `agents/*.ts` submodules, behavior-preserving. Each seam its own commit.

## Seams (extract in this order — safest first; commit per seam)
1. **`agents/termination.ts`** (LOW) — `stopAgentSync`, `stopAgent`, `killLauncherProcessSync`, `killLauncherProcessAsync`, `isTmuxProcessSync`. (They read state via `getAgentStateSync` and may call `saveAgentStateSync` to mark status — import those from `agents.ts`; do NOT move the writers.)
2. **`agents/activity.ts`** (LOW) — `ActivityEntry`, `appendActivity`, `getActivity`, `saveSessionId`, `getSessionId`, `getLatestSessionIdSync`, `getLatestSessionId` + their private helpers.
3. **`agents/runtime-state.ts`** (MED) — `AgentRuntimeState`, `getAgentRuntimeStateSync`, `getAgentRuntimeState`, `saveAgentRuntimeState`, `patchRuntimeJson` + helpers. (This writes `runtime.json`, a *different* file from `agent-state.json`, so the state-write guard does **not** apply — but keep the single-writer shape.)
4. **`agents/delivery.ts`** (LOW-MED) — `deliverAgentMessage`, `deliverResumeMessageWithTranscriptConfirmation`, `deliverAgentPermissionDecision`, `setAgentDeliveryMethod` + their private helpers (socket POST, channel-log, retry, transcript-landing wait). Imports `getAgentStateSync` (read) from `agents.ts`.

## Requirements
**FR-1** Each seam's functions live in `agents/<seam>.ts`; imports come from `agents.ts` (readers like `getAgentStateSync`) and leaf modules (`tmux.js`, etc.).
**FR-2** `agents.ts` re-exports every moved function so all importers keep resolving (verify `grep -rn` before/after).
**FR-3** **No state writer moved** — `npm run lint` must still print `state-write lint passed (single write surface intact)`.
**FR-4** Each seam a separate commit (`refactor(agents): extract <seam> from agents.ts`).
**FR-5** After each seam: `npm run typecheck` + `npm run lint` + `npm run build` pass; agent tests pass.

**NFR-1** Behavior-preserving only — no logic edits, no renames.
**NFR-2** No new explicit `any` (A1 ratchet live).
**NFR-3** Circular import: `agents.ts` re-exports from `agents/<seam>.ts` while those import readers from `agents.ts` — a cycle the bundler tolerates (B3 did exactly this). **Verify `npm run build` succeeds** (the real cycle check); if it throws a runtime ESM-cycle error, **stop and report** — don't change logic to paper over it.

## Verification (after EACH seam)
```
npm run typecheck && npm run lint && npm run build
npx vitest run --configLoader runner $(grep -rl "agents" tests/unit | tr '\n' ' ')
```
Confirm `lint:state-writes` passed. Full suite runs in CI.

## Acceptance criteria
- `agents.ts` shrinks; `agents/{termination,activity,runtime-state,delivery}.ts` exist and are re-exported.
- `npm run lint` exit 0 incl. the state-write guard line; typecheck/build exit 0; agent tests green.
- Each seam's `git diff` is a pure move + re-export.

## Intersecting rules (restated)
state-write guard (never move a writer); no bandaids; surgical moves; no `execSync`; async tmux only; A1 ratchet (no new `any`); worktree discipline (branch = `codebase-health/agents-decomp`; never `git checkout <branch>` / `git stash`); conventional commits, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers.

## Out of scope
The spawn path (`spawnAgent`/`spawnRun`), provider/model resolution, and the Pi/Codex harness helpers — those are reserved for the separate **Harness interface** effort (don't extract or move them here). Any logic change. The already-extracted `queries.ts`.
