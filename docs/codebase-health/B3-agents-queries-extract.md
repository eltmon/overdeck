# B3 — Extract read-only agent queries out of `agents.ts`

**Epic:** B (Carve deep modules) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/b3` (stacked on `codebase-health/b-kickoff` → main) · **Executor:** Kimi-k2.7-code (handoff), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR, do NOT touch the pipeline.** Commit on this branch; the orchestrator reviews and merges.

---

## Glossary
- **God file** — `src/lib/agents.ts` is ~5,824 lines, the core agent lifecycle/state library, imported by ~155 files (almost all via `from '.../agents.js'`).
- **Read-only queries** — functions that *enumerate / inspect* agents without writing any state. The safest possible thing to extract: no writers move, so the state-write lint guard is untouched.
- **state-write guard** — `scripts/lint-state-writes.sh` (run by `npm run lint`) whitelists `writeAgentStateJsonSync` **in `src/lib/agents.ts`** as the only approved agent-state writer. B3 must **not** move that function (or any writer). Read-only queries don't touch it, so the guard stays green.
- **Re-export** — `export { x } from './agents/queries.js'` in `agents.ts`, so the ~155 importers that do `import { listRunningAgents } from '.../agents.js'` keep working with zero changes.

## Problem
`agents.ts` is the third-largest file and the most widely-imported. B3 extracts the **read-only query cluster** — the cleanest, lowest-risk seam (no state writes, no spawn logic) — to begin decomposing it without touching the lint-guarded writers or the spawn path.

## Scope — the cluster to extract
Locate by name (`grep -n`); approximate region ~lines 4200–4415, but **use names, not line numbers**:
- `listRunningAgentsSync`
- `listAgentStates`
- `listRunningAgents`
- `warnOnBareNumericIssueIds`
- `dropLegacyAgentStatesMissingRoleAsync`
- any private helper used **only** by the above (verify with `grep`).

Do **NOT** move: `writeAgentStateJsonSync`, `saveAgentStateSync`, `saveAgentState`, `getAgentStateSync`, or anything that writes state. `getAgentStateSync` is a *reader* but is imported by the queries and by ~33 other call sites — **leave it in `agents.ts`** and import it into `queries.ts`.

Target module: `src/lib/agents/queries.ts` (create the `agents/` subdirectory).

## Requirements
**FR-1** — The read-only query functions live in `src/lib/agents/queries.ts`.
**FR-2** — `queries.ts` imports what it needs from `agents.ts` (e.g. `getAgentStateSync`) and from leaf modules (`tmux.js` `sessionExists`/`sessionExistsSync`, overdeck rollback-state readers).
**FR-3** — `agents.ts` re-exports every moved function (`export { listRunningAgents, listRunningAgentsSync, listAgentStates, warnOnBareNumericIssueIds, dropLegacyAgentStatesMissingRoleAsync } from './agents/queries.js'`) so all ~155 existing importers keep resolving unchanged.
**FR-4** — The state-write guard stays green: `npm run lint` (which runs `scripts/lint-state-writes.sh`) passes. No writer moved.
**FR-5** — Behavior unchanged: `npm run typecheck`, `npm run lint`, `npm run build` pass; no test green on `main` now fails.

**NFR-1** — Behavior-preserving only — pure move + re-export, no logic edits, no renames (Karpathy #3).
**NFR-2** — No new explicit `any` (A1 ratchet live).
**NFR-3** — Circular import: `agents.ts` re-exports from `queries.ts`, and `queries.ts` imports `getAgentStateSync` from `agents.ts` — this is a cycle. The repo bundles with tsdown (which resolves cycles) and already contains cycles, and vitest tolerates them, so it should be fine. **Verify `npm run build` succeeds** (this is the real cycle check). If the build throws an actual ESM-cycle error at runtime, **stop and report to the orchestrator** — do not paper over it.

## Steps
1. `grep -n` the five functions in `agents.ts`; `grep -rn` each across `src/` to confirm read-only and find importers (all should resolve via the `agents.ts` re-export after the move).
2. Create `src/lib/agents/queries.ts`; move the functions + their exclusive private helpers; add imports (`getAgentStateSync` from `../agents.js`, tmux readers, etc.).
3. In `agents.ts`: delete the moved code; add the re-export line (FR-3).
4. Verify (FR-4/FR-5): `npm run typecheck && npm run lint && npm run build`, then run agent-related tests (`grep -rl "agents" tests/unit | head`) — all green. Explicitly confirm `lint:state-writes` passed (it's part of `npm run lint`).

## Acceptance criteria
- **AC-1 (FR-1/3):** `agents/queries.ts` holds the queries; `agents.ts` re-exports them; `grep -rn 'listRunningAgents' src/` shows callers still resolve.
- **AC-2 (FR-4):** `npm run lint` exits 0 — including the `state-write lint passed (single write surface intact)` line. No state writer was moved.
- **AC-3 (FR-5/NFR-3):** `npm run typecheck`, `npm run build` exit 0; agent tests green.
- **AC-4 (NFR-1):** diff is a pure move + re-export; no logic change.

## Intersecting repo rules (restated)
- **state-write guard:** never move `writeAgentStateJsonSync` or any writer out of `agents.ts` — it would turn `lint:state-writes` red. B3 moves readers only.
- **A1 `no-explicit-any` ratchet is live** — no new `any`.
- **No `execSync`** in server-reachable code — preserve async patterns.
- **Surgical, behavior-preserving** — move + re-export only.
- **Worktree discipline:** verify `git branch --show-current` = `codebase-health/b3`; never `git checkout <branch>`; never `git stash`.
- **Commit per step**, conventional commits, never `--no-verify`. Suggested: `refactor(agents): extract read-only queries to agents/queries.ts`.
- **Do NOT run `pan done` / open a PR.** Report blockers (especially a real build-breaking cycle) to the orchestrator.

## Out of scope
- Moving any state writer or the spawn path (later waves / never for the guard'd writer without coordination).
- Other agents.ts clusters (termination, delivery, runtime-state, recovery — later waves).
- Any behavior/logic change.
