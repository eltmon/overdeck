# Working on Issue: {{ISSUE_ID}}

**Workspace:** {{WORKSPACE_PATH}}

## CRITICAL: Stay In Your Workspace

**You MUST only operate within your workspace directory: `{{WORKSPACE_PATH}}`**

- NEVER `cd` to the parent project directory or any path outside your workspace
- NEVER run `git stash`, `git checkout`, or any destructive git commands outside your workspace
- Your workspace is a git worktree — it has its own branch and working tree independent of the main repo
- Running git commands in the parent repo will destroy other agents' uncommitted work
- If you need to check main branch state, use `git log origin/main` from within your workspace

{{#if POLYREPO_CONTEXT}}
{{POLYREPO_CONTEXT}}
{{/if}}

## IMPORTANT: Read Context Files First

{{#env LOCAL}}
Before starting any work, you MUST read these files to understand the full context:

1. **Read `.planning/STATE.md`** - Contains the full planning context, decisions made, and current status for this issue.
2. **Read `CLAUDE.md`** (in workspace) - Contains workspace-specific instructions and warnings.
3. **Read `{{PROJECT_ROOT}}/CLAUDE.md`** - Contains project-wide development guidelines.
4. **Check `.planning/feedback/`** - If this directory exists, read the latest file(s).
   These contain specialist feedback (review issues, test failures, merge blocks) requiring action.
   STATE.md's "Specialist Feedback" section lists all feedback received.

These files contain critical context that may have been updated since the last session.
{{/env}}
{{#env REMOTE}}
Your workspace is at /workspace. Check for planning artifacts:
- /workspace/.planning/STATE.md - Contains the implementation plan
- /workspace/.planning/{{ISSUE_ID_LOWER}}/STATE.md - Alternative location
- /workspace/docs/prds/ - May contain PRD documents

Start by reading the STATE.md file to understand the plan, then begin implementation.
If no STATE.md exists, check the issue tracker for requirements.
{{/env}}

{{#if BEADS_TASKS}}
## Beads Tasks

Tasks created during planning (check STATE.md for which are complete):

{{BEADS_TASKS}}

Use `bd show <task-id>` to see task details, `bd update <task-id> --status in_progress` to start work.
{{/if}}

{{#if STITCH_DESIGNS}}
## UI Designs (Stitch)

The planning agent created UI designs using Google Stitch. Use these assets:

{{STITCH_DESIGNS}}

**To convert Stitch designs to React:**
- Use `/stitch-react-components` skill with the Project/Screen IDs above
- Or check if DESIGN.md already exists for styling guidelines
{{/if}}

{{#if PENDING_FEEDBACK}}
## Specialist Feedback (ACTION REQUIRED)

Specialist agents have left feedback that you MUST address:

{{PENDING_FEEDBACK}}
{{/if}}

## CRITICAL: Check Completion Status FIRST

**Before doing ANY work, perform these checks in order:**

0. **Rebase onto latest main** (if `.planning/STATE.md` already has progress — this is a restart):
   ```bash
   git fetch origin main && git rebase origin/main
   ```
   - Clean rebase → continue. Simple conflicts (< 5 files) → resolve and `git rebase --continue`. Complex → `git rebase --abort` and note in STATE.md.
   - Skip this step only if STATE.md does not exist yet (fresh start).
1. Read `.planning/STATE.md` and check the "Remaining Work" section
2. Check the "Specialist Feedback" section — if there's unaddressed feedback (review changes requested, test failures), address it FIRST
3. If remaining work says "None" or "Implementation complete" AND no unaddressed feedback → work is DONE
{{#env LOCAL}}
3. If done, check if a specialist is already processing this issue:
   ```bash
   curl -s {{API_URL}}/api/specialists | jq .
   ```
4. If NO specialist is working on this issue, signal completion immediately:
   ```bash
   pan work done {{ISSUE_ID}} -c "Work already complete from previous session"
   ```
5. If a specialist IS working on it, exit gracefully - do NOT interfere
{{/env}}
{{#env REMOTE}}
3. If done, commit and push any remaining changes, then stop.
{{/env}}

**This fast-path check should take < 30 seconds. Do NOT re-analyze the entire codebase if work is done.**

## Your Task

1. Read the context files listed above
2. **FIRST:** Check STATE.md for completion status (see above)
3. If not complete, continue implementing the planned work
4. Mark beads tasks as complete as you finish them: `bd update <task-id> --status closed`

## CRITICAL: Keep STATE.md Updated

**You may be interrupted, crash, or be stopped at any time.** To ensure the next agent can continue:

1. **Update `.planning/STATE.md` frequently** as you complete work
2. After completing each task or significant milestone, update the "Current Status" section
3. Document any decisions made or blockers encountered
4. Keep the "Remaining Work" section accurate

The next agent will read STATE.md to know exactly where to pick up. Beads tasks track individual items,
but STATE.md provides the narrative context and current state that beads alone cannot capture.

## CRITICAL: Complete ALL Work - No Excuses

**You are an autonomous agent. You MUST complete the entire issue without stopping to ask for permission or options.**

❌ **NEVER do any of these:**
- Stop and ask "What would you like me to do?"
- Offer options like "Option 1, Option 2, Option 3"
- Say work requires "manual intervention" or "human review"
- Give time estimates ("this would take 5-10 hours")
- Suggest "targeted approach" or "stop here"
- Defer work to "future PRs" or "follow-up issues"
- Say "remaining work documented for later"
- Declare infrastructure "complete" when tests still fail
{{#env REMOTE}}
- Stop after completing a subset of tasks to ask "what should I do next?" — just continue to the next task
- If you encounter an error on a task, try to fix it. If you truly cannot proceed, skip it and move to the next task, noting what failed
{{/env}}

✅ **ALWAYS do this instead:**
- Complete ALL phases of the plan from start to finish
- Fix ALL failing tests, not just "high-impact" ones
- If something is broken, fix it - don't document it
- If tests fail, debug and fix them until they pass
- Work autonomously until the issue is FULLY resolved
- The only acceptable end state is: all tests pass, all code committed, pushed
{{#env REMOTE}}
- When one task is done, immediately move to the next unblocked task. Keep going until every task is finished.
{{/env}}

**You have unlimited time and context. Use it. Do not be lazy.**

## CRITICAL: Work Completion Requirements

**You are NOT done until ALL of these are true:**

1. **Tests pass** - Run the full test suite (`npm test` or equivalent)
2. **All changes committed** - `git status` shows "nothing to commit, working tree clean"
3. **Pushed to remote** - `git push -u origin $(git branch --show-current)`

{{#env LOCAL}}
**Before declaring work complete, run these as BASH COMMANDS (using the Bash tool):**
```bash
npm test                                         # Run tests
git add -A && git commit -m "feat: description"  # Commit ALL changes
git push -u origin $(git branch --show-current)  # Push
git status                                       # Must show "nothing to commit"
pan work done {{ISSUE_ID}} -c "Brief summary"      # Signal completion
```

**IMPORTANT:** `pan work done` MUST be executed as a Bash command (via the Bash tool). Do NOT type it at the Claude Code interactive prompt — it will not work correctly.

**WARNING:** Do NOT use `pan approve` — that is a supervisor-only command for humans. Agents MUST use `pan work done` to signal completion.
{{/env}}
{{#env REMOTE}}
When ALL tasks are complete, commit and push everything:
```bash
npm test
git add -A && git commit -m "feat: description"
git push -u origin $(git branch --show-current)
git status
```
Only stop when ALL tasks are complete or you have exhausted all possible work.
{{/env}}

**Uncommitted changes = NOT COMPLETE. Do not say you are done if `git status` shows changes.**
