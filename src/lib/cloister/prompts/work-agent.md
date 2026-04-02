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

{{#if TLDR_AVAILABLE}}
## TLDR: Token-Efficient Code Analysis

**You have access to TLDR MCP tools for analyzing code without reading full files.**

This dramatically reduces token consumption and lets you understand codebases faster.

### Available TLDR Tools

- **`tldr_context <file>`** - Get file structure, exports, imports, key functions (500-1,200 tokens vs 10-25k for full read)
- **`tldr_structure <directory>`** - Understand directory layout and relationships
- **`tldr_calls <function> <file>`** - See what calls this function (call graph analysis)
- **`tldr_impact <function> <file>`** - See what this function calls (impact analysis)
- **`tldr_semantic <query>`** - Find code by natural language description

### When to Use TLDR

✅ **Use TLDR first for:**
- Understanding file structure before editing
- Finding where a feature is implemented
- Understanding cross-file dependencies
- Exploring unfamiliar code
- Searching for code by description

❌ **Read full file when:**
- You need to edit specific lines (TLDR gives context, then read to edit)
- Debugging syntax errors (need exact line content)
- Reviewing exact implementation details

### Example Workflow

```
1. Agent needs to understand auth.ts
   → tldr_context src/auth.ts                    # 1,200 tokens - see structure
   → Understand exports, imports, key functions
   → Only read full file if editing specific code

2. Agent needs to find where JWT is validated
   → tldr_semantic "JWT token validation"       # Find relevant files
   → tldr_context <matched-files>                # Understand each file
   → Read only the specific function to edit

3. Agent needs to understand impact of changing login()
   → tldr_impact login src/auth.ts              # See what login() calls
   → tldr_calls login src/auth.ts               # See what calls login()
   → Understand full dependency chain without reading all files
```

### Token Savings

- **Without TLDR:** Read 20 files × 15k tokens = 300k tokens (exhausts context)
- **With TLDR:** Analyze 20 files × 800 tokens = 16k tokens (94% reduction)

**Use TLDR liberally.** It's designed for this workflow and will dramatically extend how much work you can do per session.

{{/if}}

{{#if BEADS_TASKS}}
## Beads Tasks

Tasks created during planning (check STATE.md for which are complete):

{{BEADS_TASKS}}

### MANDATORY: One Bead At A Time

An automated **Inspect Specialist** runs in parallel with you. It verifies each bead's
implementation matches its specification. It needs a **scoped diff** — one bead per commit.
If you batch multiple beads, the inspector cannot verify them individually and your work
will be rejected.

**Workflow for EVERY bead:**
1. `bd ready -l {{ISSUE_ID_LOWER}}` — find the next unblocked bead for THIS issue
2. `bd update <bead-id> --claim` — claim it
3. Implement ONLY that bead's work
4. `git add` and `git commit` — one bead = one commit
5. `bd close <bead-id> --reason="what you did"` — this auto-triggers inspection
6. **WAIT** for the inspection result (delivered to your session via `pan work tell`)
7. `INSPECTION PASSED` → proceed to step 1
8. `INSPECTION BLOCKED` → fix, commit, `bd close` again

**IMPORTANT:** Always use `-l {{ISSUE_ID_LOWER}}` with `bd ready` and `bd list` to scope
to this issue's beads. The shared database contains beads from ALL issues — without the
label filter you will see irrelevant beads from other workspaces.

**Do NOT implement multiple beads before committing and closing.** Each bead must be
a separate commit with a separate `bd close`. The inspection fires automatically on
`bd close` — you do not need to call `pan inspect` manually.
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

**After addressing ALL feedback:** commit, push, and run `pan work done {{ISSUE_ID}} -c "Addressed review feedback: <summary>"`.
This re-submits for review automatically. Do NOT poll specialist APIs or wait for results — the pipeline is event-driven.
{{/if}}

{{#if NEW_TRACKER_CONTEXT}}
{{NEW_TRACKER_CONTEXT}}
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
3. If done, signal completion immediately:
   ```bash
   pan work done {{ISSUE_ID}} -c "Work already complete from previous session"
   ```
{{/env}}
{{#env REMOTE}}
3. If done, commit and push any remaining changes, then stop.
{{/env}}

**This fast-path check should take < 30 seconds. Do NOT re-analyze the entire codebase if work is done.**

## Your Task

1. Read the context files listed above
2. **FIRST:** Check STATE.md for completion status (see above)
3. If not complete, continue implementing the planned work using the per-bead workflow below

## MANDATORY: One Bead At A Time

An automated **Inspect Specialist** runs in parallel with you. It verifies each bead's
implementation matches its specification. It needs a **scoped diff** — one bead per commit.
If you batch multiple beads into one commit, the inspector cannot verify them individually
and your work will be rejected.

**Workflow for EVERY bead:**
1. `bd ready -l {{ISSUE_ID_LOWER}}` — find the next unblocked bead for THIS issue
2. `bd update <bead-id> --claim` — claim it
3. Implement ONLY that bead's work
4. `git add` and `git commit` — one bead = one commit
5. `bd close <bead-id> --reason="what you did"` — this auto-triggers inspection
6. **WAIT** for the inspection result (delivered to your session via `pan work tell`)
7. `INSPECTION PASSED` → proceed to step 1
8. `INSPECTION BLOCKED` → fix, commit, `bd close` again

**IMPORTANT:** Always use `-l {{ISSUE_ID_LOWER}}` with `bd ready` and `bd list` to scope
to this issue's beads. The shared database contains beads from ALL issues — without the
label filter you will see irrelevant beads from other workspaces.

**Do NOT implement multiple beads before committing and closing.** Each bead must be
a separate commit with a separate `bd close`. The inspection fires automatically on
`bd close` — you do not need to call `pan inspect` manually.

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
- Poll or `curl` the specialist API in a loop — the pipeline is event-driven, not polling-based
- Use `sleep` to wait for reviews, tests, or any external process
{{#env REMOTE}}
- Stop after completing a subset of tasks to ask "what should I do next?" — just continue to the next task
- If you encounter an error on a task, try to fix it. If you truly cannot proceed, skip it and move to the next task, noting what failed
{{/env}}

✅ **ALWAYS do this instead:**
- Work through beads ONE AT A TIME — claim, implement, commit, close, wait for inspection
- Complete ALL beads from start to finish — but each one individually
- Fix ALL failing tests, not just "high-impact" ones
- If something is broken, fix it - don't document it
- If tests fail, debug and fix them until they pass
- Work autonomously until the issue is FULLY resolved
- The only acceptable end state is: all beads closed with passing inspections, all tests pass, all code committed, pushed
{{#env REMOTE}}
- When one task is done, immediately move to the next unblocked task. Keep going until every task is finished.
{{/env}}

**You have unlimited time and context. Use it. Do not be lazy.**

**CRITICAL: NEVER stop working without calling `pan work done`.** If you have remaining tasks, keep going — do NOT end your turn to "wait for input." If ALL tasks are complete, you MUST call `pan work done {{ISSUE_ID}} -c "summary"` as your final action. Ending your turn without either continuing work or calling `pan work done` is a failure state that blocks the entire pipeline.

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
