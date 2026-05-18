# PAN-1203 — Panopticon-docs RAG

**Issue:** [PAN-1203](https://github.com/eltmon/panopticon-cli/issues/1203)
**Parent epic:** [PAN-1200](https://github.com/eltmon/panopticon-cli/issues/1200)
**Status:** Planned
**Date:** 2026-05-18

---

## Problem

Panopticon has substantial documentation in `docs/` and ~60 skills with detailed `SKILL.md` files. Today, when a user asks any agent (Claude Code, Pi, future) "how do I do X in Panopticon?", the agent has to:

1. Guess based on training data (rarely correct for Panopticon-specific verbs)
2. Browse the docs from scratch using Read/grep
3. Ask the user to paste relevant docs

This causes users to repeatedly re-explain Panopticon mechanics to agents. Workflow knowledge that *exists* in our repo never reaches the agent at the right moment.

## Goal

Make every harness able to surface Panopticon's own documentation just-in-time, via a `UserPromptSubmit` hook that retrieves and injects relevant doc snippets when the user's prompt mentions Panopticon concepts.

## Design Goals

- **Harness-portable** — the retrieval CLI is shell-callable, not MCP-only
- **Zero first-run cost** — the index ships prebuilt with the package (no install-time embedding)
- **Token-cheap** — per-conversation budget caps prevent runaway injection
- **Trivial to update** — release pipeline rebuilds the index automatically
- **Off-able** — both global config and session-scope escape hatches

## Architecture

### Corpus

| Source | Path | Notes |
|---|---|---|
| Project docs | `panopticon-cli/docs/**/*.md` | All markdown docs |
| Skills | `panopticon-cli/skills/*/SKILL.md` | All ~60 skills |
| PRDs (active + planned) | `panopticon-cli/docs/prds/{active,planned}/*.md` | Optional; toggleable in build |
| CLAUDE.md | `panopticon-cli/CLAUDE.md` | Project-level rules |
| Rules | `panopticon-cli/.claude/rules/*.md` | Project-level rule files |

Each source file is chunked by markdown heading into sections of ≤ 500 tokens.

### Index Format

SQLite with both FTS5 and embeddings, for hybrid retrieval:

```sql
CREATE TABLE docs_chunks (
  chunk_id INTEGER PRIMARY KEY,
  doc_path TEXT NOT NULL,
  doc_kind TEXT NOT NULL,           -- 'docs' | 'skill' | 'prd' | 'rule' | 'claude-md'
  section_heading TEXT,
  section_anchor TEXT,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  built_at TEXT NOT NULL            -- ISO 8601 of last index build
);

CREATE VIRTUAL TABLE docs_fts USING fts5(
  content,
  display_content UNINDEXED,
  doc_path UNINDEXED,
  doc_kind,
  section_heading,
  tokenize = 'porter unicode61',
  content='docs_chunks',
  content_rowid='chunk_id'
);

CREATE TABLE docs_embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES docs_chunks(chunk_id),
  embedding BLOB NOT NULL  -- 384-dim float32 (gte-small)
);
```

Hybrid retrieval per query:

1. BM25 top 20 via FTS5 (porter stemming handles "syncing" ↔ "sync")
2. Cosine similarity top 20 via embeddings
3. Reciprocal Rank Fusion (RRF) to merge
4. Rerank by `doc_kind` priority (`docs` > `skill` > `rule` > `claude-md` > `prd`) and recency
5. Truncate to top-N

### Build Pipeline

`npm run build:docs-index` runs during release:

```bash
# scripts/build-docs-index.ts
1. Walk docs/, skills/, CLAUDE.md, .claude/rules/, docs/prds/{active,planned}/
2. Chunk by H1/H2/H3 boundaries, max 500 tokens per chunk
3. Insert into docs_chunks + docs_fts
4. Generate embeddings via local gte-small (or configured model)
5. Write to dist/docs-index.sqlite
```

Embedding model choice for v1: **local gte-small** (~30MB ONNX, 384-dim, ~50ms per chunk). Zero runtime cost, ships once at build. If quality is insufficient, swap to OpenAI text-embedding-3-small via `EMBEDDINGS_PROVIDER=openai` env at build time.

`pan docs reindex` regenerates from the current local repo (for dev iteration).

### Install

`pan install` copies `dist/docs-index.sqlite` → `~/.panopticon/docs/index.sqlite`. Idempotent: skips if hashes match.

`pan upgrade` (when implemented) refreshes the index.

### CLI

```
pan docs query "<text>" [--top 5] [--kind docs|skill|rule|prd] [--format markdown|json]
pan docs reindex                                          # local rebuild
pan docs disable [--session | --project | --global]       # silence the hook
pan docs enable  [--session | --project | --global]
pan docs status                                           # show index path, size, last-built, current config
```

`pan docs query` returns markdown by default:

```markdown
## docs/HARNESSES.md → Installing Pi

Pi is not auto-installed. Install it once, then run `pan doctor` to confirm.

    npm install -g @mariozechner/pi-coding-agent

...

---

## skills/pan-sync/SKILL.md → Usage

`pan sync` distributes skills/agents/rules to all configured harness locations.
```

### Injection: UserPromptSubmit Hook

Registered once during `pan install` for each detected harness:

**Claude Code:** `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": "panopticon-cli/dist/hooks/docs-rag.sh"
  }
}
```

**Pi:** registered via Pi's hook mechanism (extension API; pattern matches Claude Code's).

The hook script:

```bash
#!/usr/bin/env bash
# panopticon-cli/dist/hooks/docs-rag.sh
# Receives prompt via stdin; outputs augmented prompt or original.

prompt=$(cat)

# Trigger check: regex or classifier
if echo "$prompt" | rg -i "(pan|panopticon|cloister|deacon|workspace|specialist|harness|bd|beads|vbrief|workhorse)" > /dev/null; then
  # Budget check
  budget=$(pan docs budget-check)  # returns "ok" or "exceeded"
  if [ "$budget" = "ok" ]; then
    snippets=$(pan docs query "$prompt" --top 3 --format markdown)
    if [ -n "$snippets" ]; then
      echo "$prompt"
      echo ""
      echo "<panopticon-docs>"
      echo "$snippets"
      echo "</panopticon-docs>"
      pan docs budget-bump
      exit 0
    fi
  fi
fi

echo "$prompt"
```

Detection has two layers:

1. **Regex trigger** — fast, configurable in `~/.panopticon/config.yaml` under `docs.triggers`
2. **Optional classifier fallback** — if regex doesn't match but prompt looks Panopticon-adjacent (e.g., asks about agents, workflows), a cheap Haiku call rates relevance. Off by default; enable via `docs.classifier.enabled = true`.

### Budget Controls

Per-conversation cap to avoid token blowout:

| Limit | Default | Config Key |
|---|---|---|
| Max injections per conversation | 1 per 10 turns | `docs.budget.injectionRate` |
| Max retrieved tokens per injection | 3000 | `docs.budget.maxTokensPerInjection` |
| Max retrieved chunks per injection | 5 | `docs.budget.maxChunksPerInjection` |
| Override threshold (high-confidence prompts skip rate limit) | classifier ≥ 0.85 | `docs.budget.bypassClassifierThreshold` |

State tracked in `~/.panopticon/docs/budget-state.json` keyed by conversation/session ID.

### Telemetry

Every injection writes a JSONL entry to `~/.panopticon/docs/telemetry.jsonl`:

```json
{"ts":"...","conversationId":"...","trigger":"regex","matched":["pan","sync"],"retrievedChunks":[{"path":"docs/HARNESSES.md","heading":"Installing Pi","score":0.83}],"tokens":847,"truncated":false}
```

Used for tuning trigger regex + measuring effectiveness.

## Acceptance Criteria

- `npm run build:docs-index` produces `dist/docs-index.sqlite` < 50MB
- `pan install` materializes index to `~/.panopticon/docs/index.sqlite`
- `pan docs query "how do I run pan sync"` returns relevant snippets in < 200ms (cold), < 50ms (warm)
- `pan docs reindex` regenerates from current local docs/skills in < 60s
- UserPromptSubmit hook is registered for both Claude Code and Pi during `pan install`
- A prompt containing "how do I use pan sync" triggers injection of relevant `docs/SYNC.md` or `skills/pan-sync/SKILL.md` snippets
- `pan docs disable` silences the hook for the current session
- Budget caps respected; conversation that already hit injection limit does not re-inject within rate window
- Telemetry written to `~/.panopticon/docs/telemetry.jsonl`
- `pan docs status` shows index path, size, last-built timestamp, enabled/disabled state
- New tests: chunking correctness, hybrid retrieval ranking, budget state, regex trigger matching, hook integration

## Test Plan

Unit:
- Markdown chunking: H1/H2/H3 boundaries, code block preservation, token counting accuracy
- BM25 + embeddings RRF merge correctness
- Trigger regex matching against fixture prompts
- Budget state advancement and reset

Integration:
- Build a fixture index from `tests/fixtures/docs/`, query, assert ranking
- Run hook script with fixture prompts; assert output contains `<panopticon-docs>` block iff trigger matches
- End-to-end: install, query, disable, query (no injection), enable, query (injection resumes)

## Out of Scope (Phase 2)

- Cross-repo RAG (e.g., indexing arbitrary user docs)
- Embedding model swaps without rebuild (today, swap requires rebuild + ship)
- Inline citation rendering ("from docs/SYNC.md, section Installing Pi: …")
- Per-skill RAG (current model is single global index across all docs)
- Vector store backends other than SQLite (sufficient for our scale)

## Files Likely Touched

- `scripts/build-docs-index.ts` (new) — build pipeline
- `src/lib/docs/` (new) — chunking, retrieval, budget, telemetry
- `src/cli/commands/docs.ts` (new) — `pan docs query/reindex/disable/enable/status/budget-check/budget-bump`
- `dist/hooks/docs-rag.sh` (new) — UserPromptSubmit hook script (shipped in package)
- `src/cli/commands/install.ts` — register hook in both harnesses' settings
- `packages/contracts/src/types.ts` — `DocsChunk`, `RetrievalResult`, `BudgetState`
- `src/lib/config-yaml.ts` — `docs.*` config schema
- `tests/lib/docs/*.test.ts` (new)
- `docs/DOCS-RAG.md` (new) — operator guide
- `package.json` — `build:docs-index` script + native module deps for embeddings
