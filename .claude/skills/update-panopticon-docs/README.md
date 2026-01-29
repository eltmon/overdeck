# Update Panopticon Docs Skill

A Claude Code skill for efficiently updating Panopticon project documentation.

## What This Skill Does

This skill provides Claude Code with:
- **Complete documentation index** - All doc files and their purposes
- **Update guidelines** - When and how to update each file
- **Style conventions** - Consistent formatting and structure
- **Verification steps** - How to check documentation changes

## Installation

This skill is automatically available when working in the Panopticon project. It's synced via `pan sync` to all Panopticon contributors.

### Manual Installation (if needed)

```bash
# The skill is in the project repository
cd /home/eltmon/projects/panopticon/.claude/skills/update-panopticon-docs

# Sync to your Claude Code skills (done automatically by pan sync)
pan sync
```

## When Claude Uses This Skill

The skill activates when:
- Asked to "update docs" or "modify documentation"
- Adding new features that need documentation
- Fixing documentation errors or outdated content
- Adding configuration examples

## Usage Examples

**Update configuration docs:**
```
Use the update-panopticon-docs skill to add Kimi API setup to CONFIGURATION.md
```

**Find right doc file:**
```
Which file should I update to document the new convoy reviewer feature?
```

**Check documentation structure:**
```
What's the structure of the docs directory?
```

## File Structure

```
update-panopticon-docs/
├── SKILL.md                     # Main skill (Claude reads this)
├── README.md                    # This file (for humans)
├── CLAUDE.md                    # Maintenance guide
└── resources/
    ├── DOC_LOCATIONS.md         # Complete file index
    ├── STYLE_GUIDE.md           # Markdown conventions
    └── EXAMPLES.md              # Common patterns
```

## Benefits

- **Faster updates**: No searching for the right file
- **Consistency**: Follows established patterns
- **Completeness**: Doesn't miss related files
- **Quality**: Built-in verification steps

## Contributing

When Panopticon's documentation structure changes:
1. Update `resources/DOC_LOCATIONS.md` with new files
2. Update SKILL.md if major structure changes
3. Bump version in SKILL.md frontmatter
4. Commit and push (synced via `pan sync`)

## Version

Current version: 1.0.0

Compatible with: Claude Code 2.1.0+
