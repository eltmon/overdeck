---
name: beads-panopticon-guide
description: >
  Panopticon-specific beads usage patterns. Covers common mistakes agents make
  when filtering beads by issue number (PAN-XXX) and working with Linear-synced beads.
version: "1.1.0"
allowed-tools: "Read,Bash(bd:*)"
triggers:
  - "bd list"
  - "find beads"
  - "filter by issue"
  - "PAN-"
  - "panopticon-"
---

# Beads Quick Reference for Panopticon Agents

**Context:** Panopticon uses beads to track tasks for Linear issues (PAN-XXX). Each Linear issue spawns multiple bead tasks with IDs like `panopticon-abc`.

## ⚠️ Common Mistakes

### ❌ WRONG: Using `--issue` flag
```bash
bd list --issue PAN-116
# Error: unknown flag: --issue
```

### ✅ CORRECT: Filter by title or label
```bash
# Option 1: Search in title (most common)
bd list --title-contains "PAN-116" --all

# Option 2: Filter by label (if issues are labeled)
bd list --label PAN-116

# Option 3: Search full text
bd search "PAN-116"
```

## Finding Beads for a Panopticon Issue

**Pattern:** Linear issue `PAN-XXX` → Multiple beads `panopticon-{random}`

```bash
# Find ALL beads for PAN-116 (including closed)
bd list --title-contains "PAN-116" --all

# Find OPEN beads for PAN-116
bd list --title-contains "PAN-116" --status open

# Get details about a specific bead
bd show panopticon-abc

# Find unblocked work for PAN-116
bd ready | grep -i "PAN-116"
```

## Common Filters

```bash
# By status
bd list --status open
bd list --status in_progress
bd list --status closed

# By priority
bd list --priority 1              # P1 only
bd list --priority-min 0 --priority-max 1  # P0-P1

# By assignee
bd list --assignee "Claude"
bd list --no-assignee             # Unassigned

# Multiple filters
bd list --title-contains "PAN-116" --status open --priority 1
```

## Worktree Hydration in Panopticon

beads v1.0.4 can hydrate a worktree database from committed `issues.jsonl` through its post-pull/checkout auto-import hook.

Panopticon workspaces still use a manual `.beads/redirect` file that points at the main repository's shared `.beads` database. That follow-up was deliberately deferred in PAN-1111, so agents must preserve the redirect-managed flow for now.

Never run `bd init` inside a redirect-managed worktree. If `.beads/redirect` exists, use `bd ping --json` to probe it and `bd doctor --fix` to repair it; initializing a second local database splits bead state away from the shared workspace.

## Working With Beads

```bash
# Start work on a bead
bd update panopticon-abc --status in_progress

# Add progress notes (CRITICAL for crash recovery)
bd comments add panopticon-abc "Implemented parseClaudeSession refactor"

# Complete a bead
bd close panopticon-abc --reason "Per-message costing implemented"

# Check dependencies
bd dep tree panopticon-abc
```

## Bead ID vs Issue ID

| Type | Example | Where Used |
|------|---------|------------|
| **Linear Issue ID** | `PAN-116` | GitHub issues, titles, labels |
| **Bead ID** | `panopticon-abc` | bd commands (`bd show`, `bd update`) |

**Key insight:** `bd list --id` expects bead IDs, not Linear IDs.

```bash
# ❌ WRONG
bd list --id PAN-116

# ✅ CORRECT
bd list --id panopticon-abc,panopticon-xyz
```

## Invalid Commands (NEVER use these)

The following commands do NOT exist. Agents frequently hallucinate them:

| Invalid Command | Correct Replacement |
|-----------------|---------------------|
| `bd claim <id>` | `bd update <id> --claim` |
| `bd start <id>` | `bd update <id> --status in_progress` |
| `bd move <id>` | `bd update <id>` (with relevant flags) |
| `bd refile <id>` | `bd update <id>` (with relevant flags) |

## Quick Cheat Sheet

| Task | Command |
|------|---------|
| Find beads for issue | `bd list --title-contains "PAN-XXX" --all` |
| Find open work | `bd ready` or `bd list --status open` |
| Start a bead | `bd update <bead-id> --status in_progress` |
| Claim a bead | `bd update <bead-id> --claim` |
| Add notes | `bd comments add <bead-id> "notes"` |
| Complete bead | `bd close <bead-id> --reason "done"` |
| Show bead details | `bd show <bead-id>` |
| Bulk close beads | `printf 'close <id> done\n' | bd batch` |
| Check blockers | `bd dep tree <bead-id>` |

## When to Use Each Filter

| Use Case | Filter Flag | Example |
|----------|-------------|---------|
| Search by Linear issue number | `--title-contains` | `--title-contains "PAN-116"` |
| Filter by specific bead IDs | `--id` | `--id panopticon-abc,panopticon-xyz` |
| Filter by label | `--label` | `--label PAN-116` (if labeled) |
| Full text search | Use `bd search` | `bd search "PAN-116"` |

## Resource Files

For complete beads documentation, see the main `beads` skill:
- `/beads/SKILL.md` - Core beads reference
- `/beads/resources/CLI_REFERENCE.md` - Complete command syntax
- `/beads/resources/PATTERNS.md` - Common usage patterns

## Remember

1. **No `--issue` flag exists** - Use `--title-contains` instead
2. **`--id` expects bead IDs** (panopticon-abc), not Linear IDs (PAN-116)
3. **Always add comments** - They survive compaction and help the next agent
4. **Persist at session end** - `bd dolt commit -m "session update"` commits pending local Dolt changes
5. **NEVER use `bd claim`** - Use `bd update <id> --claim` instead
6. **Check blockers before closing** - Run `bd dep tree <id>` first; close blockers before using `--force`
7. **NEVER run `bd init` in redirect-managed worktrees** - Use the existing `.beads/redirect` plus `bd ping --json` / `bd doctor --fix`

## Example: Complete Workflow for PAN-116

```bash
# 1. Find beads for this issue
bd list --title-contains "PAN-116" --all

# Output shows:
#   panopticon-abc [open] - PAN-116: Refactor parseClaudeSession
#   panopticon-xyz [open] - PAN-116: Add multi-model tests

# 2. Pick first unblocked task
bd show panopticon-abc

# 3. Start work
bd update panopticon-abc --status in_progress

# 4. Do the work...

# 5. Add progress notes
bd comments add panopticon-abc "Implemented per-message costing logic"

# 6. Complete
bd close panopticon-abc --reason "Refactored parseClaudeSession to calculate cost per-message"

# 7. Persist pending Dolt changes
bd dolt commit -m "PAN-116 session update"
```
