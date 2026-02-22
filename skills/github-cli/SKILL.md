---
name: github-cli
description: GitHub CLI (gh) reference for issues, PRs, and API calls
triggers:
  - gh cli
  - github cli
  - github issues
  - github pull requests
  - gh commands
allowed-tools:
  - Bash
  - Read
---

# GitHub CLI (`gh`) Reference

Use `gh` CLI for all GitHub operations. Anthropic recommends `gh` CLI over GitHub MCP servers for Claude Code since you already have shell access.

## Common Pitfalls

### Invalid JSON fields cause errors
`--json` only accepts specific fields per command. Using invalid fields (e.g., `stateReason`) causes the command to fail and may cancel sibling tool calls.

**Always use fields from the valid lists below.** When in doubt, run `gh <command> --json` with no field names to see the valid list.

### Non-interactive mode
`gh` commands that prompt for input will hang in automated contexts. Always provide all required flags explicitly:
- `gh pr create` needs `--title` and `--body`
- `gh issue create` needs `--title`
- `gh pr merge` needs a merge strategy flag (`--merge`, `--squash`, or `--rebase`)

## Issue Commands

### `gh issue list`
```bash
gh issue list --state open --limit 50
gh issue list --label "bug" --assignee "@me"
gh issue list --search "error sort:created-asc"
gh issue list --json number,title,state,labels
```

**Flags:** `-s/--state {open|closed|all}`, `-l/--label`, `-a/--assignee`, `-A/--author`, `-m/--milestone`, `-S/--search`, `-L/--limit`, `--json`, `-R/--repo`

**Valid `--json` fields:**
`assignees`, `author`, `body`, `closed`, `closedAt`, `comments`, `createdAt`, `id`, `labels`, `milestone`, `number`, `projectCards`, `projectItems`, `reactionGroups`, `state`, `title`, `updatedAt`, `url`

### `gh issue view`
```bash
gh issue view 123
gh issue view 123 --json number,title,state,body
gh issue view 123 --comments
```

**Valid `--json` fields:** Same as `gh issue list`.

**NOT valid:** `stateReason`, `closedBy`, `reactions`, `timeline`

### `gh issue create`
```bash
gh issue create --title "Bug: X" --body "Description"
gh issue create --title "Feature" --label "enhancement" --assignee "@me"
```

**Flags:** `-t/--title`, `-b/--body`, `-F/--body-file`, `-l/--label`, `-a/--assignee`, `-m/--milestone`, `-p/--project`

### `gh issue close`
```bash
gh issue close 123
gh issue close 123 --reason "completed"
gh issue close 123 --comment "Fixed in PR #456"
```

**Flags:** `-r/--reason {completed|not planned}`, `-c/--comment`

### `gh issue edit`
```bash
gh issue edit 123 --title "New title"
gh issue edit 123 --add-label "bug" --remove-label "triage"
gh issue edit 123 --add-assignee "@me"
```

## Pull Request Commands

### `gh pr list`
```bash
gh pr list --state open
gh pr list --json number,title,state,headRefName
gh pr list --head feature/pan-123
```

**Flags:** `-s/--state {open|closed|merged|all}`, `-B/--base`, `-H/--head`, `-l/--label`, `-a/--assignee`, `-A/--author`, `-S/--search`, `-L/--limit`, `--json`

**Valid `--json` fields:**
`additions`, `assignees`, `author`, `autoMergeRequest`, `baseRefName`, `body`, `changedFiles`, `closed`, `closedAt`, `comments`, `commits`, `createdAt`, `deletions`, `files`, `headRefName`, `headRefOid`, `headRepository`, `headRepositoryOwner`, `id`, `isCrossRepository`, `isDraft`, `labels`, `latestReviews`, `maintainerCanModify`, `mergeCommit`, `mergeStateStatus`, `mergeable`, `mergedAt`, `mergedBy`, `milestone`, `number`, `potentialMergeCommit`, `projectCards`, `projectItems`, `reactionGroups`, `reviewDecision`, `reviewRequests`, `reviews`, `state`, `statusCheckRollup`, `title`, `updatedAt`, `url`

### `gh pr view`
```bash
gh pr view 456
gh pr view 456 --json number,title,state,mergeStateStatus,reviews
```

**Valid `--json` fields:** Same as `gh pr list`.

### `gh pr create`
```bash
gh pr create --title "feat: Add X" --body "## Summary\n- Added X\n\n## Test plan\n- [ ] Test Y"
gh pr create --title "fix: Bug" --body "Fixes #123" --label "bug"
gh pr create --fill  # auto-fill from commit messages
```

**Flags:** `-t/--title`, `-b/--body`, `-F/--body-file`, `-B/--base`, `-H/--head`, `-l/--label`, `-r/--reviewer`, `-a/--assignee`, `-m/--milestone`, `-d/--draft`, `-f/--fill`

Use HEREDOC for multi-line body:
```bash
gh pr create --title "feat: X" --body "$(cat <<'EOF'
## Summary
- Change 1

## Test plan
- [ ] Verify X
EOF
)"
```

### `gh pr merge`
```bash
gh pr merge 456 --squash --delete-branch
gh pr merge 456 --merge
gh pr merge 456 --rebase
```

**Flags:** `-m/--merge`, `-s/--squash`, `-r/--rebase`, `-d/--delete-branch`, `--auto`, `-b/--body`, `-t/--subject`

**Must specify one of:** `--merge`, `--squash`, or `--rebase`

### `gh pr close`
```bash
gh pr close 456
gh pr close 456 --delete-branch
```

### `gh pr checkout`
```bash
gh pr checkout 456
```

## API Commands

### `gh api`
For operations not covered by `gh issue` or `gh pr`, use the REST API directly:

```bash
# Get PR comments
gh api repos/{owner}/{repo}/pulls/123/comments

# Get PR review comments
gh api repos/{owner}/{repo}/pulls/123/reviews

# Get issue timeline events
gh api repos/{owner}/{repo}/issues/123/timeline

# Add a comment
gh api repos/{owner}/{repo}/issues/123/comments -f body="Comment text"

# Get repo info
gh api repos/{owner}/{repo}
```

`{owner}` and `{repo}` are auto-filled from the current repo context.

**Flags:** `-X/--method {GET|POST|PUT|PATCH|DELETE}`, `-f/--raw-field key=value`, `-F/--field key=value`, `--paginate`, `-q/--jq`

### Filtering with jq
```bash
gh issue list --json number,title,labels --jq '.[] | select(.labels[].name == "bug")'
gh pr list --json number,title,headRefName --jq '.[] | select(.headRefName | startswith("feature/"))'
```

## Repo-Scoped Operations

When not in a git repo or targeting a different repo, use `-R`:
```bash
gh issue list -R eltmon/panopticon-cli
gh pr view 456 -R eltmon/panopticon-cli
```
