# PAN-457 — Conversation Discovery & Indexing

**Status:** Planning complete
**Issue:** https://github.com/eltmon/panopticon-cli/issues/457
**Scope:** All 5 phases (scanner + adaptive system scan + tiered enrichment + embeddings + dashboard)

## Problem

Panopticon only sees conversations it spawned. Ad-hoc `claude` sessions started in a terminal —
debugging, exploration, quick fixes — are invisible. The user has hundreds of such sessions in
`~/.claude/projects/` with no way to search, review, or correlate cost.

## Proposal

A new `conversations` subsystem with three discovery modes (targeted / watched / system-wide),
three-tier search (structured / FTS5 / semantic), three-level enrichment (quick / deep / custom),
and a dashboard Conversations panel. All discovery and extraction is scripted (zero LLM).
Enrichment is explicit and cost-gated.

## Key Decisions

### 1. Scope — all 5 phases in this issue
Maximalist delivery per the "complete features" rule. Phases are implementation order, not
separate deliverables. The issue is only "done" when CLI + search + enrichment + embeddings +
dashboard all ship.

### 2. Table model — new `discovered_sessions` table, separate from `conversations`
The existing `conversations` table (PAN-416) is lifecycle-aware (active/ended, tmux_session,
title, archived_at). It tracks Panopticon-spawned sessions only.

`discovered_sessions` is a different shape: an immutable index row per JSONL file on disk.
Linked back via `panopticon_managed`, `pan_issue_id`, `pan_agent_id` columns populated during
scan by joining against `conversations.session_file` and `cost_events.session_id`.

Rationale: merging into one table would conflate two very different lifecycles and force
nullable columns on both sides. Separate tables, join at query time.

### 3. Hash→path resolution — JSONL cwd primary, reverse-map fallback
Claude's encoder (`encodeClaudeProjectDir`) is lossy (non-alphanumerics all collapse to `-`),
so reverse-mapping from hash alone is ambiguous.

Primary: read the first JSONL message, which contains the actual `cwd` field.
Fallback: for empty/corrupt JSONLs, build a reverse map by encoding each known workspace
(walk `watchDirs` + `projects.yaml` projects) and matching on hash collision.

### 4. Adaptive parallelism — full probe as spec'd
`SystemCapabilities` probe: `os.cpus().length` + `lsblk -d -o name,rota` for rotational flag +
10MB sequential read benchmark + `os.freemem()`. Cached per-process. Parallelism table from
spec. Linux-only probe; macOS/Windows fall through to the `unknown`→4 default.

### 5. Embeddings — all three providers (OpenAI, Voyage, Ollama)
Pluggable `EmbeddingProvider` interface. Config selects one via
`conversations.embeddingProvider`. Pure-JS cosine similarity over Float32 blobs in memory —
no native deps, no sqlite-vec extension. Brute-force cosine is fast enough at expected scale
(thousands of sessions, <10ms for 5K sessions × 1536 dims).

### 6. Enrichment execution — reuse `model-fallback.ts` routing
Enrichment workers call the existing Panopticon model router. This automatically respects
provider disabled state (dashboard UX toggle), fallback chains, and logs to `cost_events`.
Level 1 → Haiku tier, Level 2 → Sonnet tier, Level 3 → user-specified model.

Subagent parallelism: spawn `min(sessionsToEnrich, maxParallel)` promise workers in the
dashboard server process — NOT Claude Code subagents. Direct SDK-style calls via model-fallback.

### 7. Re-scanning — manual only in v1
No chokidar watcher, no periodic background scan. `pan conversations scan [--watched|--system]`
is invoked explicitly. Change detection via `(file_size, file_mtime)` short-circuit skips
unchanged rows. Dashboard gets a "Rescan" button that hits the scan API.

### 8. Blocking FS calls — must use async everywhere in server code
Per CLAUDE.md, scan + enrich code reachable from dashboard routes MUST use `fs/promises`,
`execAsync`, Effect `FileSystem`. The existing `jsonl-parser.ts` uses sync calls — that file
is CLI-safe but we'll add an async variant for the scanner service.

## Architecture

