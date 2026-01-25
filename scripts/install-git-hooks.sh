#!/bin/bash
#
# Install Panopticon git hooks in a project's repos
# Usage: ./install-git-hooks.sh /path/to/project
#
# For poly-repos, this will find all .git directories and install hooks in each.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/git-hooks"
TARGET_DIR="${1:-.}"

if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory does not exist: $TARGET_DIR"
    exit 1
fi

echo "Installing Panopticon git hooks in: $TARGET_DIR"
echo ""

# Find all .git directories (not files - those are worktrees)
# Also exclude node_modules, target, etc.
find "$TARGET_DIR" -maxdepth 4 -type d -name ".git" \
    -not -path "*/node_modules/*" \
    -not -path "*/target/*" \
    -not -path "*/.git/*" \
    -not -path "*/workspaces/*" \
    2>/dev/null | while read git_dir; do

    hooks_target="$git_dir/hooks"
    repo_dir="$(dirname "$git_dir")"

    echo "Installing hooks in: $repo_dir"

    # Create hooks directory if it doesn't exist
    mkdir -p "$hooks_target"

    # Install each hook
    for hook in "$HOOKS_DIR"/*; do
        if [ -f "$hook" ]; then
            hook_name=$(basename "$hook")
            target_hook="$hooks_target/$hook_name"

            # Check if hook already exists
            if [ -f "$target_hook" ] && [ ! -L "$target_hook" ]; then
                echo "  ⚠️  $hook_name: existing hook found, creating backup"
                mv "$target_hook" "$target_hook.backup"
            fi

            # Create symlink to our hook
            ln -sf "$hook" "$target_hook"
            echo "  ✓ $hook_name installed"
        fi
    done

    echo ""
done

echo "Done! Git hooks installed."
echo ""
echo "The post-checkout hook will warn if the main project directory"
echo "is checked out to a branch other than 'main'."
echo ""
echo "To enable auto-revert (automatically switch back to main):"
echo "  export PANOPTICON_AUTO_REVERT_CHECKOUT=1"
