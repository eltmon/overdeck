---
name: update-panopticon-docs
version: "1.0.0"
description: Guide for updating Panopticon project documentation
compatibility: Claude Code 2.1.0+
triggers:
  - update panopticon docs
  - modify panopticon documentation
  - edit panopticon readme
  - update configuration docs
---

# Update Panopticon Docs Skill

Comprehensive guide for updating documentation in the Panopticon project.

## When to Use This Skill

Invoke this skill when you need to:
- Update project documentation after adding features
- Document new configuration options
- Add examples or troubleshooting guides
- Update API documentation
- Document third-party integrations (like Kimi API setup)

## Documentation Structure

Panopticon has three documentation locations:

### 1. Root Documentation (`/home/eltmon/projects/panopticon/`)

| File | Purpose | When to Update |
|------|---------|----------------|
| `README.md` | Project overview, quick start, installation | New features, major changes, getting started content |
| `CLAUDE.md` | Claude Code guidance for contributors | Agent workflow changes, commit requirements, critical warnings |
| `CONTRIBUTING.md` | Contribution guidelines | Development process changes |
| `AGENTS.md` | Agent system architecture | Agent types, communication patterns |

### 2. Docs Directory (`/home/eltmon/projects/panopticon/docs/`)

**Core Documentation:**

| File | Purpose | When to Update |
|------|---------|----------------|
| `CONFIGURATION.md` | Multi-model routing, API setup, presets | Configuration options, new providers, API integration examples |
| `WORK-TYPES.md` | Work type definitions and model assignments | New work types, phase changes |
| `SETTINGS-UI-DESIGN.md` | Settings UI design and implementation | UI changes, new settings |

**PRD Directory (`docs/prds/`):**
- `active/` - Active planning documents for in-progress issues
- `completed/` - Archived PRDs for completed work

### 3. CLI Documentation (`/home/eltmon/projects/panopticon/cli/`)

Command-specific documentation and help text.

## Common Documentation Tasks

### Adding Third-Party API Integration

**File**: `docs/CONFIGURATION.md`

Add new section after existing provider documentation:
1. Read the full file to understand structure
2. Add new section with:
   - Configuration steps
   - Environment variables (use correct names!)
   - Getting API keys
   - Verification steps
   - Resources/links
3. Update Table of Contents

**Example**: See "Using Alternative LLM APIs with Claude Code" section.

### Documenting New Features

**Files**: `README.md` + relevant docs in `docs/`

1. **README.md**: Add high-level feature description
2. **Detailed docs**: Add comprehensive guide in appropriate `docs/*.md` file
3. **CLAUDE.md**: Add agent-specific guidance if relevant

### Configuration Changes

**File**: `docs/CONFIGURATION.md`

1. Update preset definitions if models changed
2. Add new override examples
3. Update fallback mappings
4. Add migration notes if breaking changes

### API Changes

**File**: Update type definitions and generate new docs:
```bash
npm run docs  # Regenerates API documentation
```

## Best Practices

### 1. Read Before Writing
Always read the existing documentation file completely before making changes to understand:
- Current structure and formatting
- Existing examples and patterns
- Table of contents organization

### 2. Maintain Consistency
- Use existing markdown formatting style
- Follow existing heading hierarchy
- Match code block language tags
- Keep table formatting aligned

### 3. Progressive Disclosure
- Keep main sections concise with overview
- Link to detailed resources for deep dives
- Use collapsible sections for long content

### 4. Verification
After updating docs:
```bash
# Check for broken internal links
grep -r "](\./" docs/

# Verify markdown formatting
# (Visual inspection in preview)

# Check file exists
ls -l docs/CONFIGURATION.md
```

## Resources

For detailed guidance on specific documentation tasks:
- `resources/DOC_LOCATIONS.md` - Complete file index with descriptions
- `resources/STYLE_GUIDE.md` - Markdown style conventions
- `resources/EXAMPLES.md` - Common documentation patterns

## Quick Reference

**Read a doc file:**
```
Read /home/eltmon/projects/panopticon/docs/CONFIGURATION.md
```

**Update section:**
```
Edit the file with old_string/new_string matching existing content
```

**Verify changes:**
```bash
git diff docs/CONFIGURATION.md
```

## Version History

- 1.0.0 (2026-01-28): Initial skill creation with documentation index
