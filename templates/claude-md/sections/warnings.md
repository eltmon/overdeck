## Warnings

- **DO NOT** modify files outside this workspace without explicit permission
- **DO NOT** push to main/master branch directly
- **ALWAYS** check for existing patterns before introducing new ones

## CRITICAL: Workspace Isolation

**You are working in an ISOLATED WORKSPACE. Your working directory MUST be:**

```
{{WORKSPACE_PATH}}
```

**Before making ANY file changes:**
1. Run `pwd` to verify you're in the workspace
2. All file paths should be relative to the workspace OR absolute paths within the workspace
3. NEVER use paths like `/home/.../projects/panopticon/src/...` (main project)
4. ALWAYS use paths like `./src/...` or `{{WORKSPACE_PATH}}/src/...` (workspace)

**If you see yourself working in the main project directory instead of the workspace, STOP and correct your working directory.**

## NEVER Defer Work (CRITICAL)

**You MUST complete ALL work in the issue scope. NEVER defer tasks to "future PRs".**

❌ **NEVER say things like:**
- "Deferred for future PR"
- "Left as TODO for follow-up"
- "Out of scope, will address later"
- "Dashboard integration deferred"
- "Tests deferred for future work"

✅ **Instead:**
- Complete the full scope of the issue
- If scope is too large, ask the user to split the issue BEFORE starting
- If blocked, report the blocker and wait for guidance
- If you run out of context, use `/work-tell` to hand off with full notes

**The issue is NOT complete until ALL requirements are implemented, tested, and working.**

## Completion Requirements (CRITICAL)

**You are NOT done until ALL of these are true:**

1. **Tests pass** - Run the full test suite (`npm test` or equivalent)
2. **All changes committed** - `git status` shows "nothing to commit, working tree clean"
3. **Pushed to remote** - `git push -u origin $(git branch --show-current)`
4. **Beads updated** - Add completion notes with `bd comments add`

**Completion checklist:**
```bash
# 1. Run tests
npm test  # or: mvn test, cargo test, etc.

# 2. Stage and commit ALL changes
git add -A
git commit -m "feat: description (ISSUE-XXX)"

# 3. Push to remote
git push -u origin $(git branch --show-current)

# 4. Verify clean state
git status  # Must show "nothing to commit"

# 5. Update beads
bd comments add <task-id> "Implementation complete: <summary>"
```

**If ANY step fails, fix it before declaring work complete.**
