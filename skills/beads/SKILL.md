---
name: beads
description: >
  Git-backed issue tracker for multi-session work with dependencies and persistent
  memory across conversation compaction. Use when work spans sessions, has blockers,
  or needs context recovery after compaction.
allowed-tools: "Read,Bash(bd:*)"
version: "0.43.0"
author: "Steve Yegge <https://github.com/steveyegge>"
license: "MIT"
---

# Beads - Persistent Task Memory for AI Agents

Graph-based issue tracker that survives conversation compaction. Provides persistent memory for multi-session work with complex dependencies.

## bd vs TodoWrite

| bd (persistent) | TodoWrite (ephemeral) |
|-----------------|----------------------|
| Multi-session work | Single-session tasks |
| Complex dependencies | Linear execution |
| Survives compaction | Conversation-scoped |
| Git-backed, team sync | Local to session |

**Decision test**: "Will I need this context in 2 weeks?" → YES = bd

## ID Systems

**Beads uses a unique ID format** that differs from GitHub/Linear issue IDs:

| System | Format | Example |
|--------|--------|---------|
| **Beads** | `repo-hash` | `panopticon-3eb7`, `panopticon-6ax` |
| **Beads (hierarchical)** | `repo-hash.N` | `panopticon-3eb7.4` |
| **GitHub Issues** | `PREFIX-number` | `PAN-84`, `PAN-73` |
| **Linear Issues** | `PREFIX-number` | `MIN-123`, `HH-456` |

**CRITICAL**: Commands like `bd dep add`, `--parent`, and `--deps` expect **beads IDs** (e.g., `panopticon-abc1`), NOT external tracker IDs (e.g., `PAN-5`).

### Linking to External Trackers

To link a beads issue to a GitHub or Linear issue, use `--external-ref` when creating:

```bash
# Link beads issue to GitHub issue PAN-84
bd create "Fix auth bug" --external-ref PAN-84 --json

# Link to Linear issue
bd create "Add feature" --external-ref MIN-123 --json
```

**Current limitation**: No `bd list --external-ref PAN-84` filter exists. Use labels or title conventions as workaround until upstream feature is available.

**When to use bd**:
- Work spans multiple sessions or days
- Tasks have dependencies or blockers
- Need to survive conversation compaction
- Exploratory/research work with fuzzy boundaries
- Collaboration with team (git sync)

**When to use TodoWrite**:
- Single-session linear tasks
- Simple checklist for immediate work
- All context is in current conversation
- Will complete within current session

## Prerequisites

```bash
bd --version  # Requires v0.34.0+
```

- **bd CLI** installed and in PATH
- **Git repository** (bd requires git for sync)
- **Initialization**: `bd init` run once (humans do this, not agents)

## CLI Reference

**Run `bd prime`** for AI-optimized workflow context (auto-loaded by hooks).
**Run `bd <command> --help`** for specific command usage.

Essential commands: `bd ready`, `bd create`, `bd show`, `bd update`, `bd close`, `bd sync`

## Session Protocol

1. `bd ready` — Find unblocked work
2. `bd show <id>` — Get full context
3. `bd update <id> --status in_progress` — Start work
4. Add notes as you work (critical for compaction survival)
5. `bd close <id> --reason "..."` — Complete task
6. `bd sync` — Persist to git (always run at session end)

## Quick Reference (Exact Syntax)

**DO NOT GUESS FLAGS** - use exactly these commands.

For advanced commands not listed here:
1. Run `bd --help` to see all available commands
2. Run `bd <command> --help` for specific command syntax

### Find Work
```bash
bd ready --json                  # Find unblocked work (no blockers)
bd stale --days 30 --json        # Find stale issues
bd prime                         # AI-optimized workflow context
```

### Create Issues
```bash
bd create "Title" -t bug|feature|task -p 0-4 -d "Description" --json
bd create "Title" -t task -p 2 -l label1,label2 --json  # with labels
bd create "Title" --deps blocks:pan-1 --json            # with dependency
```

