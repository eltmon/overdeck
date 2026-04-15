---
name: check-merged
audience: agent
description: >
  Verify whether an issue's feature branch has been merged into main.
  Checks git history, branch existence, and commit presence. Returns
  MERGED, NOT_MERGED, or BRANCH_NOT_FOUND with evidence.
  Designed for cheap models (Haiku) to run quickly.
tools: Bash(git:*)
model: haiku
---

# Check Merged

Verify whether a feature branch for an issue has been merged into the main branch.

## Purpose

After an issue reaches "Done" on the kanban board, we need to confirm the code was actually merged — not just that the tracker status was updated. This skill checks git evidence to give a definitive answer.

## When to Use

- **Close-out ceremony**: Before archiving workspace artifacts
- **Done column audit**: Batch-verify all Done items are genuinely merged
- **Stale branch cleanup**: Identify branches that were abandoned vs merged
- **As a subagent**: Spawn from a parent agent to verify multiple issues in parallel

## Input

The skill expects an issue ID (e.g., `PAN-123`, `MIN-456`) and a project path.

## Execution

### Step 1: Resolve Branch Name

```bash
# Standard naming convention
BRANCH="feature/${ISSUE_ID_LOWER}"

# Also check alternate patterns
# edwardbecker/${issue-slug} (Linear default)
# feature/${issue-id}-description
```

### Step 2: Check If Branch Exists

```bash
# Check local branches
git -C "$PROJECT_PATH" branch --list "$BRANCH" 2>/dev/null

# Check remote branches
git -C "$PROJECT_PATH" ls-remote --heads origin "$BRANCH" 2>/dev/null

# Check Linear-style branch names (broader search)
git -C "$PROJECT_PATH" branch -a --list "*${ISSUE_ID_LOWER}*" 2>/dev/null
```

### Step 3: Check Merge Evidence

**If branch exists locally:**
```bash
# Check for unmerged commits
git -C "$PROJECT_PATH" log main.."$BRANCH" --oneline 2>/dev/null
# Empty output = fully merged
# Non-empty = has unmerged commits
```

**If branch exists on remote only:**
```bash
git -C "$PROJECT_PATH" fetch origin "$BRANCH" 2>/dev/null
git -C "$PROJECT_PATH" log main..origin/"$BRANCH" --oneline 2>/dev/null
```

**If no branch found (may be squash-merged and deleted):**
```bash
# Check if any commit in main references the issue ID
git -C "$PROJECT_PATH" log main --oneline --grep="$ISSUE_ID" 2>/dev/null

# Check merge commits
git -C "$PROJECT_PATH" log main --oneline --merges --grep="$ISSUE_ID" 2>/dev/null

# Check squash commits (PR title often contains issue ID)
git -C "$PROJECT_PATH" log main --oneline --grep="$BRANCH" 2>/dev/null
```

### Step 4: Check PR Status (if gh available)

```bash
# Find closed/merged PRs for this branch
gh pr list --repo OWNER/REPO --state merged --head "$BRANCH" --json number,title,mergedAt 2>/dev/null

# Or search by issue reference
gh pr list --repo OWNER/REPO --state merged --search "$ISSUE_ID" --json number,title,mergedAt 2>/dev/null
```

## Output Format

Report one of three results:

### MERGED
```
RESULT: MERGED
ISSUE: PAN-123
EVIDENCE:
  - Branch: feature/pan-123 (deleted after merge)
  - Commit: abc1234 "PAN-123: Implement feature X" found on main
  - PR: #456 merged at 2026-02-15T10:30:00Z
```

### NOT_MERGED
```
RESULT: NOT_MERGED
ISSUE: PAN-123
EVIDENCE:
  - Branch: feature/pan-123 exists with 3 unmerged commits
  - Latest commit: def5678 "WIP: partial implementation"
  - No merged PR found
```

### BRANCH_NOT_FOUND
```
RESULT: BRANCH_NOT_FOUND
ISSUE: PAN-123
EVIDENCE:
  - No branch matching "feature/pan-123" or "*pan-123*" found
  - No commits on main reference "PAN-123"
  - No merged PRs reference "PAN-123"
NOTE: Issue may have been completed without code changes, or branch name doesn't follow convention
```

## Polyrepo Support

For polyrepo projects, check each repo in the project:

```bash
# Get repo list from project config
# For each repo, run the same checks against that repo's path
```

## Error Handling

- If `PROJECT_PATH` doesn't exist or isn't a git repo: report error immediately
- If `git fetch` fails (network): report based on local evidence only, note the fetch failure
- If `gh` CLI isn't available: skip PR check, report based on git evidence only
