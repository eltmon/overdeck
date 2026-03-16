# PAN-325: Filter Quality Gates by Repo Path in Polyrepo Merges

## Current Status: COMPLETE

## Summary

Added polyrepo path filtering to `runProjectQualityGates()` in `merge-agent.ts`. In a polyrepo
merge, each sub-repo merge only runs quality gates whose `path` field matches the relative sub-repo
path. Gates without a `path` field are skipped in polyrepo context. Monorepo behavior is unchanged
(all gates run when `projectPath === project.path`).

## Implementation

### Task 1: `src/lib/cloister/merge-agent.ts`
- Added `relative` import from `path`
- Exported `runProjectQualityGates` (previously unexported)
- Added polyrepo filtering logic: compute `repoRelPath = relative(project.path, projectPath)`;
  if non-empty and not a `..` path, filter gates to only those with `gate.path === repoRelPath`
- Added console logging for polyrepo gate runs ("Polyrepo: running N gate(s) for path X")

### Task 2: `tests/unit/lib/cloister/merge-agent-quality-gates.test.ts` (NEW)
- 4 tests covering:
  1. Monorepo: all gates run unchanged
  2. Polyrepo: only matching-path gates run
  3. Polyrepo: gates with non-matching path are skipped
  4. Polyrepo: gates with no path are skipped

### Task 3: `configuration/polyrepo.mdx`
- Added "Quality Gates in Polyrepo Projects" section with:
  - Explanation of path-based filtering
  - Filtering behavior table
  - Full YAML configuration example with per-repo and global gates
  - Note on exact path matching requirement

## Files Changed
- `src/lib/cloister/merge-agent.ts` — filtering logic + export
- `tests/unit/lib/cloister/merge-agent-quality-gates.test.ts` — new tests (4/4 pass)
- `configuration/polyrepo.mdx` — quality gates documentation

## Remaining Work
None
