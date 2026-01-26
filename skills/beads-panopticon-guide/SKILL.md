---
name: beads-panopticon-guide
description: >
  Panopticon-specific beads usage patterns. Covers common mistakes agents make
  when filtering beads by issue number (PAN-XXX) and working with Linear-synced beads.
version: "1.0.0"
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

## Quick Cheat Sheet

| Task | Command |
|------|---------|
| Find beads for issue | `bd list --title-contains "PAN-XXX" --all` |
| Find open work | `bd ready` or `bd list --status open` |
| Start a bead | `bd update <bead-id> --status in_progress` |
| Add notes | `bd comments add <bead-id> "notes"` |
| Complete bead | `bd close <bead-id> --reason "done"` |
| Show bead details | `bd show <bead-id>` |

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
4. **Sync at session end** - `bd sync` commits to git

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

# 7. Sync to git
bd sync
```
