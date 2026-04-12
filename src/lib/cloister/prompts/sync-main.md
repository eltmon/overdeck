---
name: sync-main
description: Resolve merge conflicts when syncing origin/main into a workspace branch.
requires:
  - projectPath
  - workspaceBranch
  - issueId
  - conflictFiles
---
# Sync Main — Conflict Resolution

You are resolving git merge conflicts from merging `origin/main` into a workspace branch.

PROJECT: {{projectPath}}
WORKSPACE BRANCH: {{workspaceBranch}}
ISSUE: {{issueId}}

## Conflict Files

{{conflictFiles}}

## Instructions

### STEP 1 — Verify state

```bash
cd {{projectPath}}
git status
```

You should see the workspace is in a merge conflict state with the files listed above.

### STEP 2 — Resolve conflicts

For each conflicting file:

1. Read the file and find all conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. Resolve each conflict using your best judgment:
   - **Prefer main changes** when they represent hotfixes, security fixes, or important corrections
   - **Preserve feature work** when the feature branch changes are the active development
   - **Integrate both** when possible — merge the intent of both sides, don't just pick one
3. After resolving each file, stage it: `git add <file>`

### STEP 3 — Scan for leftover markers

After resolving all files, verify no conflict markers remain:

```bash
git diff --check
```

If this reports any remaining conflict markers, resolve them too and re-stage the files.

### STEP 4 — Commit the merge

```bash
git commit --no-edit
```

This uses the auto-generated merge commit message. Do NOT add a custom message.

### STEP 5 — Report result

**If successful**, output EXACTLY these lines (they are parsed programmatically):

```
MERGE_RESULT: SUCCESS
RESOLVED_FILES: <comma-separated list of files you resolved, or "none" if clean merge>
NOTES: <brief one-line summary of resolutions>
```

**If you cannot resolve** (truly irreconcilable conflicts), output EXACTLY:

```
MERGE_RESULT: FAILURE
FAILED_FILES: <comma-separated list of unresolvable files>
REASON: <why you could not resolve>
```

Then abort the merge:

```bash
git merge --abort
```

## Critical Rules

- **DO NOT** run any tests or builds — the feature branch is WIP and may have pre-existing failures
- **DO NOT** push to remote — this is a local workspace sync only
- **DO NOT** delete any branches
- **DO** output the `MERGE_RESULT:` line — it is parsed programmatically
- **DO** commit the merge when successful (`git commit --no-edit`)
- **DO** abort the merge if you cannot resolve (`git merge --abort`)
