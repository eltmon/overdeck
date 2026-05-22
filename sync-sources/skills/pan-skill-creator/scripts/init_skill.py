#!/usr/bin/env python3
"""
Initialize a new skill directory structure.

Usage:
    python init_skill.py <skill-name> [--path <output-directory>]

Example:
    python init_skill.py pdf-editor --path ~/.claude/skills/
"""

import argparse
import os
from pathlib import Path

SKILL_TEMPLATE = '''---
name: {name}
description: TODO: Describe what this skill does AND when to use it. Include specific triggers and use cases. This is the primary mechanism Claude uses to decide when to activate this skill.
---

# {title}

TODO: Write instructions for using this skill.

## Overview

[What this skill does and why it exists]

## When to Use

[Specific scenarios and trigger phrases - move this to description field when done]

## Instructions

### Step 1: [First Action]

[Detailed instructions]

### Step 2: [Second Action]

[Detailed instructions]

## Examples

### Example 1: [Use Case]

Input: [What user might say]
Action: [What skill should do]

## References

- See `references/` for additional documentation (if needed)

## Notes

- [Any important caveats or limitations]
'''

README_TEMPLATE = '''# {title}

This is a Claude Code skill for {name}.

## Files

- `SKILL.md` - Main skill definition (required)
- `scripts/` - Executable automation scripts
- `references/` - Documentation loaded into context as needed
- `assets/` - Templates and files used in output

## Usage

This skill activates automatically when Claude detects relevant user intent
based on the description in SKILL.md frontmatter.
'''

def create_skill(name: str, output_path: str = "."):
    """Create a new skill directory structure."""

    # Validate name
    if not name.replace("-", "").replace("_", "").isalnum():
        raise ValueError(f"Skill name must be alphanumeric with hyphens/underscores: {name}")

    # Create skill directory
    skill_dir = Path(output_path) / name
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Create subdirectories
    (skill_dir / "scripts").mkdir(exist_ok=True)
    (skill_dir / "references").mkdir(exist_ok=True)
    (skill_dir / "assets").mkdir(exist_ok=True)

    # Create SKILL.md
    title = name.replace("-", " ").replace("_", " ").title()
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        skill_md.write_text(SKILL_TEMPLATE.format(name=name, title=title))
        print(f"Created: {skill_md}")
    else:
        print(f"Skipped (exists): {skill_md}")

    # Create example script
    example_script = skill_dir / "scripts" / "example.py"
    if not example_script.exists():
        example_script.write_text('''#!/usr/bin/env python3
"""
Example script - delete or replace with your actual scripts.

Scripts should be deterministic and handle errors gracefully.
"""

import sys

def main():
    print("Example script executed")
    # Your logic here
    return 0

if __name__ == "__main__":
    sys.exit(main())
''')
        example_script.chmod(0o755)
        print(f"Created: {example_script}")

    # Create example reference
    example_ref = skill_dir / "references" / "example.md"
    if not example_ref.exists():
        example_ref.write_text('''# Example Reference

Delete this file or replace with your actual reference documentation.

Reference files are loaded into context when Claude needs them.
Keep them focused and well-organized.

## Section 1

[Documentation content]

## Section 2

[More documentation]
''')
        print(f"Created: {example_ref}")

    # Create .gitkeep in assets
    gitkeep = skill_dir / "assets" / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.write_text("")
        print(f"Created: {gitkeep}")

    print(f"\nSkill '{name}' initialized at: {skill_dir}")
    print("\nNext steps:")
    print("1. Edit SKILL.md - write your description and instructions")
    print("2. Add scripts/ for repetitive automation")
    print("3. Add references/ for documentation Claude should reference")
    print("4. Add assets/ for templates and output files")
    print("5. Delete example files you don't need")
    print("6. Test the skill with real usage")

def main():
    parser = argparse.ArgumentParser(description="Initialize a new Claude Code skill")
    parser.add_argument("name", help="Skill name (lowercase with hyphens)")
    parser.add_argument("--path", default=".", help="Output directory (default: current)")

    args = parser.parse_args()

    try:
        create_skill(args.name, args.path)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
