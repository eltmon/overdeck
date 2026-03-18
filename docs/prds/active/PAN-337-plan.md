# PAN-337: Planning Artifacts Leak to Main

## Status: PLANNED

## Problem

`.planning/` artifacts (STATE.md, feedback files, PRD.md, PLANNING_PROMPT.md, .planning-complete) are committed to feature branches. When merged to main, they pollute every subsequent workspace. The merge-agent prompt instructs `git rm --cached .planning/` but this is an unreliable LLM instruction — not programmatic.

## Decisions

### 1. Programmatic cleanup in `postMergeLifecycle()`

Add a new step after PRD archival that removes ephemeral planning files from main:

**Files to remove:**
- `.planning/STATE.md`
- `.planning/PRD.md`
- `.planning/PLANNING_PROMPT.md`
- `.planning/.planning-complete`
- `.planning/feedback/*.md`

**Implementation:** New lifecycle module `src/lib/lifecycle/clean-planning.ts` following the same `StepResult` pattern as `archive-planning.ts` and `compact-beads.ts`. Called from `postMergeLifecycle()` after PRD move, before issue close.

**Commit strategy:** Separate commit: `chore: remove ephemeral planning state after <issueId> merge`

### 2. Belt-and-suspenders: .gitignore

Add these entries to `.gitignore`:
```
.planning/STATE.md
.planning/PRD.md
.planning/PLANNING_PROMPT.md
.planning/.planning-complete
.planning/feedback/
```

Feature branches that need to track these files use `git add -f`. This prevents accidental re-commits even if the cleanup step fails.

### 3. Update planning code to use `git add -f`

Any code that commits planning artifacts to feature branches must use `git add -f` since these files will now be gitignored.

### 4. Ordering in postMergeLifecycle()

```
1. Move PRD (existing)
2. Clean planning artifacts (NEW)  <-- after PRD archive, before issue close
3. Close issue (existing)
4. Compact beads (existing)
```

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/lifecycle/clean-planning.ts` | **NEW** — cleanup function following StepResult pattern |
| `src/lib/cloister/merge-agent.ts` | Add `cleanPlanning()` call in `postMergeLifecycle()` |
| `.gitignore` | Add ephemeral planning file entries |
| Planning code that commits STATE.md etc. | Use `git add -f` for gitignored files |

## Scope

**In scope:**
- Programmatic cleanup of ephemeral planning files after merge
- .gitignore belt-and-suspenders
- Updating `git add` to `git add -f` where needed

**Out of scope:**
- Changing how .planning/ works on feature branches
- Restructuring .planning/ into per-issue subdirectories
- Retroactively cleaning main (first merge after this fix will clean it up naturally)

## Risk Assessment

**Low risk.** This is a housekeeping step added to an existing, well-tested lifecycle. The cleanup runs after merge validation passes, so it can't break the merge itself. Worst case: cleanup step fails silently (try/catch), and we're no worse off than today.
