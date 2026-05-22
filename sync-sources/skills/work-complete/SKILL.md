---
name: work-complete
description: Checklist for agents to properly complete work and signal readiness for review
triggers:
  - work complete
  - ready for review
  - finished implementing
  - done with task
  - implementation complete
---

# Work Completion Checklist

**CRITICAL: You are NOT done until ALL changes are committed and pushed. Uncommitted changes = NOT COMPLETE.**

When you have finished implementing a feature or fixing a bug, follow this checklist:

## 1. Verify Implementation
- [ ] All acceptance criteria from the issue are met
- [ ] Code compiles/builds without errors
- [ ] Tests pass (run the full test suite)
- [ ] No linting errors

## 2. Self-Review Your Changes
```bash
git diff origin/main...HEAD
```
- Check for: bugs, security issues, hardcoded values, debug code
- Remove any TODO comments you added
- Ensure code follows project conventions

## 3. Commit Your Work (BLOCKING - DO THIS FIRST)

**Run these commands and verify clean status BEFORE signaling completion:**

```bash
# Check for uncommitted changes
git status

# If there are changes, commit them ALL:
git add -A
git commit -m "feat: description (ISSUE-XXX)"

# Push to remote
git push -u origin $(git branch --show-current)

# VERIFY: This must show "nothing to commit, working tree clean"
git status
```

**If `git status` shows ANY uncommitted changes, you are NOT DONE. Commit them first.**

## 4. Signal Completion
**IMPORTANT:** Tell the user your work is complete with this format:

```
✅ WORK COMPLETE - Ready for Review

## Summary
[Brief description of what was implemented]

## Changes Made
- [File 1]: [What changed]
- [File 2]: [What changed]

## Testing Done
- [How you verified the implementation]

## Next Steps
The user can now:
1. Test the changes in the workspace
2. Click "Approve & Merge" in Panopticon dashboard to merge and close
3. Or request changes if needed
```

## 5. Wait for User Response
- Do NOT continue making changes unless asked
- The user will either approve, request changes, or provide feedback
- If changes are requested, address them and repeat this checklist
