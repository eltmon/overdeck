# PAN-475: Enforce PR-based workflow — require reviews before merge

## Status: Planning Complete

## Problem

Overdeck's merge workflow operates locally via `git merge` for local workspaces, bypassing GitHub PRs entirely. This causes:

1. **Incomplete work reaches main uncaught** — PAN-470 shipped with 4/13 route files unwrapped because no PR review existed
2. **Hotfixes on main get wiped** — merge agent's `git restore .` destroys uncommitted working-tree fixes (happened twice in one session)
3. **No audit trail** — direct-to-main commits have no PR comments, no CI record, no review history

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Merge style | `gh pr merge --squash` | Clean one-commit-per-feature history; matches existing remote workspace behavior |
| Review output | Both GitHub PR reviews + feedback files | GitHub reviews create audit trail + satisfy branch protection; files enable agent-to-agent feedback |
| PR creation timing | On `pan work done` (completion) | No draft PR noise; review agent sees final diff |
| CI lint strictness | Remove `\|\| true`, lint failures block PR | Matches quality gates agents enforce locally |
| Incomplete work detection | Extend correctness convoy reviewer | No new sub-agent; add consistency checks to existing correctness prompt |
| Conflict handling | Rebase feature branch on main before merge | Clean PR; `gh pr merge --squash` requires no conflicts |

## Scope

### In scope
- Replace local `git merge` in `triggerMerge()` with `gh pr create` + `gh pr merge --squash` for ALL workspaces
- `pan work done` creates PR with rich description (issue link, beads summary, AC checklist)
- Review agent posts GitHub PR review (`gh pr review --approve` / `--request-changes`) in addition to feedback files
- Extend correctness convoy reviewer prompt for consistency/completeness checks
- Fix CI workflow: remove `|| true` on lint, add `npm test` (currently only runs CLI smoke test)
- Update CONTRIBUTING.md to reference new PR workflow

### Out of scope
- Branch protection rules on main (PAN-505 — runs immediately after this merges)
- Polyrepo merge path changes (low priority, can follow same pattern later)
- Remote workspace merge path (already uses `gh pr merge`)

## Architecture

### Current flow (local workspaces)
```
pan work done → push branch → specialist pipeline (review → test) → MERGE button
  → triggerMerge() → push branch → spawnMergeAgentForBranches()
  → merge-agent does local git merge in main repo → push to remote
```

### New flow
```
pan work done → push branch → gh pr create → specialist pipeline (review → test)
  → review-agent posts gh pr review on PR → MERGE button
  → triggerMerge() → rebase feature on main → gh pr merge --squash
  → postMergeLifecycle() (unchanged)
```

### Key changes by file

| File | Change |
|------|--------|
| `src/dashboard/server/routes/workspaces.ts` | `triggerMerge()`: replace local merge with `ensurePRExists()` + rebase + `gh pr merge --squash` for all workspaces. Expand `ensurePRExists()` to generate rich PR body. |
| `src/lib/cloister/merge-agent.ts` | `buildMergePrompt()`: rewrite to instruct merge-agent to rebase + verify + use `gh pr merge` instead of local merge. Or: eliminate merge-agent specialist entirely and do PR merge in `triggerMerge()` directly. |
| `src/lib/cloister/review-agent.ts` | After convoy synthesis, post result as GitHub PR review via `gh pr review` |
| `src/lib/cloister/prompts/review-agent.md` | No changes needed (review-agent.ts handles GitHub posting) |
| `src/lib/cloister/prompts/work-agent.md` | Update completion instructions to mention PR creation |
| `.github/workflows/ci.yml` | Remove `\|\| true` on lint; add real test step (`npm test`); add typecheck as required check |
| `CONTRIBUTING.md` | Update merge workflow section to reflect PR-based flow |

### Design decision: Merge agent role

The merge agent currently does heavy lifting (local merge, conflict resolution, build, test, push). With PR-based merge:

- **Conflict resolution** moves to a rebase step before `gh pr merge`
- **Build + test validation** moves to CI (GitHub Actions)
- **The actual merge** is `gh pr merge --squash` (one API call)

The merge agent specialist is still useful for **rebase + conflict resolution** (which can be complex). The flow becomes:

1. `triggerMerge()` calls merge-agent to rebase feature branch on main
2. Merge-agent resolves any conflicts, pushes rebased branch
3. `triggerMerge()` then calls `gh pr merge --squash`
4. `postMergeLifecycle()` runs as before

This keeps the merge agent for the hard part (conflicts) while using GitHub API for the safe part (merge).

## Edge cases

1. **PR already exists** — `ensurePRExists()` already handles this (returns existing PR URL)
2. **CI fails after rebase** — `gh pr merge` will fail if required checks don't pass; return error to dashboard
3. **Merge conflicts during rebase** — merge-agent handles resolution, then pushes; if unresolvable, fail with clear error
4. **Bootstrap: PAN-475 itself** — merges via old direct-merge path (noted in issue); this is expected and acceptable
5. **Multiple merge attempts** — existing `mergeStatus: 'merging'` guard prevents concurrent merges
