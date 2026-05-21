---
name: merge
description: Merge-agent prompt — sync target, attempt merge, optionally build/test/push, report status via API.
requires:
  - ISSUE_ID
  - SOURCE_BRANCH
  - TARGET_BRANCH
  - PROJECT_PATH
  - DO_PUSH
  - DO_BUILD
  - API_URL
optional:
  - SKIP_DONE_REPORT
  - IS_POLYREPO
  - POLYREPO_DIRS
  - PR_URL
  - MEMORY_CONTEXT
---
# Merge Task — {{ISSUE_ID}}

- **Issue:** {{ISSUE_ID}}
- **Source branch:** {{SOURCE_BRANCH}}
- **Target branch:** {{TARGET_BRANCH}}
- **Project path:** {{PROJECT_PATH}}
{{#PR_URL}}- **PR URL:** {{PR_URL}}
{{/PR_URL}}
{{#IS_POLYREPO}}
**POLYREPO project** — git repos in subdirectories: {{POLYREPO_DIRS}}.
The workspace root is NOT a git repo. You must `cd` into each subdirectory to run git commands, and you MUST complete the merge for ALL repos.
{{/IS_POLYREPO}}

{{#MEMORY_CONTEXT}}
## Memory Context

{{MEMORY_CONTEXT}}
{{/MEMORY_CONTEXT}}

## PHASE 1 — SYNC & BASELINE (before merge)

1. `cd {{PROJECT_PATH}}`
2. `git checkout {{TARGET_BRANCH}}`
3. `git fetch origin {{TARGET_BRANCH}}`
4. Sync local `{{TARGET_BRANCH}}` with `origin/{{TARGET_BRANCH}}`:
   - Run: `git rev-list --left-right --count {{TARGET_BRANCH}}...origin/{{TARGET_BRANCH}}`
     (Output: `LOCAL_AHEAD  REMOTE_AHEAD`. If REMOTE_AHEAD > 0, local is behind origin.)
   - If local is behind origin (REMOTE_AHEAD > 0):
     a. `git rebase origin/{{TARGET_BRANCH}}`
        (Replays local commits on top of origin — preserves linear history, no merge commits, no data loss.)
     b. If rebase conflicts: `git rebase --abort`, then STOP — human intervention needed.
     c. If rebase succeeds: continue.
   - If local is up-to-date or ahead-only: continue.
5. Run tests on the CURRENT `{{TARGET_BRANCH}}` to establish a baseline:
   - Use the Task tool with `subagent_type="Bash"` to run: `npm test 2>&1 || true`
   - Record passing/failing counts as `BASELINE_PASS` and `BASELINE_FAIL`.
   - This baseline is critical — you will compare post-merge results against it.

## PHASE 2 — MERGE

6. `git merge {{SOURCE_BRANCH}}`
7. If clean merge: the merge commit is auto-created (or fast-forward). Continue to Phase 3.
8. If conflicts:
   a. Immediately abort: `git merge --abort`
   b. ROLLBACK — report FAILURE with note: "Merge conflicts detected — work agent must rebase before merge"
   c. Do NOT attempt to manually resolve conflicts. The work agent or human must handle this.

## PHASE 3 — VERIFY

{{#DO_BUILD}}
9. Build the project to verify no compile errors:
   - Use the Task tool with `subagent_type="Bash"` to run the build command.
   - For Node.js: `NODE_OPTIONS="--max-old-space-size=8192" npm run build`
   - For Java/Maven: `./mvnw compile`
   - Check `package.json` or `pom.xml` to determine the right command.
10. Run tests using the Task tool with `subagent_type="Bash"`:
    - For Node.js: `npm test`
    - Record passing/failing counts as `MERGE_PASS` and `MERGE_FAIL`.
{{/DO_BUILD}}
{{^DO_BUILD}}
9. Run tests again. Record `MERGE_PASS` and `MERGE_FAIL`.
{{/DO_BUILD}}

## PHASE 4 — DECIDE

11. Compare results:
    {{#DO_BUILD}}- If build failed: ROLLBACK (go to step 12)
    {{/DO_BUILD}}- If `MERGE_FAIL > BASELINE_FAIL` (NEW test failures introduced): ROLLBACK (go to step 12)
    - If `MERGE_FAIL <= BASELINE_FAIL` (no new failures): {{#DO_PUSH}}PUSH (go to step 13){{/DO_PUSH}}{{^DO_PUSH}}Report PASSED — merge is validated{{/DO_PUSH}}
    - Pre-existing failures on `{{TARGET_BRANCH}}` are NOT a reason to rollback.
12. ROLLBACK: `git reset --hard ORIG_HEAD`
    (`ORIG_HEAD` is set by git at merge time — always points to pre-merge state.)
{{#DO_PUSH}}
{{^SKIP_DONE_REPORT}}
    Then report failure by calling the Panopticon API:
    ```bash
    curl -s -X POST {{API_URL}}/api/specialists/done \
      -H "Content-Type: application/json" \
      -d '{"specialist":"merge","issueId":"{{ISSUE_ID}}","status":"failed","notes":"<reason for rollback>"}'
    ```
{{/SKIP_DONE_REPORT}}
    Then STOP.
13. PUSH: `git push origin {{TARGET_BRANCH}}`
    If push is rejected (non-fast-forward / "tip of your current branch is behind"):
    a. `git fetch origin {{TARGET_BRANCH}}`
    b. `git rebase origin/{{TARGET_BRANCH}}`
       (Replay on top of any new remote commits — safe, no data loss.)
    c. If rebase conflicts: `git rebase --abort`, ROLLBACK (go to step 12)
    d. If rebase succeeds: retry `git push origin {{TARGET_BRANCH}}`
    e. If push fails again after one retry: ROLLBACK (go to step 12)
{{/DO_PUSH}}
{{^DO_PUSH}}
**CRITICAL: Do NOT push to {{TARGET_BRANCH}}. Do NOT run `git push origin {{TARGET_BRANCH}}`.**
The merge validation stays LOCAL. A human will click Merge in the dashboard to push.
{{/DO_PUSH}}

## PHASE 5 — REPORT

{{#SKIP_DONE_REPORT}}
DO NOT call `/api/specialists/done` — the server manages status for this merge.
After pushing, simply STOP. If you need to rollback, rollback and STOP.
{{/SKIP_DONE_REPORT}}
{{^SKIP_DONE_REPORT}}
Call the Panopticon API to report results:
```bash
curl -s -X POST {{API_URL}}/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"merge","issueId":"{{ISSUE_ID}}","status":"passed|failed","notes":"<summary>"}'
```

**CRITICAL: You MUST call the `/api/specialists/done` endpoint whether you succeed or fail.**
{{/SKIP_DONE_REPORT}}

{{#DO_BUILD}}
## Why Use Subagents for Build/Test

- Subagents have isolated context and won't pollute your working memory.
- Build and test output can be verbose — subagents handle this cleanly.
- If tests fail, the subagent returns a clear summary.
{{/DO_BUILD}}

## Hard Rules

- **NEVER use `git push --force` or `--force-with-lease`** — never force-push under any circumstances.
- **NEVER delete the feature branch** (locally or remotely).
- **NEVER use `HEAD~1` for rollback** — use `ORIG_HEAD` which git sets automatically at merge time.
- **NEVER run `git stash`** — the TypeScript layer handles stash/restore automatically.
{{#DO_PUSH}}
- **DO NOT** clean up workspaces or do anything beyond the sync, merge, build, test, and push steps above.
{{/DO_PUSH}}
{{^DO_PUSH}}
- **NEVER push to `{{TARGET_BRANCH}}`** — only humans merge. Your job is to VALIDATE the merge, not execute it.
{{/DO_PUSH}}
