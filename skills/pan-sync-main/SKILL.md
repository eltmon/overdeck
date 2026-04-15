---
name: pan-sync-main
audience: operator
description: "pan sync-main <id> — merge latest main into the feature branch for an active workspace"
triggers:
  - sync with main
  - sync main into workspace
  - pull in hotfix
  - merge main into branch
  - pan sync-main
  - get latest changes from main
allowed-tools:
  - Bash
  - Read
---

# Sync with Main

Merges the latest `main` branch into a workspace's feature branch. Uses `git merge` (not rebase) to avoid rewriting history, and delegates conflict resolution to the merge-agent specialist.

## Usage

```bash
# CLI command
pan sync-main PAN-XXX

# Or via the dashboard API
curl -X POST http://localhost:3011/api/issues/PAN-XXX/sync-main
```

## What It Does

1. Checks for uncommitted changes (blocks if any — must commit or stash first)
2. Cleans up any stale git locks
3. Runs `git fetch origin main`
4. Runs `git merge origin/main`
5. If clean merge: reports commit count and changed files
6. If conflicts: wakes the merge-agent specialist to resolve them
7. After conflict resolution: scans for leftover markers, then reports result

## Outcomes

| Result | Meaning |
|--------|---------|
| Already up to date | Main has no new commits since last sync |
| Success (N commits) | Clean merge or agent-resolved conflicts |
| Uncommitted changes | Commit or stash workspace changes first |
| Conflict (unresolvable) | Agent could not resolve — merge aborted, workspace unchanged |

## Design Decisions

- **Merge, not rebase** — Rebase rewrites SHAs and requires force-push. Merge commits serve as audit markers.
- **No tests/builds** — Feature branch is WIP. Running tests after sync would fail on pre-existing issues.
- **No push to remote** — This is a local workspace operation only.
- **All-or-nothing for polyrepo** — If any repo fails, all are aborted (not implemented yet; sync is per-workspace).

## Examples

```bash
# Sync PAN-123 workspace with latest main
pan sync-main PAN-123

# Output on success:
# ✓ Synced 3 commit(s) from main
#   Commits merged: 3
#   Changed files (5):
#     src/lib/auth.ts
#     src/lib/config.ts
#     ...

# Output when already current:
# ✓ PAN-123 is already up to date with main

# Output on uncommitted changes (blocks):
# ✗ Sync failed: Workspace has uncommitted changes. Commit or stash them before syncing with main.
```

## Dashboard

The "Sync with Main" button appears in the workspace detail panel:
- In the **Git Status** section as a small "Sync" button next to the branch name (disabled if uncommitted changes)
- In the **Actions** section as a full "Sync with Main" button

## Related Commands

- `pan approve <id>` — Review and merge to main
- `pan review request <id>` — Trigger review pipeline
- `pan tell <id> "<message>"` — Send message to agent
