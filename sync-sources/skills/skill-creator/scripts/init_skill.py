#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill from template

Usage:
    python init_skill.py <skill-name> --path <output-directory>

Example:
    python init_skill.py pdf-editor --path ./skills
"""

import argparse
import re
import sys
from pathlib import Path

SKILL_MD_TEMPLATE = '''---
name: {skill_name}
description: TODO - Describe what this skill does AND when to use it. Include trigger phrases.
---

# {skill_title}

TODO: Write instructions for using this skill.

## Overview

TODO: Brief description of what this skill does.

## Usage

TODO: How to use this skill.

## Resources

- `scripts/` - Executable automation scripts
- `references/` - Documentation loaded as needed
- `assets/` - Templates and files for output
'''

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Example script - replace with your actual script.
"""

def main():
    print("Hello from {skill_name}!")

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = '''# {skill_title} Reference

This is an example reference file. Replace with actual documentation.

## Section 1

TODO: Add reference content here.
'''


def validate_skill_name(name: str) -> bool:
    """Validate skill name follows conventions."""
    if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$', name):
        return False
    if len(name) > 40:
        return False
    if '--' in name:
        return False
    return True


def to_title(skill_name: str) -> str:
    """Convert skill-name to Skill Name."""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))


def init_skill(skill_name: str, output_path: Path) -> bool:
    """Initialize a new skill directory structure."""

    if not validate_skill_name(skill_name):
        print(f"Error: Invalid skill name '{skill_name}'")
        print("  - Use lowercase letters, digits, and hyphens only")
        print("  - Must start and end with letter or digit")
        print("  - Maximum 40 characters")
        print("  - No consecutive hyphens")
        return False

    skill_dir = output_path / skill_name

    if skill_dir.exists():
        print(f"Error: Directory already exists: {skill_dir}")
        return False

    skill_title = to_title(skill_name)

    # Create directories
    skill_dir.mkdir(parents=True)
    (skill_dir / 'scripts').mkdir()
    (skill_dir / 'references').mkdir()
    (skill_dir / 'assets').mkdir()

    # Create SKILL.md
    skill_md = skill_dir / 'SKILL.md'
    skill_md.write_text(SKILL_MD_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=skill_title
    ))

    # Create example script
    example_script = skill_dir / 'scripts' / 'example.py'
    example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
    example_script.chmod(0o755)

    # Create example reference
    example_ref = skill_dir / 'references' / 'example.md'
    example_ref.write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title))

    # Create .gitkeep in assets
    (skill_dir / 'assets' / '.gitkeep').touch()

    print(f"Created skill: {skill_dir}")
    print()
    print("Next steps:")
    print(f"  1. Edit {skill_dir}/SKILL.md")
    print(f"  2. Add scripts to {skill_dir}/scripts/")
    print(f"  3. Add references to {skill_dir}/references/")
    print(f"  4. Add assets to {skill_dir}/assets/")
    print(f"  5. Delete example files you don't need")

    return True


def main():
    parser = argparse.ArgumentParser(description='Initialize a new skill')
    parser.add_argument('skill_name', help='Name of the skill (hyphen-case)')
    parser.add_argument('--path', required=True, help='Output directory')

    args = parser.parse_args()

    output_path = Path(args.path).resolve()

    if not output_path.exists():
        output_path.mkdir(parents=True)

    success = init_skill(args.skill_name, output_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
