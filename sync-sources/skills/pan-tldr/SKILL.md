---
name: pan-tldr
description: "Token-efficient code exploration. TLDR summarizes large code files automatically via a Read hook; for deliberate lookups use the .venv/bin/tldr CLI through Bash (context, extract, structure). Triggers on requests to explore, summarize, or understand code in a checkout that has TLDR available."
triggers:
  - explore code
  - understand this codebase
  - what does this file do
  - where is X used
  - what calls
  - what depends on
  - large file
  - tldr
  - find similar code
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# TLDR: automatic code summaries + a CLI for deliberate lookups

If the checkout you're working in has `.venv/bin/tldr`, TLDR summarizes code
files into ~500–1,200 tokens instead of the 10–25k a full Read would consume.

**How it actually reaches you (PAN-3534):** a PreToolUse hook on `Read`. When
you Read a large code file, the hook substitutes a structured summary
automatically — you don't invoke anything. There are **no `tldr_*` MCP tools**
in agent sessions; older docs that told you to call `tldr_context` /
`tldr_semantic` as tools described a surface that was never wired up. Do not
wait for or request those tools.

## The workflow

1. **Just Read.** Large code files come back as TLDR summaries automatically
   when a local venv exists. Treat the summary as the answer to structure
   questions.
2. **Read full content only when editing.** Use `Read` with `offset`/`limit`
   for the specific range you'll touch — targeted reads always bypass the
   hook. Recently-edited files also bypass, so you can verify your own changes.
3. **Deliberate lookups via the CLI** (Bash, from the checkout root):
   - `.venv/bin/tldr context <module-path> --lang <lang>` — exports, imports,
     key function shapes (module path without extension, e.g.
     `src/lib/agents`).
   - `.venv/bin/tldr extract <file>` — structured JSON (functions, classes,
     params) for an exact file path.
   - `.venv/bin/tldr structure <directory>` — orient in an unfamiliar module.

## Scope rules

- The hook only serves files from the checkout that owns the venv. Files in a
  workspace without its own `.venv` get normal full Reads — that's expected,
  not breakage.
- Config/data files (JSON, TOML, .env), markdown, and small files (<3KB) are
  never intercepted — just Read them.

## Observability

- `<checkout>/.tldr/interceptions.log` — each summary served
  (`timestamp file_size rel_path`).
- `<checkout>/.tldr/bypasses.log` — deliberate bypasses with reasons
  (`recently-edited`, `sparse-content`, `binary-fail`, `no-content`,
  `no-venv`).
- `<checkout>/.tldr/failures.log` — broken-binary diagnostics.

## Troubleshooting

- **No summaries appearing?** Check the checkout has `.venv/bin/tldr` and that
  `agents.tldr.enabled` isn't false (`OVERDECK_TLDR_ENABLED=0` also disables).
- **Index stale?** The post-edit hook re-warms after 10 edits (deduped by
  `.tldr/warm.lock`); Cloister also warms on workspace create and after merge.
  For one specific fresh file, just Read it with offset/limit.

## See also

- `pan admin tldr status` — operator view of running daemons. Use the
  `pan-admin-tldr` skill for daemon lifecycle.
- `docs/TLDR.md` in overdeck — full TLDR design.
