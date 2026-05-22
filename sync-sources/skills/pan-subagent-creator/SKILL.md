---
name: pan-subagent-creator
description: Create custom Claude Code subagents with isolated context windows, specific tool permissions, and specialized prompts. Use when users want to create a new subagent, configure agent delegation, set up task-specific agents, or define specialized assistants. Triggers on "create a subagent", "make a custom agent", "define an agent", "agent configuration", or "Task tool agent".
---

# Subagent Creator

Create specialized subagents that handle specific tasks with their own context windows, system prompts, and tool permissions.

## What Are Subagents?

Subagents are mini-agents with:
- **Independent context window** - Keep exploration out of main conversation
- **Custom system prompt** - Specialized behavior and expertise
- **Scoped tool permissions** - Least-privilege access
- **Model selection** - Cost optimization (Haiku for read-only, Sonnet for complex)

Claude delegates to subagents via the **Task tool** based on matching descriptions.

## Subagent Anatomy

Subagents are Markdown files with YAML frontmatter:

```markdown
---
name: code-reviewer
description: Expert code review. Use proactively after code changes.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior code reviewer focusing on quality, security, and best practices.

[Instructions for the subagent...]
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (lowercase, hyphens allowed) |
| `description` | Yes | When Claude should delegate - this is how Claude decides |
| `tools` | No | Allowed tools (inherits all if omitted) |
| `disallowedTools` | No | Tools to explicitly deny |
| `model` | No | `haiku`, `sonnet`, `opus`, or `inherit` (default: sonnet) |
| `permissionMode` | No | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `skills` | No | Skills to load at startup |
| `hooks` | No | Lifecycle hooks for validation |

## Storage Locations

| Location | Scope | Use Case |
|----------|-------|----------|
| `.claude/agents/` | Current project | Team-shared subagents |
| `~/.claude/agents/` | All projects | Personal, reusable subagents |
| CLI `--agents` flag | Current session | Quick testing |

## Model Selection for Cost

| Model | Cost | Best For |
|-------|------|----------|
| **Haiku** | Lowest | Read-only exploration, simple validation |
| **Sonnet** | Medium | Most tasks, good balance |
| **Opus** | Highest | Complex reasoning, critical decisions |
| **inherit** | Parent's | Match main conversation |

## Permission Modes

```yaml
permissionMode: default        # Normal permission prompts
permissionMode: acceptEdits    # Auto-accept file edits
permissionMode: dontAsk        # Auto-deny all prompts
permissionMode: bypassPermissions  # Skip all checks (dangerous)
permissionMode: plan           # Read-only exploration mode
```

## Common Tool Sets

**Read-only agents:**
```yaml
tools: Read, Grep, Glob
```

**Code review agents:**
```yaml
tools: Read, Grep, Glob, Bash
```

**Full development agents:**
```yaml
tools: Read, Write, Edit, Bash, Grep, Glob
```

**Restricted bash (specific commands only):**
```yaml
tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*)
```

## Creation Process

### Step 1: Define Purpose
- What specific task does this agent handle?
- What expertise should it have?
- What tools does it need (minimum necessary)?

### Step 2: Write Description
The description is how Claude decides when to delegate. Make it specific:

**Good:** "Expert database query optimizer. Analyzes SQL queries for performance issues, suggests indexes, and rewrites slow queries."

**Bad:** "Helps with database stuff."

### Step 3: Create Agent File

```bash
# Project-level (shared with team)
mkdir -p .claude/agents
touch .claude/agents/my-agent.md

# User-level (personal)
mkdir -p ~/.claude/agents
touch ~/.claude/agents/my-agent.md
```

### Step 4: Write Instructions
Use imperative voice. Be specific about:
- What the agent should do when invoked
- How to structure output
- What to avoid
- Error handling

### Step 5: Test Delegation
Try prompts that should and shouldn't trigger the agent. Refine description if needed.

## Example: Code Reviewer

```markdown
---
name: code-reviewer
description: Expert code review specialist. Reviews code for quality, security, and maintainability. Use proactively after code changes or when user asks for review.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards.

When invoked:
1. Run `git diff` to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation present
- Good test coverage
- Performance considered

Provide feedback by priority:
- **Critical** (must fix)
- **Warning** (should fix)
- **Suggestion** (consider)

Include specific examples of how to fix issues.
```

## Example: Database Read-Only Agent with Hooks

```markdown
---
name: db-reader
description: Execute read-only database queries. Use when user needs data analysis without modification risk.
tools: Bash
model: haiku
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly.sh"
---

You are a database analyst with read-only access.
Execute SELECT queries to answer questions about data.

You cannot modify data. If asked to INSERT, UPDATE, DELETE,
or modify schema, explain you only have read access.
```

## Example: Test Runner

```markdown
---
name: test-runner
description: Run and analyze test suites. Returns only failures and summary, keeping main context clean. Use after code changes or when user asks to run tests.
tools: Bash, Read, Grep
model: haiku
---

You are a test execution specialist.

When invoked:
1. Identify test framework (jest, pytest, vitest, etc.)
2. Run full test suite
3. Analyze failures
4. Return concise summary:
   - Total tests / passed / failed
   - Failed test names and reasons
   - Suggested fixes if obvious

Do NOT include passing test details - only failures matter.
```

## Hooks for Validation

Add validation scripts to enforce constraints:

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
```

## Built-in Subagents

Claude Code includes:

| Name | Model | Purpose |
|------|-------|---------|
| **Explore** | Haiku | Fast, read-only codebase analysis |
| **Plan** | Inherited | Research for plan mode |
| **general-purpose** | Inherited | Complex multi-step tasks |
| **Bash** | Inherited | Terminal commands in isolation |

## Key Constraints

1. **Subagents cannot spawn subagents** - Don't include Task in tools
2. **Context is isolated** - Results must be explicitly returned
3. **Tools must be allowed** - Can't use tools not in your list
4. **Hooks run in order** - PreToolUse blocks can reject operations

## Common Patterns

### 1. Isolate High-Volume Operations
Run tests/linting in subagent, return only failures to main conversation.

### 2. Parallel Research
Multiple subagents explore different aspects, results synthesized by main agent.

### 3. Cost Optimization
Route read-only tasks to Haiku, complex reasoning to Sonnet/Opus.

### 4. Security Boundaries
Restrict tools to minimum needed. Use hooks for additional validation.

## CLI-Defined Subagents

For quick testing without files:

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer.",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

## Troubleshooting

**Agent not triggering:**
- Check description matches user intent
- Verify file is in correct location
- Check YAML frontmatter syntax

**Agent has wrong permissions:**
- Explicitly list required tools
- Check `disallowedTools` doesn't block needed tools

**Agent too expensive:**
- Use `model: haiku` for simple tasks
- Scope tools to minimum needed
