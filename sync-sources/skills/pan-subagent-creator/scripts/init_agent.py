#!/usr/bin/env python3
"""
Initialize a new subagent file.

Usage:
    python init_agent.py <agent-name> [--scope project|user] [--tools TOOLS]

Example:
    python init_agent.py code-reviewer --scope project --tools "Read,Grep,Glob,Bash"
    python init_agent.py db-reader --scope user --tools "Bash"
"""

import argparse
import os
from pathlib import Path

AGENT_TEMPLATE = '''---
name: {name}
description: TODO: Describe what this agent does AND when Claude should delegate to it. Be specific about capabilities and triggers.
tools: {tools}
model: {model}
---

# {title} Agent

TODO: Write instructions for this agent.

## Purpose

[What specific task this agent handles]

## When Invoked

1. [First action to take]
2. [Second action]
3. [Continue as needed]

## Output Format

[How to structure the response back to main agent]

## Constraints

- [What this agent should NOT do]
- [Limitations to be aware of]

## Examples

### Example Task
Input: [What user might ask]
Action: [What agent should do]
Output: [What to return]
'''

def get_agent_path(scope: str) -> Path:
    """Get the appropriate agent directory based on scope."""
    if scope == "project":
        return Path(".claude/agents")
    elif scope == "user":
        return Path.home() / ".claude" / "agents"
    else:
        raise ValueError(f"Invalid scope: {scope}. Use 'project' or 'user'")

def create_agent(name: str, scope: str, tools: str, model: str):
    """Create a new subagent file."""

    # Validate name
    if not name.replace("-", "").replace("_", "").isalnum():
        raise ValueError(f"Agent name must be alphanumeric with hyphens/underscores: {name}")

    # Get agent directory
    agent_dir = get_agent_path(scope)
    agent_dir.mkdir(parents=True, exist_ok=True)

    # Create agent file
    agent_file = agent_dir / f"{name}.md"
    title = name.replace("-", " ").replace("_", " ").title()

    if agent_file.exists():
        print(f"Agent already exists: {agent_file}")
        response = input("Overwrite? [y/N]: ")
        if response.lower() != "y":
            print("Aborted.")
            return

    agent_file.write_text(AGENT_TEMPLATE.format(
        name=name,
        title=title,
        tools=tools,
        model=model
    ))

    print(f"Created agent: {agent_file}")
    print(f"\nScope: {scope}")
    print(f"Tools: {tools}")
    print(f"Model: {model}")
    print("\nNext steps:")
    print("1. Edit the description - this is how Claude decides when to delegate")
    print("2. Write specific instructions for the agent's behavior")
    print("3. Test by asking Claude tasks that should trigger this agent")
    print("4. Refine description if delegation isn't working as expected")

def main():
    parser = argparse.ArgumentParser(description="Initialize a new Claude Code subagent")
    parser.add_argument("name", help="Agent name (lowercase with hyphens)")
    parser.add_argument("--scope", choices=["project", "user"], default="project",
                        help="Where to create: project (.claude/agents) or user (~/.claude/agents)")
    parser.add_argument("--tools", default="Read, Grep, Glob",
                        help="Comma-separated list of allowed tools")
    parser.add_argument("--model", default="sonnet",
                        choices=["haiku", "sonnet", "opus", "inherit"],
                        help="Model to use (default: sonnet)")

    args = parser.parse_args()

    try:
        create_agent(args.name, args.scope, args.tools, args.model)
    except Exception as e:
        print(f"Error: {e}")
        return 1

    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
