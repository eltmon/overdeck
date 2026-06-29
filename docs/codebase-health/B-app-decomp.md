# B — Decompose `src/dashboard/frontend/src/App.tsx` (1,927 lines)

**Epic:** B · **Branch:** `codebase-health/app-decomp` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182.
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam; the orchestrator reviews + merges.

## Goal
Behavior-preserving decomposition of the 1,927-line React root `src/dashboard/frontend/src/App.tsx` into smaller pieces. Analyze it first, then extract cohesive clusters into sibling modules — typical seams for a root component:
- **providers/context wiring** → `App/providers.tsx` (or per-provider)
- **route/view configuration** → `App/routes.tsx`
- **layout / top-level chrome** sub-components → `App/<Name>.tsx`
- **large hooks / effect clusters** (keyboard shortcuts, global state wiring, polling) → `App/hooks/use<Name>.ts`

Pick the seams the actual structure supports; extract safest-first, commit per seam.

## Requirements
**FR-1** `App.tsx` keeps its existing export(s) (the default `App`); the rendered app is **behaviorally identical** (same providers, routes, layout, shortcuts).
**FR-2** Each new file < 1,000 lines (file-size guard); React hook rules respected (hooks top-level, called unconditionally).
**FR-3** Behavior-preserving — no UX/logic change, no renames of exported symbols.
**FR-4** Commit per seam (`refactor(dashboard): extract <seam> from App`).
**FR-5** After each seam: `npm run build` (Vite — catches import/type breakage) + `npm run lint` + **the FULL test suite** (`npx vitest run --configLoader runner`, 0 failed). Full suite mandatory. Repoint any test importing moved internals in the SAME commit.

**NFR-1** A1 ratchet: no NEW `any`; moved `any` → `eslint-any-allowlist.json` (don't convert).
**NFR-2** Don't duplicate state — keep shared state lifted in `App`, thread it down; extracted pieces are presenters/hooks.

## Acceptance criteria
- `App.tsx` materially smaller; behavior identical; default `App` export preserved.
- New `App/` modules each < 1,000 lines.
- `npm run build` + `npm run lint` + full `vitest run` exit 0.
- If stopped early, note done vs remaining.

## Intersecting rules
No bandaids; behavior-preserving; full-suite verify (NOT a subset); verify against this worktree's post-`main` code; A1 ratchet (moved `any`→allowlist); file-size guard; React hook rules; worktree discipline (branch = `codebase-health/app-decomp`; never `git checkout <branch>`/`git stash`); conventional commits lowercase subject, never `--no-verify`; **do NOT run `pan done` or open a PR** — report when green.
