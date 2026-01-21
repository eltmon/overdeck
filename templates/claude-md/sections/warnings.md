## Warnings

- **DO NOT** modify files outside this workspace without explicit permission
- **DO NOT** push to main/master branch directly
- **ALWAYS** check for existing patterns before introducing new ones

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
