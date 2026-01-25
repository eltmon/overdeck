# PAN-86: Beads skill - Clarify beads ID vs GitHub/Linear issue ID confusion

## Problem Statement

Agents using the beads skill are getting confused between three different ID systems:

| System | Format | Example |
|--------|--------|---------|
| Beads | `repo-hash` | `panopticon-3eb7`, `panopticon-6ax` |
| Beads (hierarchical) | `repo-hash.N` | `panopticon-3eb7.4` |
| GitHub Issues | `PREFIX-number` | `PAN-84`, `PAN-73` |
| Linear Issues | `PREFIX-number` | `MIN-123`, `HH-456` |

**Root cause:** The SKILL.md example uses `pan-5` which looks confusingly similar to GitHub's `PAN-5`:

```bash
# Example: PAN-5 is blocked by PAN-1
bd dep add pan-5 pan-1 --type blocks
```

This caused the agent in planning-pan-84 to try `bd create --parent PAN-84` instead of a valid beads ID.

## Decisions Made

### Scope: Docs + CLI Enhancement Follow-up
- Fix documentation in SKILL.md
- Create upstream GitHub issue for `bd list --external-ref` filter

### Linking Pattern: Recommend `--external-ref`
The canonical way to link beads issues to external trackers:
```bash
bd create "Fix auth bug" --external-ref PAN-84 --json
```

### Location: In SKILL.md Directly
Add a dedicated "## ID Systems" section near the top of SKILL.md for maximum visibility.

### Upstream Enhancement: Yes
Create GitHub issue in steveyegge/beads requesting `bd list --external-ref PAN-84` filter capability.

## Implementation Plan

### Task 1: Add ID Systems Section to SKILL.md
Add new section after "## bd vs TodoWrite" explaining:
- Beads ID format (`repo-hash`)
- How it differs from GitHub/Linear IDs
- Clear warning that `--parent`, `--deps` expect beads IDs

### Task 2: Fix Confusing Example
Replace the problematic example:
```bash
# BEFORE (confusing)
# Example: PAN-5 is blocked by PAN-1
bd dep add pan-5 pan-1 --type blocks

# AFTER (clear)
# Example: panopticon-abc1 is blocked by panopticon-def2
bd dep add panopticon-abc1 panopticon-def2 --type blocks
```

### Task 3: Document External Tracker Linking
Add workflow for linking beads to GitHub/Linear:
- Using `--external-ref` flag on create
- Current limitation: no `bd list --external-ref` filter
- Workaround: use labels or title conventions

### Task 4: Create Upstream GitHub Issue
File issue in steveyegge/beads requesting:
- `bd list --external-ref PAN-84` filter
- `bd show --by-external-ref PAN-84` lookup

## Files to Modify

| File | Change |
|------|--------|
| `/home/eltmon/projects/panopticon/skills/beads/SKILL.md` | Add ID Systems section, fix example, document --external-ref |

## Out of Scope

- Changes to beads CLI itself (that's upstream work)
- Changes to other resource files (keep focused)
- Adding new resource files (keep it in SKILL.md for visibility)

## Success Criteria

1. An agent reading SKILL.md clearly understands beads IDs vs GitHub/Linear IDs
2. The confusing `pan-5` / `PAN-5` example is replaced with realistic beads IDs
3. The `--external-ref` flag is documented with example usage
4. Upstream issue filed for `bd list --external-ref` capability
