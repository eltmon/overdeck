---
name: pan-tldr
description: "Token-efficient code exploration. Use TLDR MCP tools (tldr_context, tldr_structure, tldr_calls, tldr_impact, tldr_semantic) instead of reading whole files when exploring or answering questions about code. Triggers on requests to explore, summarize, or understand code in a workspace that has TLDR available."
triggers:
  - explore code
  - understand this codebase
  - what does this file do
  - where is X used
  - what calls
  - what depends on
  - large file
  - tldr_context
  - tldr_semantic
  - find similar code
allowed-tools:
  - mcp__tldr__tldr_context
  - mcp__tldr__tldr_structure
  - mcp__tldr__tldr_calls
  - mcp__tldr__tldr_impact
  - mcp__tldr__tldr_semantic
  - Read
  - Grep
  - Glob
---

# Use TLDR for code exploration

If your workspace has a `.venv` directory, you have access to TLDR — a code-analysis daemon that summarizes files into 500–1,200 tokens instead of the 10–25k tokens a full Read would consume. Using it extends how much real work you can do per session.

**The PreToolUse hook will already intercept your `Read` calls on large code files and substitute a TLDR summary**, so even if you forget, you'll often get the savings. This skill exists to make that the *default* for code questions, not a happy accident.

## Available MCP tools

| Tool | Use when |
| --- | --- |
| `tldr_context <file>` | You want to know what a file exports, imports, and the shape of its key functions before deciding whether/where to edit. |
| `tldr_structure <directory>` | You're orienting in an unfamiliar module — what files exist, what they relate to. |
| `tldr_calls <function> <file>` | "What calls this function?" — upward dependency analysis. |
| `tldr_impact <function> <file>` | "What does this function call?" — downward impact analysis. Use before refactoring. |
| `tldr_semantic <query>` | Natural-language search across the indexed codebase. Use when you don't know the file/function name yet. |

## The workflow

1. **Open with TLDR.** When asked a code question, your first move is `tldr_context` / `tldr_structure` / `tldr_semantic`, not `Read` or `cat`.
2. **Read full files only when editing.** Once TLDR has shown you the structure and pointed at the line range, use `Read` with `offset`/`limit` to load just the section you'll touch.
3. **Use the call graph for refactors.** Before changing a function signature, run `tldr_calls` to see every caller — saves you from grep-with-wrong-regex misses.
4. **Don't fight the interceptor.** If the hook returns a TLDR summary for a file you `Read`, treat that as the answer. Re-read with `offset`/`limit` only if you specifically need that range for editing.

## Cost comparison

- 20 files × 15k tokens (full Read) = **300k tokens** — exhausts context, forces compaction.
- 20 files × 800 tokens (TLDR) = **16k tokens** — leaves headroom for the actual work.

## When TLDR is NOT a good fit

- **Config / data files** — TOML, JSON, .env. TLDR is for code structure; for short config, just Read it.
- **Files you're about to edit.** Read the actual lines you need; TLDR omits implementation details.
- **Markdown / docs.** Read directly.

The PreToolUse interceptor already bypasses these cases automatically — it logs to `<workspace>/.tldr/bypasses.log` when it does. If you're curious why a Read wasn't intercepted, that's the log to check.

## Troubleshooting

- **MCP tools missing?** TLDR is only available when `<workspace>/.venv` exists. If your workspace has no venv, fall back to `Read` / `Grep` / `Glob`. Tell the user the workspace is missing TLDR support.
- **Indexing seems stale?** Cloister warms the index on workspace create and after merge. If a recent change isn't reflected, the daemon hasn't reindexed yet — proceed with `Read` for that specific file.

## See also

- `pan admin tldr status` — operator view of running daemons. Use the `pan-admin-tldr` skill for daemon lifecycle.
- `docs/TLDR.md` in panopticon-cli — full TLDR design.
