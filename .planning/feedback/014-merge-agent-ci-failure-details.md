---
specialist: merge-agent
issueId: PAN-611
outcome: ci-failure
timestamp: 2026-04-13T06:52:00Z
---

## CI Check Failure — Root Cause: Gitignored Source Files

GitHub PR #684 CI is failing because `.gitignore` line 42 contains the pattern `src/lib/**/*.js`, which **excludes all `.js` files under `src/lib/` from git**. This includes the `src/lib/caveman/*.js` files that the CI build step tries to copy.

On a clean checkout (like CI), these files don't exist — the `cp` step fails because there's nothing to copy.

### Root Cause

`.gitignore:42`:
```
src/lib/**/*.js
```

This was added to prevent compiled TypeScript output from being committed, but it also matches `src/lib/caveman/*.js` which are **source files** (hand-written JS, not compiled output).

### Action Required

**Option 1 (preferred)**: Add a negation rule to `.gitignore` so caveman JS files are tracked:

```gitignore
# After the src/lib/**/*.js line, add:
!src/lib/caveman/*.js
```

Then commit the caveman JS files that were previously untracked:

```bash
git add -f src/lib/caveman/*.js
git add .gitignore
git commit -m "fix: track caveman JS source files excluded by gitignore"
git push
```

**Option 2**: Move the caveman JS files to a different path not covered by the gitignore pattern (e.g., `src/lib/caveman/src/*.js`), and update all imports.

After pushing, run `pan work done PAN-611` to re-trigger the review pipeline.
