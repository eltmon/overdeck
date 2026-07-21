# B1 — Extract the inspect/timeout cluster out of `deacon.ts`

**Epic:** B (Carve deep modules) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/b1` (stacked on `codebase-health/b-kickoff` → main) · **Executor:** GPT-5.5 (handoff), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR, do NOT touch the pipeline.** Commit on this branch; the orchestrator reviews and merges.

---

## Glossary
- **God file** — `src/lib/cloister/deacon.ts` is ~7,180 lines (the orchestrator core). This is the first, deliberately *small* and *low-risk* extraction to prove the pattern before the scary seams (merge, auto-resume).
- **Behavior-preserving extraction** — move code verbatim into a new module and re-wire imports so runtime behavior is byte-identical. No logic changes.
- **Re-export** — `export { x } from './new-module.js'` in `deacon.ts` so any external importer of `deacon.ts` keeps working unchanged.
- **The patrol** — `runPatrol()` in `deacon.ts` calls each check function once per cycle.

## Problem
`deacon.ts` is the single largest, highest-cognitive-load file in the repo and the home of most recurring failure modes. We are decomposing it into deep modules. B1 extracts the **smallest self-contained cluster** — inspection/bead-timeout management — to validate the extraction pattern with near-zero risk.

## Scope — the cluster to extract
The inspect/timeout functions (locate by name with `grep -n`; the approximate region is ~lines 759–849, but **use the names, not the line numbers**, which drift):
- `checkInspectAgentTimeouts` (the exported check called from `runPatrol`)
- `inspectSessionName` (private helper)
- `formatInspectElapsed` (private helper)
- the `INSPECT_TIMEOUT_MS` constant
- any other symbol used **only** by the above (verify with `grep` that nothing else in `deacon.ts` references it before moving)

## Requirements
**FR-1** — A new module `src/lib/cloister/deacon-inspect.ts` contains the inspect/timeout cluster verbatim.
**FR-2** — `deacon.ts` imports `checkInspectAgentTimeouts` from `./deacon-inspect.js` and calls it in `runPatrol` exactly as before (same call site, same arguments, same ordering).
**FR-3** — If any file **outside** `deacon.ts` imports a moved symbol, `deacon.ts` re-exports it (`export { … } from './deacon-inspect.js'`) so no external import path changes. (Check with `grep -rn "checkInspectAgentTimeouts\|INSPECT_TIMEOUT_MS" src/` before and after.)
**FR-4** — Runtime behavior is unchanged: `npm run typecheck`, `npm run lint`, and `npm run build` all pass, and no test that passed on `main` now fails.

**NFR-1** — Behavior-preserving only. No logic edits, no renames, no "improvements" (Karpathy rule #3). The moved code is identical except for added imports it now needs at the top of the new file.
**NFR-2** — No new explicit `any` (the A1 ratchet is live on this branch; `npm run lint` enforces it).
**NFR-3** — No circular import: `deacon-inspect.ts` should import only from leaf modules it actually uses (e.g. `agents.js`, `tmux.js`, `effect`). It must **not** import from `deacon.ts`. If the cluster genuinely needs a symbol that lives in `deacon.ts`, pass it as a function argument instead — or, if that's not clean, **stop and report to the orchestrator** rather than creating a `deacon.ts ↔ deacon-inspect.ts` cycle.

## Steps
1. `grep -n 'checkInspectAgentTimeouts\|inspectSessionName\|formatInspectElapsed\|INSPECT_TIMEOUT_MS' src/lib/cloister/deacon.ts` to get exact ranges and confirm the cluster boundary.
2. `grep -rn 'checkInspectAgentTimeouts\|INSPECT_TIMEOUT_MS' src/` to find external importers (determines what to re-export per FR-3).
3. Create `src/lib/cloister/deacon-inspect.ts`; move the functions + constant verbatim; add the imports they need at the top.
4. In `deacon.ts`: delete the moved code, add `import { checkInspectAgentTimeouts } from './deacon-inspect.js';` (plus any others `runPatrol` calls), and the re-export line if FR-3 applies.
5. Verify (FR-4): `npm run typecheck && npm run lint && npm run build`, then run the deacon-related tests (`grep -rl deacon tests/ | head` to find them) — they must pass.

## Acceptance criteria
- **AC-1 (FR-1/2):** `deacon-inspect.ts` exists with the cluster; `runPatrol` calls `checkInspectAgentTimeouts` via the import.
- **AC-2 (FR-3):** `grep -rn 'checkInspectAgentTimeouts' src/` shows external callers still resolve (via re-export or direct import).
- **AC-3 (FR-4/NFR-3):** `npm run typecheck`, `npm run lint`, `npm run build` all exit 0; deacon tests green.
- **AC-4 (NFR-1):** `git diff` shows the moved lines are identical (a pure move + import wiring), no logic change.

## Intersecting repo rules (restated)
- **No bandaids / surgical changes:** pure move; every changed line traces to the extraction.
- **A1 `no-explicit-any` ratchet is live** — don't add `any`.
- **No `execSync` in server-reachable code** — the moved code already complies; don't introduce it.
- **Async tmux only** (`sendKeysAsync`, never `sendKeys`) — preserve whatever the code already uses.
- **Worktree discipline:** verify `git branch --show-current` = `codebase-health/b1` before editing; never `git checkout <branch>`; never `git stash`.
- **Commit per step**, conventional commits, never `--no-verify`. Suggested: `refactor(cloister): extract inspect-timeout cluster to deacon-inspect.ts`.
- **Do NOT run `pan done` / open a PR.** Report blockers (especially any circular-import surprise) to the orchestrator.

## Out of scope
- Any other deacon cluster (api-recovery, review, merge, auto-resume — later waves).
- Any behavior/logic change. This is a move only.
