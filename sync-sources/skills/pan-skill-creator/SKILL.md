---
name: pan-skill-creator
description: Create effective Claude Code skills with specialized knowledge, workflows, and tools. Use when users want to create a new skill, update an existing skill, learn skill best practices, or extend Claude's capabilities. Triggers on "create a skill", "make a new skill", "skill development", "build a skill", or "extend capabilities".
---

# Skill Creator

Create skills that transform Claude from general-purpose into a specialized agent with procedural knowledge.

## Core Principles

### 1. Concise is Key
The context window is shared. Claude is already very smart - only add what Claude doesn't already know. Challenge each piece: "Does this justify its token cost?"

### 2. Degrees of Freedom
Match specificity to task fragility:

| Freedom Level | When to Use | Format |
|---------------|-------------|--------|
| **High** | Multiple valid approaches, context-dependent | Text instructions |
| **Medium** | Preferred pattern exists, some variation OK | Pseudocode, parameterized scripts |
| **Low** | Fragile operations, consistency critical | Specific scripts, few parameters |

### 3. Progressive Disclosure
Three-level loading system:
1. **Metadata** (~100 words) - Always in context
2. **SKILL.md body** (<5k words) - When skill triggers
3. **Bundled resources** - As needed (unlimited)

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
description: What it does AND when to use it. This is the ONLY thing Claude sees to decide if the skill triggers. Be comprehensive but under 200 chars.
---
```

**Strong descriptions include:**
- Specific verbs (extract, create, merge, validate)
- Concrete use cases
- Explicit boundaries ("Not for X")
- Trigger phrases users might say

### Bundled Resources

| Directory | Purpose | When to Include |
|-----------|---------|-----------------|
| `scripts/` | Python/Bash automation | Same code rewritten repeatedly OR deterministic reliability needed |
| `references/` | Docs, schemas, APIs | Large documentation Claude should reference while working |
| `assets/` | Templates, images, fonts | Files used in output but not loaded into context |

Use `{baseDir}` for portable paths: `{baseDir}/scripts/helper.py`

### What NOT to Include
- README.md, CHANGELOG.md, INSTALLATION_GUIDE.md
- Setup/testing procedures for humans
- User-facing documentation
- Anything not needed by the AI agent

## Creation Process

### Step 1: Understand with Examples
Ask:
- "What functionality should this skill support?"
- "Can you give examples of how it would be used?"
- "What would a user say that should trigger this?"

### Step 2: Plan Reusable Contents
For each example, identify:
- Scripts for repetitive code
- References for documentation/schemas
- Assets for templates/boilerplate

### Step 3: Initialize Structure
```bash
mkdir -p skill-name/{scripts,references,assets}
touch skill-name/SKILL.md
```

### Step 4: Implement

**Writing guidelines:**
- Always use imperative form ("Do X", not "You should do X")
- Keep SKILL.md under 500 lines
- Test scripts by actually running them
- Delete unused example directories

**Organize by domain for multi-domain skills:**
```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md
    ├── sales.md
    └── product.md
```

### Step 5: Test

| Test Type | What to Verify |
|-----------|----------------|
| Normal operations | Typical requests handled correctly |
| Edge cases | Graceful handling of incomplete/unusual inputs |
| Out-of-scope | Skill stays dormant on related but distinct tasks |
| Triggering | Activation on explicit and natural requests |

### Step 6: Iterate
Use skill on real tasks → Notice struggles → Update → Test again

## Common Patterns

### Pattern 1: High-level guide with conditional references
```markdown
# PDF Processing

## Quick start
[Basic example]

## Advanced features
- **Form filling**: See references/FORMS.md for complete guide
- **API reference**: See references/REFERENCE.md for all methods
```

### Pattern 2: Script automation
```markdown
## Rotate PDF
Run the rotation script:
\`\`\`bash
python {baseDir}/scripts/rotate_pdf.py --input "$FILE" --degrees 90
\`\`\`
```

### Pattern 3: Wizard workflow
Break complex tasks into discrete steps with user confirmation gates between phases.

## Tool Permissions (Advanced)

Scope tool access for security:
```yaml
allowed-tools: "Bash(git status:*),Bash(git diff:*),Read,Grep"
```

## Key Takeaways

1. **Description is everything** - Primary triggering mechanism
2. **Be concise** - Every token costs context space
3. **Use progressive disclosure** - Load detail only when needed
4. **Write for another Claude** - Procedural knowledge that wouldn't be obvious
5. **Test triggering** - Verify activation on intended requests
6. **Iterate** - Refine based on real usage

## Reference Files
- See `references/workflows.md` for multi-step process patterns
- See `references/output-patterns.md` for output format patterns