```
src/lib/conversations/
  scanner.ts              # orchestrates scan modes (targeted/watched/system)
  discovery.ts            # walks ~/.claude/projects, emits candidate files
  jsonl-async.ts          # async streaming parser (new, based on existing)
  metadata-extractor.ts   # extracts tools_used, files_touched, cost from JSONL
  hash-resolver.ts        # cwd-from-jsonl + reverse-map fallback
  system-probe.ts         # SystemCapabilities detection + caching
  work-pool.ts            # bounded parallelism work-stealing pool
  correlator.ts           # joins with conversations + cost_events
  search.ts               # structured filters + FTS5 + semantic query composition
  enrichment/
    index.ts              # enrich(sessionIds, level, options)
    level1.ts             # quick (3 sampled messages)
    level2.ts             # deep (11 sampled + tool summaries)
    level3.ts             # custom model, optional --full
    sample.ts             # message sampling strategies
    prompt.ts             # enrichment system prompts
  embeddings/
    index.ts              # embed(sessionIds, options)
    providers/
      openai.ts
      voyage.ts
      ollama.ts
    cosine.ts             # pure-JS Float32 cosine similarity

src/lib/database/
  discovered-sessions-db.ts   # CRUD + FTS5 + embeddings
  schema.ts                   # ADD new tables

src/cli/commands/
  conversations/
    index.ts          # register subcommands
    scan.ts           # pan conversations scan
    search.ts         # pan conversations search
    list.ts           # pan conversations list
    show.ts           # pan conversations show
    enrich.ts         # pan conversations enrich
    embed.ts          # pan conversations embed
    cost.ts           # pan conversations cost

src/dashboard/server/
  routes/conversations.ts         # Effect routes backing the CLI + UI
  services/conversation-index.ts  # service layer around lib/conversations

src/dashboard/frontend/src/components/
  conversations/
    ConversationsPanel.tsx
    ConversationSearchBar.tsx
    ConversationTimeline.tsx
    ConversationDetail.tsx
    EnrichmentControls.tsx
    FacetPanel.tsx

packages/contracts/src/
  events.ts              # ADD scan.progress, scan.complete, enrich.progress domain events
  rpc.ts                 # ADD conversation RPC procs
  types.ts               # ADD DiscoveredSession + filter types
```

## Database Schema

New tables in `src/lib/database/schema.ts` (both main and per-workspace DB paths):

- `discovered_sessions` — per spec (plus columns for correlation)
- `sessions_fts` — SQLite FTS5 virtual table (content-linked, BM25)
- `session_embeddings` — embedding BLOBs + model metadata
- Indexes per spec

Migration is idempotent via `CREATE TABLE IF NOT EXISTS`. FTS5 is populated by explicit sync
after enrichment (not triggers — simpler, matches existing patterns).

## Config additions (`config.yaml`)

```yaml
conversations:
  watchDirs: ["~/Projects"]
  scanMaxParallel: null              # null = auto from SystemCapabilities probe
  embeddings: false                  # opt-in
  embeddingProvider: "openai"        # openai | voyage | ollama
  embeddingModel: "text-embedding-3-small"
  embeddingAutoOnDeep: true
  enrichment:
    quickModel: null                 # null = Haiku tier via model-fallback
    deepModel: null                  # null = Sonnet tier via model-fallback
    maxParallel: 4
    costConfirmThreshold: 1.00       # USD — prompt before spending more
```

## CLI Surface (exact per spec)

Discovery: `scan [dirs...]`, `scan --watched`, `scan --system [--dry-run]`
Search: structured flags + FTS query + `--semantic` + `--similar <id>` + `--format`
Enrichment: `enrich [--limit|--workspace|--since|--deep|--with <model>|--full|--prompt|--upgrade]`
Embeddings: `embed`, `embed --regenerate`, `embed --status`
Browsing: `list [--managed|--unmanaged]`, `show <id>`, `cost [--by workspace|model]`

## Dashboard Surface

New "Conversations" top-level panel in Mission Control. Search bar (free-text + structured
filter chips + semantic toggle), faceted results (workspace/model/time/cost/enrichment-level),
session detail drawer with enrichment controls, aggregate cost view. Live scan/enrich progress
via domain events on `/ws/rpc`.

## Out of Scope

- File watcher / auto-rescan (manual only in v1)
- sqlite-vec native extension (pure JS cosine)
- Cross-machine / cloud session sync
- Editing or deleting JSONL files
- Re-running past conversations
- Saved searches (mentioned in spec but deferred — no clear storage strategy yet)

## Risks

1. **FTS5 availability** — better-sqlite3 ships with FTS5 by default; verified in existing
   `database/index.ts`. Low risk.
2. **Enrichment cost explosion** — mitigated by `--dry-run` + `costConfirmThreshold` +
   explicit `--limit` default.
3. **Hash collision resolution ambiguity** — accepted; when both JSONL cwd is missing AND
   multiple workspaces hash-collide, we leave `workspace_path` NULL.
4. **Memory pressure on system scan** — streaming parser, bounded work pool, batch inserts.
   Never loads full JSONLs into memory.
5. **Embedding provider API key handling** — read from env/config; fail fast with actionable
   error if missing and `--semantic` invoked.

## Quality Gates

- `npm run typecheck` — strict mode
- `npm run lint`
- `npm test` — includes scanner, search, enrichment, embedding, integration suites per spec
- Manual: `pan conversations scan --system` on developer's actual `~/.claude/projects/`
- Manual: dashboard Conversations panel renders and searches
