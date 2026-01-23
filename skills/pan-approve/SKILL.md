---
name: pan-approve
description: Approve agent work and merge merge request
triggers:
  - pan approve
  - approve agent work
  - merge agent mr
  - accept work
  - review and merge
allowed-tools:
  - Bash
  - Read
  - mcp__linear__update_issue
---

# Approve Agent Work

## Overview

This skill guides you through reviewing and approving work completed by an autonomous agent, including merging the merge request and updating the issue status.

## When to Use

- Agent has completed work and is awaiting review
- You've tested the changes and want to merge
- Closing out an issue after successful UAT

## Prerequisites

- Git credentials configured for pushing
- Linear API key (for status updates)
- Access to merge to target branch

## Workflow

### 1. Review Agent's Work

```bash
# Check agent status
pan work status

# View the workspace
cd /path/to/workspace

# Review changes
git log --oneline -10
git diff main...HEAD

# Run tests
npm test  # or appropriate test command
```

### 2. Verify Quality Checklist

Before approving, ensure:
- [ ] Code compiles/builds successfully
- [ ] Tests pass
- [ ] No obvious security issues
- [ ] Changes match the issue requirements
- [ ] Documentation updated if needed

### 3. Merge the Changes

```bash
# Option A: Squash merge (recommended for clean history)
git checkout main
git merge --squash feature/ISSUE-123-description
git commit -m "feat: Description of changes (#123)"
git push origin main

# Option B: Regular merge (preserves commit history)
git checkout main
git merge feature/ISSUE-123-description
git push origin main
```

### 4. Update Issue Status

```bash
# Using Linear MCP
# Update to "Done" status via Linear API
```

Or use the Linear MCP tool to update the issue:
- Set state to "Done"
- Add a comment noting the merge

### 5. Clean Up

```bash
# Stop the agent if still running
pan work kill ISSUE-123

# Optionally remove the workspace
rm -rf /path/to/workspace

# NOTE: Feature branches are NOT deleted automatically.
# They are preserved for history and debugging.
# If you want to delete them, do so manually.
```

## Quick Command

```bash
# One-liner to approve and merge (if using pan CLI)
pan work approve ISSUE-123
```

## Troubleshooting

**Merge conflicts:**
```bash
# Rebase on main first
git checkout feature/ISSUE-123-description
git rebase main
# Resolve conflicts
git rebase --continue
```

**Tests failing:**
```bash
# Send feedback to agent
pan work tell ISSUE-123 "Tests are failing: [error details]. Please fix."
```

**Missing changes:**
```bash
# Send additional requirements
pan work tell ISSUE-123 "Also need to add: [requirements]"
```

## Related Skills

- `/pan:pending` - View work awaiting approval
- `/pan:tell` - Send messages to agents
- `/pan:status` - Check agent status
