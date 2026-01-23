---
name: pan-skill-creator
description: Guide for Panopticon developers on creating and distributing skills
triggers:
  - create a skill
  - add a skill
  - new skill for panopticon
  - make skill available to all users
---

# Panopticon Skill Development Guide

**This skill is for Panopticon developers only.** It teaches how to create skills that are distributed with Panopticon to all users.

## How Skills Are Distributed

Panopticon has a two-stage skill distribution system:

### 1. Source Locations

| Location | Purpose | Distributed to Users |
|----------|---------|---------------------|
| `panopticon/skills/` | Public skills for all users | Yes (via `pan install`) |
| `panopticon/dev-skills/` | Developer-only skills | No (only when running from repo) |
| `~/.panopticon/skills/` | User's installed skills | N/A (destination, not source) |
| `~/.claude/skills/` | Active skills for Claude Code | N/A (destination, not source) |

### 2. Installation Flow

```
pan install (first time)
    └── Copies panopticon/skills/* → ~/.panopticon/skills/
    
pan sync
    └── Symlinks ~/.panopticon/skills/* → ~/.claude/skills/
    └── (In dev mode) Also symlinks panopticon/dev-skills/* → ~/.claude/skills/
```

## Creating a New Skill

### Step 1: Decide Visibility

**Public skill (all users):** Create in `panopticon/skills/`
**Dev-only skill:** Create in `panopticon/dev-skills/`

### Step 2: Create Skill Directory

```bash
# For public skills
mkdir -p /path/to/panopticon/skills/my-skill

# For dev-only skills
mkdir -p /path/to/panopticon/dev-skills/my-skill
```

### Step 3: Create SKILL.md

Every skill needs a `SKILL.md` file with frontmatter:

```markdown
---
name: my-skill
description: Brief description shown in skill list
triggers:
  - keyword that triggers this skill
  - another trigger phrase
---

# Skill Title

Content and instructions for the skill...
```

### Step 4: Test Locally

```bash
# Rebuild Panopticon
cd /path/to/panopticon && npm run build

# Sync skills (dev mode auto-detected)
pan sync --force

# Verify skill appears
pan skills | grep my-skill
```

### Step 5: Commit and Push

```bash
git add skills/my-skill/SKILL.md  # or dev-skills/
git commit -m "feat: add my-skill for [purpose]"
git push
```

## Key Points

1. **Always add skills to the Panopticon repo** unless the user explicitly says to create a personal/local skill
2. **`pan install` copies skills** from package to ~/.panopticon/skills/ (doesn't overwrite existing)
3. **`pan sync` creates symlinks** from ~/.panopticon/skills/ to ~/.claude/skills/
4. **Dev mode** (detected by dev-skills/ existing) also syncs dev-skills/

## Skill Best Practices

1. **Clear triggers** - Include common phrases users might say
2. **Actionable instructions** - Tell Claude exactly what to do
3. **Include examples** - Show bash commands, file structures
4. **Keep focused** - One skill, one purpose
5. **Test before commit** - Run `pan sync --force` and verify

## Updating Existing Skills

When updating a skill:

1. Edit the file in `panopticon/skills/my-skill/SKILL.md`
2. Run `npm run build`
3. Run `pan sync --force` to update symlinks
4. Test the skill works
5. Commit and push

Note: Users who already have the skill won't get updates automatically until they run `pan install --force` or manually update.
