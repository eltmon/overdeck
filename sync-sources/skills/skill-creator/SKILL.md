---
name: skill-creator
description: Guide for creating effective Claude Code skills. Use when users want to create a new skill, update an existing skill, or need guidance on skill best practices. Triggers on requests like "create a skill", "make a new skill", "help me build a skill", "skill development", or "extend Claude's capabilities".
license: Apache 2.0 (based on Anthropic's skills repo)
---

# Skill Creator

Create effective skills that extend Claude's capabilities with specialized knowledge, workflows, and tools.

## Core Principles

### Concise is Key
The context window is shared. Only add what Claude doesn't already know. Challenge each piece: "Does this justify its token cost?"

### Degrees of Freedom
- **High freedom** (text instructions): Multiple valid approaches, context-dependent decisions
- **Medium freedom** (pseudocode/parameterized scripts): Preferred pattern exists, some variation OK
- **Low freedom** (specific scripts): Fragile operations, consistency critical

## Skill Anatomy

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description - REQUIRED)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/     - Executable code (deterministic, reusable)
    ├── references/  - Documentation loaded into context as needed
    └── assets/      - Files used in output (templates, images)
```

### Frontmatter (Critical)
```yaml
---
name: my-skill
description: What it does AND when to use it. This is the ONLY thing Claude sees to decide if the skill triggers. Be comprehensive.
---
```

### Progressive Disclosure
1. **Metadata** (~100 words) - Always in context
2. **SKILL.md body** (<5k words) - When skill triggers
3. **Bundled resources** - As needed

Keep SKILL.md under 500 lines. Split into references when approaching limit.

## Creation Process

### Step 1: Understand with Examples
- What functionality should this skill support?
- What would users say to trigger it?
- Can you give concrete usage examples?

### Step 2: Plan Reusable Contents
For each example, identify:
- Scripts for repetitive code
- References for documentation/schemas
- Assets for templates/boilerplate

### Step 3: Initialize
```bash
python scripts/init_skill.py <skill-name> --path <output-directory>
```

### Step 4: Implement
1. Create scripts/, references/, assets/ files
2. Test scripts by actually running them
3. Write SKILL.md with:
   - Comprehensive description in frontmatter
   - Instructions referencing bundled resources
   - Use imperative form ("Do X", not "You should do X")

### Step 5: Package
```bash
python scripts/package_skill.py <path/to/skill-folder> [output-dir]
```

### Step 6: Iterate
Use skill on real tasks → Notice struggles → Update → Test again

## What NOT to Include
- README.md, CHANGELOG.md, INSTALLATION_GUIDE.md
- Setup/testing procedures
- User-facing documentation
- Anything not needed by the AI agent

## Reference Files

- See `references/workflows.md` for multi-step process patterns
- See `references/output-patterns.md` for output format patterns
