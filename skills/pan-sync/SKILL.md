---
name: pan-sync
description: Sync Panopticon skills to Claude Code and other AI tools
triggers:
  - pan sync
  - sync skills
  - update skills
  - refresh skills
  - sync panopticon
allowed-tools:
  - Bash
  - Read
---

# Skill Sync

## Overview

This skill guides you through syncing Panopticon skills to AI coding assistants. The sync process creates symlinks from `~/.panopticon/skills/` to each tool's skill directory and copies workspace CLAUDE.md files to `~/.opencode/cl-aude-md/`.

## When to Use

- After installing or updating Panopticon
- After adding new skills to `~/.panopticon/skills/`
- When skills aren't appearing in your AI tool
- When workspace CLAUDE.md files aren't available in opencode
- To check what would be synced (dry run)

## How Sync Works

```
~/.panopticon/skills/          (Panopticon skills - source)
        ↓ pan sync (creates symlinks)
~/.claude/skills/              (Claude Code)
~/.codex/skills/               (Codex)
~/.cursor/skills/              (Cursor)
~/.gemini/skills/              (Gemini CLI)
~/.opencode/skills/            (OpenCode)

~/.panopticon/workspaces/       (Workspace directories)
        ↓ pan sync (copies CLAUDE.md)
~/.opencode/cl-aude-md/        (CLAUDE.md files)
        ↓
        feature-pan-73.md
        feature-pan-101.md
        ...
```

**Key points:**
- Skills are symlinked, not copied
- Changes to source immediately reflect in all tools
- Project-specific skills in `{project}/.claude/skills/` are NOT touched
- Conflicts are detected and reported
- CLAUDE.md files are copied from `~/.panopticon/workspaces/` to `~/.opencode/cl-aude-md/`

## Commands

### Preview Sync (Dry Run)

```bash
pan sync --dry-run
```

Shows what would be synced without making changes:
```
Sync Plan (dry run):

claude:
  + skill/pan-help
  + skill/pan-up
  + skill/feature-work
  ! skill/my-custom [conflict]

Run without --dry-run to apply changes.
```

### Execute Sync

```bash
pan sync
```

Output:
```
✓ Synced 24 items to claude, codex, cursor, gemini
```

### Force Sync (Overwrite Conflicts)

```bash
pan sync --force
```

**Warning:** This overwrites any conflicting skills in target directories.

### Backup Only

```bash
pan sync --backup-only
```

Creates a backup without syncing.

## Sync Targets

Configure which tools to sync to in `~/.panopticon/config.toml`:

```toml
[sync]
targets = ["claude", "codex", "cursor", "gemini"]
backup_before_sync = true
```

### Available Targets

| Target | Directory | Tool |
|--------|-----------|------|
| `claude` | `~/.claude/skills/` | Claude Code, Cursor |
| `codex` | `~/.codex/skills/` | OpenAI Codex |
| `cursor` | `~/.cursor/skills/` | Cursor (alternative) |
| `gemini` | `~/.gemini/skills/` | Google Gemini CLI |
| `opencode` | `~/.opencode/skills/` | OpenCode |

## Conflict Handling

A conflict occurs when a skill with the same name exists in the target directory but isn't a Panopticon symlink.

### Detecting Conflicts

```bash
pan sync --dry-run
# Look for lines with [conflict]
```

### Resolving Conflicts

**Option 1:** Rename your custom skill
```bash
mv ~/.claude/skills/feature-work ~/.claude/skills/my-feature-work
pan sync
```

**Option 2:** Force overwrite (loses custom skill)
```bash
pan sync --force
```

**Option 3:** Keep both (rename Panopticon skill)
```bash
# Not recommended - better to use unique names
```

## Workflow

### Initial Setup

```bash
# 1. Initialize Panopticon (copies bundled skills)
pan init

# 2. Preview what will be synced
pan sync --dry-run

# 3. Execute sync
pan sync

# 4. Verify in your AI tool
# Skills should now appear with /skill-name
```

### After Adding Custom Skills

```bash
# 1. Add skill to Panopticon directory
mkdir -p ~/.panopticon/skills/my-skill
# Create SKILL.md with proper frontmatter

# 2. Sync to all tools
pan sync

# 3. Verify
pan skills
```

### After Updating Panopticon

```bash
# 1. Update package
npm update -g panopticon-cli

# 2. Re-run init to get new bundled skills
pan init

# 3. Sync to tools
pan sync
```

## Backups

By default, Panopticon creates backups before syncing.

### Backup Location

```
~/.panopticon/backups/
  2024-01-15T10-30-00/
    claude/
      skills/
    codex/
      skills/
```

### Restore from Backup

```bash
# List backups
ls ~/.panopticon/backups/

# Restore specific backup (manual)
cp -r ~/.panopticon/backups/2024-01-15T10-30-00/claude/skills/* ~/.claude/skills/
```

### Disable Backups

```toml
# In ~/.panopticon/config.toml
[sync]
backup_before_sync = false
```

## Troubleshooting

**Problem:** Skills not appearing in AI tool
**Solution:**
1. Run `pan sync` (not just `pan init`)
2. Check target is in config: `cat ~/.panopticon/config.toml`
3. Verify symlinks exist: `ls -la ~/.claude/skills/`

**Problem:** CLAUDE.md files not available in opencode
**Solution:**
1. Run `pan sync` to copy workspace CLAUDE.md files
2. Check files exist: `ls -la ~/.opencode/cl-aude-md/`
3. Create a new workspace: `pan workspace create PAN-XXX`

**Problem:** Sync reports conflicts
**Solution:**
1. Check what's conflicting: `pan sync --dry-run`
2. Rename your custom skill or use `--force`

**Problem:** Symlinks broken after moving directories
**Solution:**
1. Remove broken symlinks: `find ~/.claude/skills -xtype l -delete`
2. Re-run sync: `pan sync`

**Problem:** Permission denied
**Solution:**
1. Check directory permissions: `ls -la ~/.claude/`
2. Ensure you own the directories

## Reserved Skill Names

These names are reserved by Panopticon. Don't use them for custom skills:

**Pan operations:** `pan-down`, `pan-help`, `pan-install`, `pan-issue`, `pan-plan`, `pan-quickstart`, `pan-setup`, `pan-status`, `pan-up`, `pan-config`, `pan-tracker`, `pan-projects`, `pan-sync`, `pan-docker`, `pan-network`, `pan-approve`, `pan-tell`, `pan-kill`, `pan-health`, `pan-diagnose`, `pan-logs`, `pan-rescue`

**Workflow skills:** `beads`, `bug-fix`, `code-review`, `code-review-performance`, `code-review-security`, `dependency-update`, `feature-work`, `incident-response`, `onboard-codebase`, `refactor`, `release`, `session-health`, `skill-creator`, `web-design-guidelines`, `work-complete`

## Related Skills

- `/pan:config` - Configure sync targets
- `/pan:help` - List all available skills
- `/pan:install` - Initial setup
