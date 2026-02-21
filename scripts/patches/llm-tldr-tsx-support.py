#!/usr/bin/env python3
"""Patch llm-tldr to support .tsx and .jsx file extensions.

llm-tldr v1.5.2 maps TypeScript to only .ts in _get_module_exports().
This patch adds .tsx for TypeScript and .jsx for JavaScript.

Apply: python3 scripts/patches/llm-tldr-tsx-support.py <venv-path>
Example: python3 scripts/patches/llm-tldr-tsx-support.py .venv
"""

import sys
import re
from pathlib import Path

def patch_api(venv_path: str) -> bool:
    """Patch api.py in the given venv to support .tsx/.jsx extensions."""
    api_file = Path(venv_path) / "lib" / "python3.12" / "site-packages" / "tldr" / "api.py"

    if not api_file.exists():
        # Try python3.13, etc.
        for pydir in Path(venv_path).glob("lib/python3.*/site-packages/tldr/api.py"):
            api_file = pydir
            break

    if not api_file.exists():
        print(f"ERROR: {api_file} not found")
        return False

    content = api_file.read_text()

    # Check if already patched
    if '".tsx"' in content:
        print(f"Already patched: {api_file}")
        return True

    # Pattern: the old ext_map with single string values
    old_pattern = '''    ext_map = {
        "python": ".py",
        "typescript": ".ts",
        "go": ".go",
        "rust": ".rs"
    }
    ext = ext_map.get(language, ".py")'''

    new_code = '''    ext_map = {
        "python": [".py"],
        "typescript": [".ts", ".tsx"],
        "javascript": [".js", ".jsx"],
        "go": [".go"],
        "rust": [".rs"],
    }
    extensions = ext_map.get(language, [".py"])'''

    if old_pattern not in content:
        print(f"WARNING: Could not find ext_map pattern — may already be patched or llm-tldr version changed")
        return False

    content = content.replace(old_pattern, new_code)

    # Also fix the module file resolution to iterate over extensions
    old_resolve = '''    # Try to find the module file
    # module_path "providers/anthropic" -> providers/anthropic.py
    module_file = project / f"{module_path}{ext}"

    if not module_file.exists():
        # Try as directory with __init__.py (Python package)
        init_file = project / module_path / "__init__.py"
        if init_file.exists():
            module_file = init_file
        else:
            raise ValueError(f"Module not found: {module_path} (tried {module_file} and {init_file})")'''

    new_resolve = '''    # Try to find the module file
    # module_path "providers/anthropic" -> providers/anthropic.py
    module_file = None
    for ext in extensions:
        candidate = project / f"{module_path}{ext}"
        if candidate.exists():
            module_file = candidate
            break

    if module_file is None:
        # Try as directory with __init__.py (Python package)
        init_file = project / module_path / "__init__.py"
        if init_file.exists():
            module_file = init_file
        else:
            tried = ", ".join(str(project / f"{module_path}{e}") for e in extensions)
            raise ValueError(f"Module not found: {module_path} (tried {tried} and {init_file})")'''

    if old_resolve not in content:
        print(f"WARNING: Could not find module resolution pattern")
        return False

    content = content.replace(old_resolve, new_resolve)

    api_file.write_text(content)
    print(f"Patched: {api_file}")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 llm-tldr-tsx-support.py <venv-path>")
        print("Example: python3 llm-tldr-tsx-support.py .venv")
        sys.exit(1)

    success = patch_api(sys.argv[1])
    sys.exit(0 if success else 1)
