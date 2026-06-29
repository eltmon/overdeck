# Housekeeping — bring the roadmap doc current (batch done 2026-06-28)

**Branch:** `codebase-health/housekeep-roadmap` · **Executor:** GPT-5.5 (handoff), supervised by conv #182.
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit on this branch; the orchestrator reviews + merges.

## Task
Update `docs/CODEBASE-HEALTH-ROADMAP.md` (read it first) so it reflects what actually landed on `main` today. Mark the completed epics DONE with PR numbers, add the red-main incident + lessons, and list what remains. Keep the doc's existing structure/voice; this is a status refresh, not a rewrite.

## Facts to record (all merged to origin/main 2026-06-28, CI green)
- **Epic A (ratchets) — DONE:** no-explicit-any ratchet (#2113), ts-reset (#2114), file-size guard (#2115).
- **Epic B (deep-module decomposition) — backend god files DONE:**
  - `src/lib/cloister/deacon.ts` → 8 modules (#2122)
  - `src/lib/agents.ts` → 4 modules (#2123)
  - `src/dashboard/server/routes/workspaces.ts` → 6 modules: `workspaces/{workspace-data,stash-clean,review-pipeline,review-control,container-ops,merge-ops}.ts` (wave-1 #2117/#2119, wave-2 #2122–#2124, merge-ops #2126)
- **Epic B — frontend god files DONE:**
  - `SettingsPage.tsx` (4,200 lines) → 6 seams: autosave + conversation-search hooks, voice / conversation-search / provider-management / tts sections (#2127)
  - `KanbanBoard.tsx` (3,017 lines) → 6 seams: utils, badges, dialogs, drag-drop hook, cards+columns, filter-bar (#2128)
- **Epic C (evals) — foundation DONE:** evalite harness + `npm run eval` + first eval (#2121).
- **Epic E Tier 1 — DONE:** `myn` database name de-hardcoded → config-driven `database.name` + `seedVerifyQuery` in workspace config (#2125).
- **Red-main incident (resolved, #2129):** the workspaces decomposition (#2124) moved review routes into `routes/workspaces/review-pipeline.ts` / `review-control.ts`, breaking 9 source-introspection tests in `tests/lib/cloister/review-agent.test.ts` that grepped `workspaces.ts` for that code. Fixed by repointing the tests (no assertions weakened). **Lessons:** run the FULL test suite before merge (not just typecheck/lint/build); verify against `origin/main` HEAD, not a stale local checkout; when decomposing a file, repoint its source-introspection tests in the same PR.

## Remaining (mark as not-yet-done / in-progress)
- **Epic B — Harness interface:** ~117 `harness ===/!==` conditionals → consolidate behind the existing `src/lib/runtimes/` seam (IN PROGRESS, `codebase-health/harness-interface`).
- Remaining large files: `config-yaml.ts` (~3k), `App.tsx` (~1.9k).
- **Epic E Tier 2:** move the MYN Flyway/Postgres repair machinery out of core (config-command vs plugin).
- **Epic D:** process gates (one-migration-at-a-time, design gate).

## Verify / acceptance
- `docs/CODEBASE-HEALTH-ROADMAP.md` reflects the above; internal cross-references stay valid.
- Diff touches ONLY `docs/CODEBASE-HEALTH-ROADMAP.md` (+ this brief). No code changes → no build needed, but run `npm run lint` if the repo lints markdown (skip if it doesn't).
- Conventional commit, lowercase subject (e.g. `docs(codebase-health): mark epics a/b/c/e-tier1 done`). Never `--no-verify`.
- **Do NOT run `pan done` or open a PR** — report when committed.
