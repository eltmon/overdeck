# B — Decompose `src/lib/config-yaml.ts` (3,012 lines, 98 exports)

**Epic:** B · **Branch:** `codebase-health/configyaml-decomp` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182.
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam; the orchestrator reviews + merges.

## Goal
Behavior-preserving decomposition of the 3,012-line `src/lib/config-yaml.ts` into focused submodules. Analyze the file first (it has ~98 exports: types/interfaces, schema, loaders, validators, defaults, per-domain config helpers). Group cohesive concerns into submodules under `src/lib/config-yaml/` and move them there, then make **`config-yaml.ts` a re-export barrel**.

## CRITICAL — re-export facade (FR-1)
`config-yaml.ts` has ~98 exports consumed across the codebase. **Every existing export name MUST remain exported from `src/lib/config-yaml.ts`** (via `export * from './config-yaml/<module>.js'` or explicit re-exports). Do NOT change import paths at call sites — the barrel keeps them working. Verify: `git grep -l "from '.*config-yaml'" src | wc -l` importers still compile.

## Requirements
**FR-1** Existing public exports all still resolve from `config-yaml.ts` (barrel). Zero call-site import changes required.
**FR-2** Cohesive submodules under `src/lib/config-yaml/` (e.g. `types.ts`, `schema.ts`, `load.ts`, `validate.ts`, `defaults.ts`, + per-domain as the structure suggests). Each new file < 1,000 lines (file-size guard).
**FR-3** Behavior-preserving — pure moves + re-exports; no logic edits, no renames of exported symbols.
**FR-4** Commit per seam (`refactor(config): extract <concern> from config-yaml`).
**FR-5** After each seam: `npm run typecheck` + `npm run lint` + **the FULL test suite** (`npx vitest run --configLoader runner`, 0 failed). The full suite is mandatory (a prior decomposition went red on main from a partial run). Repoint any test that imports/introspects moved internals in the SAME commit.

**NFR-1** A1 ratchet: no NEW explicit `any`; for `any` that MOVES with extracted code, add the new file to `eslint-any-allowlist.json` (don't convert). No `execSync` (async only).
**NFR-2** If extraction would create an import cycle, prefer a small shared `types.ts`; if unavoidable, report.

## Acceptance criteria
- `config-yaml.ts` materially smaller, now a barrel; all ~98 exports still exported from it.
- New `config-yaml/` submodules, each < 1,000 lines.
- typecheck + lint + full `vitest run` exit 0; each seam a behavior-preserving move.
- If stopped early (context), note done vs remaining.

## Intersecting rules
No bandaids; behavior-preserving; full-suite verify (NOT a subset); verify against this worktree's post-`main` code; A1 ratchet (moved `any`→allowlist); file-size guard; worktree discipline (branch = `codebase-health/configyaml-decomp`; never `git checkout <branch>`/`git stash`); conventional commits lowercase subject, never `--no-verify`; **do NOT run `pan done` or open a PR** — report when green.
