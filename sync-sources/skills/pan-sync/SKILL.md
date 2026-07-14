---
name: pan-sync
description: "pan sync — distribute skills and agents to every supported Overdeck harness"
triggers:
  - pan sync
  - sync skills
  - update skills
  - refresh skills
  - sync overdeck
allowed-tools:
  - Bash
  - Read
---

# Skill Sync

## Overview

This skill guides you through syncing Overdeck skills to its supported agent harnesses. The sync process copies complete, manifest-managed skill bundles from `~/.overdeck/skills/` into each native discovery directory.

## Auto-Sync

`pan up` runs `pan sync --if-changed` automatically after the dashboard starts.
The startup sync skips work when sync inputs are unchanged. You rarely need to
run `pan sync` manually. Manual sync is useful when:

- You added new skills and want to sync without restarting the dashboard
- You want to preview changes with `--dry-run`
- You need to force-overwrite with `--force`

## How Sync Works

```
~/.overdeck/skills/          (Overdeck skills cache)
        ↓ pan sync (manifest-managed copies)
~/.claude/skills/            (Claude Code)
~/.agents/skills/            (Codex, Pi, Oh My Pi)

~/.overdeck/workspaces/       (Workspace directories)
        ↓ pan sync (copies CLAUDE.md)
~/.opencode/cl-aude-md/        (CLAUDE.md files)
        ↓
        feature-pan-73.md
        feature-pan-101.md
        ...
```

**Key points:**
- Skill bundles are copied recursively, including their scripts, references, and templates.
- Manifest ownership lets `pan sync` update Overdeck-managed files without overwriting user-owned skills.
- Claude Code discovers `~/.claude/skills/`; Codex, Pi, and Oh My Pi discover the shared Agent Skills standard directory at `~/.agents/skills/`.
- New harness sessions see changes after `pan sync`; already-running sessions keep the skill catalog loaded at launch.
- Invocation syntax belongs to the harness: Claude uses `/skill-name`, while Codex uses `$skill-name` or natural-language skill selection.

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
✓ Synced 24 Claude items and 24 shared skill files
```

Manual `pan sync` always runs a full sync, even when startup sync would skip.

### Startup Sync (Skip When Unchanged)

```bash
pan sync --if-changed
```

Used by `pan up` for the deferred background sync. If the sync-source inputs
are unchanged, it exits quickly:

```
[sync] skipped — inputs unchanged
```

Do not use `--if-changed` when you need to force a full refresh; run `pan sync`
or `pan sync --force` instead.

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

Bundled skills always reach every supported Overdeck agent harness; this is not an opt-in target list.

| Discovery contract | Directory | Harnesses |
|---|---|---|
| Claude Code | `~/.claude/skills/` | Claude Code |
| Agent Skills standard | `~/.agents/skills/` | Codex, Pi, Oh My Pi |

## Conflict Handling

A conflict occurs when an Overdeck-managed skill file was modified after installation. A pre-existing skill that Overdeck does not own is preserved.

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

**Option 3:** Keep both (rename Overdeck skill)
```bash
# Not recommended - better to use unique names
```

## Workflow

### Initial Setup

```bash
# 1. Initialize Overdeck (copies bundled skills)
pan init

# 2. Preview what will be synced
pan sync --dry-run

# 3. Execute sync
pan sync

# 4. Verify in your AI tool
# Claude: /skill-name; Codex: $skill-name
```

### After Adding Custom Skills

```bash
# 1. Add skill to Overdeck directory
mkdir -p ~/.overdeck/skills/my-skill
# Create SKILL.md with proper frontmatter

# 2. Sync to all tools
pan sync

# 3. Verify
pan skills
```

### After Updating Overdeck

```bash
# 1. Update package
npm update -g @overdeck/core

# 2. Re-run init to get new bundled skills
pan init

# 3. Sync to tools
pan sync
```

## Backups

By default, Overdeck creates backups before syncing.

### Backup Location

```
~/.overdeck/backups/
  2024-01-15T10-30-00/
    claude/
      skills/
    codex/
      skills/
```

### Restore from Backup

```bash
# List backups
ls ~/.overdeck/backups/

# Restore specific backup (manual)
cp -r ~/.overdeck/backups/2024-01-15T10-30-00/claude/skills/* ~/.claude/skills/
```

### Disable Backups

```toml
# In ~/.overdeck/config.toml
[sync]
backup_before_sync = false
```

## Troubleshooting

**Problem:** Skills not appearing in AI tool
**Solution:**
1. Run `pan sync` (not just `pan init`)
2. Check target is in config: `cat ~/.overdeck/config.toml`
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

These names are reserved by Overdeck. Don't use them for custom skills:

**Pan operations:** `pan-down`, `pan-help`, `pan-install`, `pan-issue`, `pan-plan`, `pan-quickstart`, `pan-setup`, `pan-status`, `pan-up`, `pan-config`, `pan-tracker`, `pan-projects`, `pan-sync`, `pan-docker`, `pan-network`, `pan-approve`, `pan-tell`, `pan-kill`, `pan-doctor`, `pan-diagnose`, `pan-logs`, `pan-rescue`

**Workflow skills:** `beads`, `bug-fix`, `code-review`, `code-review-performance`, `code-review-security`, `dependency-update`, `feature-work`, `incident-response`, `onboard-codebase`, `refactor`, `release`, `session-health`, `skill-creator`, `web-design-guidelines`, `work-complete`

## Related Skills

- `/pan:config` - Configure sync targets
- `/pan:help` - List all available skills
- `/pan:install` - Initial setup
