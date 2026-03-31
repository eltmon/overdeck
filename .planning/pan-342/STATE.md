# PAN-342: getWorkspaceCommitHashes is not a function

## Status: Planning Complete

## Problem
The `request-review` and `review` endpoints call `getWorkspaceCommitHashes` (imported from `src/lib/git-utils.ts`), but the function was never implemented. The dynamic import succeeds (module exists) but destructuring yields `undefined`, causing "is not a function" at invocation. The error is caught silently, so the review-agent proceeds without commit snapshot context.

## Root Cause
Commit `55ce4dc` added call sites for `getWorkspaceCommitHashes` in two places in `src/dashboard/server/index.ts` (lines 6984 and 7208) without implementing the function in `git-utils.ts`.

## Decision: Implement the missing function

### What to implement
`getWorkspaceCommitHashes(workspacePath: string): Promise<Record<string, string>>`

Returns a map like:
```json
{ "HEAD": "abc1234", "branch": "feature/PAN-333" }
```

### Implementation approach
- Add to `src/lib/git-utils.ts` using the existing `execAsync` pattern
- Run `git rev-parse HEAD` and `git rev-parse --abbrev-ref HEAD` in the workspace directory
- Return `{ HEAD: <sha>, branch: <branch-name> }`
- Export the function (call sites already use dynamic `import()` with destructuring)

### Files to modify
1. `src/lib/git-utils.ts` — add and export `getWorkspaceCommitHashes`

### No changes needed
- Call sites in `index.ts` (lines 6984-6985, 7208-7209) already use the correct name and expected return type
- `lastReviewCommits` field is stored in review status as `Record<string, string>` — matches the return type

## Difficulty: simple
- 1 file to modify
- ~15 lines of new code
- Follows existing `execAsync` + `git rev-parse` patterns used throughout codebase
- No cross-cutting concerns, low risk
