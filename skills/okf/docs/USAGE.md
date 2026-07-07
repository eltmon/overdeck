# OKF Command Usage

All commands resolve the bundle first, usually through `.okf.yml` at the code repository root. Commands that write knowledge should prepare a branch or PR rather than mutating protected branches directly.

## `/okf init`

Create a knowledge bundle.

```bash
/okf init
/okf init --dir ../custom-knowledge
/okf init --local knowledge
```

- Default: create a peer repo named `<project>-knowledge`.
- `--dir <path>`: use any external directory.
- `--local <subdir>`: create an in-repo bundle.

## `/okf author "<topic>"`

Write or update one concept.

```bash
/okf author "invoice status lifecycle"
/okf author "retry policy" --model gpt-5.5
```

- Uses the concept template.
- Preserves unknown frontmatter keys.
- Regenerates index/log material and validates.
- `--model <model>` requests a specific model through the model ladder.

## `/okf convert <path>`

Convert existing docs non-destructively.

```bash
/okf convert docs/billing.md
/okf convert wiki-export/
```

- Starts with a dry-run plan.
- Adds frontmatter before rename operations.
- Never deletes README files or source documents.

## `/okf sync [--topic "<focus>"]`

Update concepts from diffs.

```bash
/okf sync
/okf sync --topic "billing retries"
/okf sync --topic "billing retries" --model gpt-5.5
```

- Derives a change range from log history, PR base, or user context.
- Restricts with `--topic` by tags, concept IDs, and search.
- `--model <model>` requests a specific model through the model ladder.

## `/okf study "<focus>"`

Document current behavior before a feature.

```bash
/okf study "overtime calculations"
/okf study "overtime calculations" --model claude-opus-4
```

- Searches the current codebase for the focus.
- Creates or refreshes concepts that describe today's behavior.
- Cites files, tests, docs, commands, or transcript context.
- `--model <model>` requests a specific model through the model ladder.

## `/okf retro`

Capture knowledge after implementation.

```bash
/okf retro
/okf retro --model gpt-5.5
```

- Reviews the diff and available session context.
- Captures what would have made the work easier.
- With Overdeck available, observations may be used as input.
- `--model <model>` requests a specific model through the model ladder.

## `/okf extract "<query>" [--budget <tokens>]`

Return cited prompt context.

```bash
/okf extract "billing retry policy"
/okf extract "billing retry policy" --budget 1500
```

- Uses hybrid BM25 + vector ranking when available.
- Falls back to BM25-only, then index-guided reading.
- Includes concept IDs and citations.

## `/okf validate [--strict]`

Run deterministic validation.

```bash
/okf validate
/okf validate --strict
```

- Exit 0: conformant.
- Exit 1: lint findings.
- Exit 2: conformance errors.

## `/okf lint`

Run advisory semantic patrol.

```bash
/okf lint
```

- Finds contradictions, stale concepts, orphaned links, missing citations, and oversized concepts.
- Does not replace deterministic validation.

## `/okf embed [--profile <name>]`

Refresh embeddings and the local search index.

```bash
/okf embed
/okf embed --profile local
```

- Reads `okf-embeddings.yaml`.
- Re-embeds only hash-changed concepts.
- Writes sorted shard lines to `embeddings/<profile>.okfe.jsonl`.
- Rebuilds `.okf-index/`, which is derived and gitignored.

## Model Ladder

For `author`, `sync`, `study`, and `retro`, `--model <model>` is a hard request:

1. Use native harness support.
2. Use a vendor CLI on `PATH`, such as `codex exec -m <model>` or `gemini -p ... -m <model>`.
3. Use an installed bridge plugin.
4. Use an available MCP bridge tool.
5. If no bridge can serve the model, error with the requested model, bridge name, install command, and auth step.

Never silently substitute another model.
