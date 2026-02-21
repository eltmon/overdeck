---
name: pan-tldr
description: TLDR code analysis — token-efficient codebase understanding. Use before reading large files.
triggers:
  - tldr
  - code analysis
  - understand codebase
  - explore code
  - what does this file do
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# TLDR Code Analysis

## What It Is

TLDR is a 5-layer code analysis tool that produces structured summaries using 500-1,200 tokens per file instead of 10-25k for raw reads. It extends how much work you can accomplish per session by 10-20x.

## When to Use TLDR

**Always use TLDR first when:**
- Exploring unfamiliar code (use `tldr context` or `tldr structure`)
- Understanding function relationships (use `tldr calls` or `tldr impact`)
- Searching code by description (use `tldr semantic`)
- Planning changes across multiple files

**Read the full file when:**
- You need exact line numbers for editing
- The file is small (< 3KB)
- You need config files, docs, or non-code files
- TLDR context wasn't sufficient for the specific section

## Decision Tree

```
Need to understand a file?
├── Small file (< 3KB) → Read directly
├── Need exact content for editing → Read with offset/limit
└── Understanding structure/relationships → Use TLDR first
    ├── "What does this file export?" → tldr context <file>
    ├── "What's in this directory?" → tldr structure <dir>
    ├── "What calls this function?" → tldr calls <func> <file>
    ├── "What does this function call?" → tldr impact <func> <file>
    ├── "Find code that handles X" → tldr semantic "X"
    └── "Show me the architecture" → tldr arch <dir>
```

## Available Commands

All commands run from the workspace root. The binary is at `.venv/bin/tldr`.

### Exploration

| Command | Purpose | Tokens |
|---------|---------|--------|
| `tldr context <file>` | File structure, exports, imports, key functions | ~800 |
| `tldr structure <dir>` | Directory layout and relationships | ~500 |
| `tldr tree <dir>` | File tree with language detection | ~200 |
| `tldr arch <dir>` | Architectural overview | ~600 |

### Relationships

| Command | Purpose | Tokens |
|---------|---------|--------|
| `tldr calls <file>` | What calls functions in this file (callers) | ~400 |
| `tldr impact <func> <file>` | What this function calls (callees) | ~400 |
| `tldr imports <file>` | What this file imports | ~200 |
| `tldr importers <file>` | What files import this one | ~200 |

### Analysis

| Command | Purpose | Tokens |
|---------|---------|--------|
| `tldr cfg <func> <file>` | Control flow graph | ~300 |
| `tldr dfg <func> <file>` | Data flow graph | ~300 |
| `tldr slice <func> <file>` | Program slice (dependency chain) | ~400 |
| `tldr dead <dir>` | Dead code detection | ~500 |
| `tldr change-impact <file>` | Files affected by changes to this file | ~300 |
| `tldr diagnostics <file>` | Type errors and lint issues | ~200 |

### Search

| Command | Purpose | Tokens |
|---------|---------|--------|
| `tldr search <pattern> <dir>` | Structural code search (AST-aware) | ~400 |
| `tldr semantic "query"` | Natural language code search (embedding-based) | ~500 |
| `tldr extract <symbol> <file>` | Extract specific function/class definition | ~300 |

## MCP Tools (if configured)

When TLDR is set up as an MCP server, Claude Code agents get these tools natively:
- `tldr_context <file>` — File structure overview
- `tldr_structure <directory>` — Directory layout
- `tldr_calls <function> <file>` — Call graph (callers)
- `tldr_impact <function> <file>` — Impact analysis (callees)
- `tldr_semantic <query>` — Natural language search

## Hook Integration

TLDR hooks run automatically:

- **Read enforcer** (PreToolUse): Intercepts reads on large code files (> 3KB) and returns TLDR summaries instead. To read the full file, use `Read` with `offset` and `limit` parameters.
- **Post-edit notify** (PostToolUse): Tracks edited files and triggers background re-warm after 10 edits to keep the index fresh.

## Index Management

```bash
# Check index status
pan tldr status

# Manually warm/rebuild the index
pan tldr warm

# Start/stop the daemon
pan tldr start
pan tldr stop
```

The index is built automatically:
- On workspace creation (background warm after daemon start)
- After merges to main (merge-agent triggers re-warm)
- After 10 code file edits (post-edit hook triggers re-warm)
- On `pan up` (main daemon starts)

## Token Savings Example

```
Without TLDR:
  20 files x 15,000 tokens = 300,000 tokens (exhausts context)

With TLDR:
  20 files x 800 tokens = 16,000 tokens (94% savings)
  + 3 full reads for editing = 45,000 tokens
  Total: 61,000 tokens — can do 5x more work per session
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `tldr: command not found` | Run from workspace root: `.venv/bin/tldr` |
| No `.venv` directory | `python3 -m venv .venv && .venv/bin/pip install llm-tldr` |
| Stale index | `pan tldr warm` or `.venv/bin/tldr warm .` |
| Empty results | Check `.tldrignore` isn't excluding your files |
| Daemon not running | `pan tldr start` or it auto-starts with `pan up` |