### Dependencies (Blocked-By)
```bash
# Make issue-A blocked by issue-B (A cannot start until B is done)
bd dep add <blocked-issue> <blocker-issue> --type blocks

# Example: panopticon-abc1 is blocked by panopticon-def2
bd dep add panopticon-abc1 panopticon-def2 --type blocks

# View dependency tree
bd dep tree <id>
```

### Related Issues (No Blocking)
```bash
bd dep add <issue-a> <issue-b> --type related
```

### Update Issues
```bash
bd update <id> --status in_progress|open|closed --json
bd update <id> --priority 0-4 --json
bd update <id> --assignee "name" --json
bd update <id> --notes "Progress notes here" --json
bd update <id> --design "Design decisions" --json
bd update <id> --due "+2d" --json                # Due in 2 days
bd update <id> --claim --json                    # Claim issue (atomic)

# NOTE: No --blocked-by flag exists! Use 'bd dep add' instead
```

### Comments (For Progress Notes)
```bash
bd comments <id> --json                          # List comments
bd comments add <id> "Comment text" --json       # Add comment
```

### Labels
```bash
bd label add <id> <label> --json
bd label remove <id> <label> --json
bd update <id> --add-label urgent --json         # Alternative
bd update <id> --remove-label wip --json
```

### View & Search
```bash
bd show <id> --json              # Full issue details
bd list --status open --json     # Filter by status
bd list --label bug --json       # Filter by label
bd list --assignee me --json     # My issues
bd search "keyword" --json       # Full-text search
bd count --status open --json    # Count issues
```

### Close & Reopen
```bash
bd close <id> --reason "Completed" --json
bd reopen <id> --reason "Need more work" --json
```

### Sync (End of Session)
```bash
bd sync                          # Commit and push to git (ALWAYS run at session end)
```

## Advanced Features

| Feature | CLI | Resource |
|---------|-----|----------|
| Molecules (templates) | `bd mol --help` | [MOLECULES.md](resources/MOLECULES.md) |
| Chemistry (pour/wisp) | `bd pour`, `bd wisp` | [CHEMISTRY_PATTERNS.md](resources/CHEMISTRY_PATTERNS.md) |
| Agent beads | `bd agent --help` | [AGENTS.md](resources/AGENTS.md) |
| Async gates | `bd gate --help` | [ASYNC_GATES.md](resources/ASYNC_GATES.md) |
| Worktrees | `bd worktree --help` | [WORKTREES.md](resources/WORKTREES.md) |

## Resources

| Resource | Content |
|----------|---------|
| [BOUNDARIES.md](resources/BOUNDARIES.md) | bd vs TodoWrite detailed comparison |
| [CLI_REFERENCE.md](resources/CLI_REFERENCE.md) | Complete command syntax |
| [DEPENDENCIES.md](resources/DEPENDENCIES.md) | Dependency system deep dive |
| [INTEGRATION_PATTERNS.md](resources/INTEGRATION_PATTERNS.md) | TodoWrite and tool integration |
| [ISSUE_CREATION.md](resources/ISSUE_CREATION.md) | When and how to create issues |
| [MOLECULES.md](resources/MOLECULES.md) | Proto definitions, component labels |
| [PATTERNS.md](resources/PATTERNS.md) | Common usage patterns |
| [RESUMABILITY.md](resources/RESUMABILITY.md) | Compaction survival guide |
| [STATIC_DATA.md](resources/STATIC_DATA.md) | Database schema reference |
| [TROUBLESHOOTING.md](resources/TROUBLESHOOTING.md) | Error handling and fixes |
| [WORKFLOWS.md](resources/WORKFLOWS.md) | Step-by-step workflow patterns |
| [AGENTS.md](resources/AGENTS.md) | Agent bead tracking (v0.40+) |
| [ASYNC_GATES.md](resources/ASYNC_GATES.md) | Human-in-the-loop gates |
| [CHEMISTRY_PATTERNS.md](resources/CHEMISTRY_PATTERNS.md) | Mol vs Wisp decision tree |
| [WORKTREES.md](resources/WORKTREES.md) | Parallel development patterns |

## Full Documentation

- **bd prime**: AI-optimized workflow context
- **GitHub**: [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
