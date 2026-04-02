# Workspace: MIN-794

> Project Rosie: Managed OpenClaw Agent for MYN Customers

## Quick Links

- [Linear Issue](https://linear.app/mind-your-now/issue/MIN-794/project-rosie-managed-openclaw-agent-for-myn-customers)

## Context Files

- `STATE.md` - Current progress and decisions
- `WORKSPACE.md` - This file

## Beads

Check current task status:
```bash
bd ready  # Next actionable task
bd list --tag MIN-794  # All tasks for this issue
```

## Agent Instructions

1. Run `bd ready` to get next task
2. Complete the task following relevant skills
3. Run `bd close "<task name>" --reason "..."` when done
4. Update STATE.md with progress
5. Repeat until all tasks complete

## CRITICAL: Work Completion Requirements

**You are NOT done until ALL of these are true:**

1. **Tests pass** - Run the full test suite
2. **All changes committed** - `git status` shows "nothing to commit"
3. **Pushed to remote** - `git push`

**Uncommitted changes = NOT COMPLETE.**
