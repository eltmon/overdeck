# PAN-333: Fix no-op merge detection and isRunning dead code

## Current Status: COMPLETE

## Summary

Two targeted fixes to `src/lib/cloister/merge-agent.ts`:

1. **No-op merge detection** (`spawnMergeAgentForBranches`): Added a `git merge-base --is-ancestor` check after pre-flight checks. Fetches origin refs first, then checks if `sourceBranch` is already an ancestor of `targetBranch`. If so, returns `{ success: true, reason: "already integrated" }` without spawning the merge specialist.

2. **`isRunning` dead code fix** (line ~1294): `isRunning` is `async` but was called without `await`, meaning the condition checked a truthy `Promise` object — always false (never triggering the dead-session error path). Also missing `mergeProjectKey` arg, so it checked the wrong tmux session. Fixed to `!(await isRunning('merge-agent', mergeProjectKey ?? undefined))`.

## Files Changed

- `src/lib/cloister/merge-agent.ts` — two fixes as described

## Remaining Work

None
