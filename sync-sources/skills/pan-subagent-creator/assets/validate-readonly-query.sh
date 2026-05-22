#!/bin/bash
# Validation hook for read-only database queries
# Blocks any SQL that could modify data
#
# Usage: This script receives JSON input on stdin from Claude Code hooks
# Exit codes:
#   0 - Allow the command
#   2 - Block the command (with error message to stderr)

# Read JSON input from stdin
INPUT=$(cat)

# Extract the command field using jq
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# If no command, allow (might be different tool input format)
if [ -z "$COMMAND" ]; then
    exit 0
fi

# Convert to uppercase for case-insensitive matching
UPPER_COMMAND=$(echo "$COMMAND" | tr '[:lower:]' '[:upper:]')

# Block write operations
BLOCKED_KEYWORDS="INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE"

if echo "$UPPER_COMMAND" | grep -E "\b($BLOCKED_KEYWORDS)\b" > /dev/null; then
    echo "BLOCKED: Write operations not allowed. This agent has read-only access." >&2
    echo "Detected potentially modifying SQL keyword in command." >&2
    echo "Use SELECT queries only for data analysis." >&2
    exit 2
fi

# Allow the command
exit 0
