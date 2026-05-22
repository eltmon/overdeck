#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable .skill file

Usage:
    python package_skill.py <path/to/skill-folder> [output-directory]

Example:
    python package_skill.py ./my-skill
    python package_skill.py ./my-skill ./dist
"""

import sys
import zipfile
import re
from pathlib import Path


def validate_skill(skill_path: Path) -> tuple[bool, str]:
    """Validate skill structure and contents."""

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text()

    # Check frontmatter
    if not content.startswith('---'):
        return False, "SKILL.md must start with YAML frontmatter (---)"

    # Extract frontmatter
    parts = content.split('---', 2)
    if len(parts) < 3:
        return False, "Invalid frontmatter format"

    frontmatter = parts[1]

    # Check required fields
    if 'name:' not in frontmatter:
        return False, "Frontmatter missing 'name' field"
    if 'description:' not in frontmatter:
        return False, "Frontmatter missing 'description' field"

    # Check description isn't a TODO
    if 'TODO' in frontmatter:
        return False, "Frontmatter contains TODO - please complete the description"

    # Check for body content
    body = parts[2].strip()
    if len(body) < 50:
        return False, "SKILL.md body is too short"

    return True, "Skill is valid"


def package_skill(skill_path: Path, output_dir: Path = None) -> Path:
    """Package a skill folder into a .skill file."""

    if not skill_path.exists():
        print(f"Error: Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"Error: Path is not a directory: {skill_path}")
        return None

    # Validate
    print("Validating skill...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"Validation failed: {message}")
        return None
    print(f"  {message}")

    # Determine output
    skill_name = skill_path.name
    if output_dir:
        output_dir = Path(output_dir).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
    else:
        output_dir = Path.cwd()

    skill_filename = output_dir / f"{skill_name}.skill"

    # Create zip
    try:
        with zipfile.ZipFile(skill_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in skill_path.rglob('*'):
                if file_path.is_file():
                    # Skip common exclusions
                    if file_path.name.startswith('.') and file_path.name != '.gitkeep':
                        continue
                    if '__pycache__' in str(file_path):
                        continue

                    arcname = file_path.relative_to(skill_path.parent)
                    zipf.write(file_path, arcname)
                    print(f"  Added: {arcname}")

        print(f"\nPackaged skill to: {skill_filename}")
        return skill_filename

    except Exception as e:
        print(f"Error creating .skill file: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python package_skill.py <path/to/skill-folder> [output-directory]")
        sys.exit(1)

    skill_path = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None

    print(f"Packaging skill: {skill_path}")
    result = package_skill(skill_path, output_dir)
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
