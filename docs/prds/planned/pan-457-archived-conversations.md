## Vision

A single **Archived Conversations** page in the Panopticon dashboard that unifies two worlds:

1. **Panopticon-archived conversations** — sessions Panopticon spawned and later archived (existing `conversations` table with `archived_at`)
2. **All other Claude Code JSONL sessions on the system** — ad-hoc `claude` runs, sessions from other tools, debugging sessions, exploratory chats — anything found under `~/.claude/projects/`

Both are presented in one searchable, filterable, browsable view, and **clicking any session opens the same T3Code-style conversation viewer** (PAN-451), regardless of whether Panopticon managed it.

This is the "single pane of glass" deliverable: every Claude Code interaction on this machine, surfaced and searchable, with a polished reader.

## Scope (single issue, all phases delivered together)

This issue covers everything required for the page to work end-to-end:

- Discovery + indexing of all JSONL sessions (managed and unmanaged)
- A unified `archived_conversations` view that joins Panopticon-archived rows with discovered external rows
- A new **Archived Conversations** page in the dashboard with search, filters, facets
- Reusing the T3Code-style conversation viewer (PAN-451) as the detail-view renderer for any session — Panopticon-managed or not
- Tiered LLM enrichment, full-text search, and optional vector embeddings
- Settings UI for embedding provider configuration
- CLI parity for everything in the UI

Per project policy, this is delivered as a complete feature in one issue. PRD phases are implementation guidance, not separate deliverables.

---

## Architecture

```
                ┌──────────────────────────────────────────┐
                │      Archived Conversations Page         │
                │   (dashboard/frontend/.../archived/*)    │
                ├──────────────────────────────────────────┤
                │ Search bar │ Filter chips │ Facets       │
                │ Result rows (managed + discovered, mixed)│
                │ Click row → ConversationViewer (PAN-451) │
                └──────────────────────────────────────────┘
                                  │
                                  │ /api/archived-conversations/*
                                  ▼
                ┌──────────────────────────────────────────┐
                │  archived_conversations service          │
                │  (server/services/archived-conv-svc.ts)  │
                ├──────────────────────────────────────────┤
                │ unified read model joining:              │
                │  - conversations WHERE archived_at NOT N │
                │  - discovered_sessions (all)             │
                └──────────────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
     ┌──────────────┐    ┌──────────────────┐  ┌──────────────┐
     │ scanner svc  │    │ enrichment svc   │  │ embed svc    │
     │ JSONL discov │    │ tiered LLM       │  │ optional     │
     └──────────────┘    └──────────────────┘  └──────────────┘
              │                   │                   │
              └───────────────────┴───────────────────┘
                                  ▼
                ┌──────────────────────────────────────────┐
                │              SQLite (panopticon.db)      │
                ├──────────────────────────────────────────┤
                │ conversations          (existing, has    │
                │                         archived_at)     │
                │ discovered_sessions    (NEW)             │
                │ sessions_fts           (NEW, FTS5)       │
                │ session_embeddings     (NEW, optional)   │
                └──────────────────────────────────────────┘
```

---

## Data Model

### Existing — `conversations` table

Already has `archived_at TEXT` (added in schema v12). The Archived Conversations page treats `archived_at IS NOT NULL` as "archived."

### New — `discovered_sessions` table

```sql
CREATE TABLE discovered_sessions (
  id TEXT PRIMARY KEY,                    -- Claude Code session UUID
  project_hash TEXT NOT NULL,             -- ~/.claude/projects/<hash>
  workspace_path TEXT,                    -- Resolved original path (NULL if unresolvable)
  jsonl_path TEXT NOT NULL,               -- Full path to .jsonl file
  file_size INTEGER NOT NULL,             -- For change detection
  file_mtime INTEGER NOT NULL,            -- Epoch seconds
  message_count INTEGER,
  first_message_at TEXT,                  -- ISO
  last_message_at TEXT,                   -- ISO
  duration_seconds INTEGER,
  model_primary TEXT,                     -- Most-used model
  models_used TEXT,                       -- JSON array
  token_input INTEGER DEFAULT 0,
  token_output INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  panopticon_managed INTEGER DEFAULT 0,   -- 1 if joined to a conversations.session_id
  pan_issue_id TEXT,
  pan_agent_id TEXT,
  summary TEXT,                           -- L1 enrichment
  summary_detailed TEXT,                  -- L2/L3 enrichment
  tags TEXT,                              -- JSON array
  tools_used TEXT,                        -- JSON array (extracted, no LLM)
  files_touched TEXT,                     -- JSON array (extracted, no LLM)
  enrichment_level INTEGER DEFAULT 0,     -- 0/1/2/3
  enrichment_model TEXT,
  has_embedding INTEGER DEFAULT 0,
  indexed_at TEXT NOT NULL,
  enriched_at TEXT,
  UNIQUE(jsonl_path)
);

CREATE INDEX idx_ds_workspace      ON discovered_sessions(workspace_path);
CREATE INDEX idx_ds_last_message   ON discovered_sessions(last_message_at);
CREATE INDEX idx_ds_managed        ON discovered_sessions(panopticon_managed);
CREATE INDEX idx_ds_project_hash   ON discovered_sessions(project_hash);
CREATE INDEX idx_ds_enrichment     ON discovered_sessions(enrichment_level);
```

### New — FTS5 mirror

```sql
CREATE VIRTUAL TABLE sessions_fts USING fts5(
  id UNINDEXED,
  summary,
  summary_detailed,
  tags,
  workspace_path,
  tools_used,
  files_touched,
  content=discovered_sessions,
  content_rowid=rowid
);
```

### New — vector embeddings (optional)

```sql
CREATE TABLE session_embeddings (
  session_id TEXT PRIMARY KEY REFERENCES discovered_sessions(id),
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

### Unified view — `archived_conversations_v`

A read-only SQL view (or service-layer query) that the page consumes:

```sql
CREATE VIEW archived_conversations_v AS
SELECT
  c.session_id              AS id,
  c.session_id              AS session_id,
  c.workspace_path          AS workspace_path,
  c.archived_at             AS archived_at,
  c.created_at              AS first_message_at,
  c.last_message_at         AS last_message_at,
  c.duration_seconds        AS duration_seconds,
  c.message_count           AS message_count,
  c.model_primary           AS model_primary,
  c.models_used             AS models_used,
  c.estimated_cost          AS estimated_cost,
  1                         AS panopticon_managed,
  c.issue_id                AS pan_issue_id,
  c.agent_id                AS pan_agent_id,
  ds.summary                AS summary,
  ds.summary_detailed       AS summary_detailed,
  ds.tags                   AS tags,
  ds.tools_used             AS tools_used,
  ds.files_touched          AS files_touched,
  ds.enrichment_level       AS enrichment_level,
  ds.has_embedding          AS has_embedding,
  COALESCE(ds.jsonl_path, c.jsonl_path) AS jsonl_path,
  'managed-archived'        AS source
FROM conversations c
LEFT JOIN discovered_sessions ds ON ds.id = c.session_id
WHERE c.archived_at IS NOT NULL

UNION ALL

SELECT
  ds.id, ds.id, ds.workspace_path,
  NULL                       AS archived_at,
  ds.first_message_at, ds.last_message_at, ds.duration_seconds,
  ds.message_count, ds.model_primary, ds.models_used, ds.estimated_cost,
  ds.panopticon_managed, ds.pan_issue_id, ds.pan_agent_id,
  ds.summary, ds.summary_detailed, ds.tags, ds.tools_used, ds.files_touched,
  ds.enrichment_level, ds.has_embedding, ds.jsonl_path,
  CASE WHEN ds.panopticon_managed = 1 THEN 'managed-active' ELSE 'discovered' END AS source
FROM discovered_sessions ds
WHERE ds.id NOT IN (SELECT session_id FROM conversations WHERE archived_at IS NOT NULL);
```

`source` distinguishes `managed-archived` / `managed-active` / `discovered` so the UI can render badges accordingly.

---

## Discovery Subsystem

### Three discovery modes

```bash
pan conversations scan <dir> [<dir>...]   # Targeted directory scan
pan conversations scan --watched          # Scan dirs from config.yaml
pan conversations scan --system           # Full system scan
pan conversations scan --system --dry-run # Preview without writes
```

### Scripted extraction (zero LLM)

The scanner uses **only filesystem + JSON parsing**. No LLM calls during discovery.

1. `readdir` `~/.claude/projects/*/` for `*.jsonl` files
2. Resolve hashed project dir back to original workspace path (Claude Code's hash algorithm)
3. Stream-parse JSONL: first line, last line, line count, model/token fields
4. Parse `tool_use` blocks → `tools_used` and `files_touched` arrays
5. Apply per-model token pricing → `estimated_cost`
6. Match `session_id` against `conversations` table → set `panopticon_managed`
7. Compare file size + mtime against stored values → skip unchanged files

The JSONL parser already exists at `src/lib/cost-parsers/jsonl-parser.ts` and gets extended.

### Performance-adaptive parallelism (system scan)

System capability probe (cached):

```typescript
interface SystemCapabilities {
  cpuCores: number;
  driveType: 'ssd' | 'hdd' | 'unknown';
  driveReadMBps: number;
  availableMemoryMB: number;
}
```

| Drive | Concurrent reads      | Rationale                          |
|-------|----------------------|------------------------------------|
| SSD   | `min(cpuCores, 16)`  | Random reads cheap; CPU-bound parse |
| HDD   | `2`                  | Random seeks kill HDD throughput    |
| ?     | `4`                  | Conservative default                |

Work-stealing pool: N workers pop project dirs, parse, batch insert. SQLite writes serialized through single writer (existing pattern in `src/lib/database/index.ts`).

Progress reporting (CLI):

```
Scanning ~/.claude/projects/...
  [████████████░░░░░░░░] 847/1,203 dirs | 2,341 sessions found | 12.3s
```

Progress also surfaces in the dashboard via domain events (`ScanStarted`, `ScanProgress`, `ScanCompleted`).

### MUST NOT delete or modify JSONL files

Per CLAUDE.md, JSONL session files are sacred. The scanner is **read-only** against `~/.claude/projects/`. No truncation, no rewrites, no deletes — ever.

---

## Search

Three composable tiers.

### Tier 1: Structured filters (instant, no LLM)

```bash
pan conversations search --workspace ~/Projects/myn
pan conversations search --model claude-opus-4-6
pan conversations search --managed
pan conversations search --unmanaged
pan conversations search --archived
pan conversations search --since 7d
pan conversations search --before 2026-03-01
pan conversations search --after 2026-02-15
pan conversations search --min-cost 0.50
pan conversations search --max-cost 5.00
pan conversations search --min-messages 20
pan conversations search --tag debugging
pan conversations search --tool Edit
pan conversations search --file src/lib/convoy.ts
pan conversations search --issue PAN-449
pan conversations search --enriched
pan conversations search --not-enriched
```

Filters compose with AND. Output formats: `--format table|json|brief|ids`.

### Tier 2: Full-text search (FTS5, no LLM)

```bash
pan conversations search "redis cache invalidation"
pan conversations search "Effect service extraction" --since 14d
pan conversations search "Flyway migration" --workspace ~/Projects/myn
```

FTS5 features: BM25 ranking, prefix (`refact*`), phrase (`"error handling"`), boolean (`redis AND cache NOT test`), column weighting (`summary_detailed`×2, `summary`×1.5, `tags`×1, `files`×0.5), snippet extraction.

FTS index populated:
- On scan for the columns that don't need LLM (`workspace_path`, `tools_used`, `files_touched`)
- On enrichment for `summary`, `summary_detailed`, `tags`

### Tier 3: Semantic search (optional, requires embeddings)

```bash
pan conversations search --semantic "debugging a race condition in the event loop"
pan conversations search --semantic "how did I fix the auth middleware last month"
pan conversations search --similar <session-id>
```

Pure SQLite — cosine similarity over Float32 BLOBs in a custom SQLite function (native addon or WASM). Brute-force at expected scale (thousands, not millions). Add IVF index later if scale demands it.

Embedding models (configurable):
- OpenAI `text-embedding-3-small` (1536 dim, $0.02/M)
- Voyage AI `voyage-code-3` (1024 dim) — best for code-heavy
- Ollama local `nomic-embed-text` — free, slower

---

## Tiered Enrichment

Always **user-initiated**. Three levels.

### L1 — Quick enrich (cheap, batch)

```bash
pan conversations enrich
pan conversations enrich --limit 50
pan conversations enrich --workspace ~/Projects/foo
pan conversations enrich --since 7d
```

Sends first message, last message, 1 sampled middle message to cheapest model (Haiku 4.5 → gemini-flash → gpt-4o-mini). Generates `summary` (1–2 sentences) + `tags`. ~$0.001/session.

### L2 — Deep enrich (mid-tier model)

```bash
pan conversations enrich --deep
pan conversations enrich --deep <session-id>
pan conversations enrich --deep --since 7d
```

Sends 11 messages + tool_use summaries to Sonnet 4.6 / gemini-pro / gpt-4o. Generates `summary_detailed` (paragraph-length), updated `tags`. Optional embedding if `conversations.embeddingAutoOnDeep: true`. ~$0.01–0.03/session.

### L3 — Custom enrich (user-selected model)

```bash
pan conversations enrich --with claude-opus-4-6 <session-id>
pan conversations enrich --with kimi-k2.5 <session-id>
pan conversations enrich --with claude-opus-4-6 --since 3d
pan conversations enrich --with claude-opus-4-6 --full <session-id>
pan conversations enrich --with claude-opus-4-6 --prompt "Focus on the architectural decisions" <session-id>
```

Pre-execution cost estimate + confirmation when `--full` or batch sizes get large:

```
Session abc123 — 847 messages, ~125K tokens
Enriching with claude-opus-4-6 (full transcript)
Estimated cost: $3.75
Proceed? [y/N]
```

### Re-enrichment rules

- L1 `summary` is **never** overwritten by higher levels — it's the cheap quick-reference
- L2/L3 overwrite `summary_detailed` and `tags`
- Embeddings regenerate on L2+
- Bulk upgrade: `pan conversations enrich --deep --upgrade`

### Subagent parallelism

Spawn `min(sessions_to_enrich, maxParallel)` subagents (configurable, default 4), each processes ~20 sessions sequentially. Failures isolated per session — bad sessions marked, others continue.

---

## Embeddings

```bash
pan conversations embed                      # all enriched, un-embedded
pan conversations embed --regenerate         # rebuild all
pan conversations embed --status             # stats
```

```yaml
# config.yaml
conversations:
  watchDirs: ["~/Projects"]
  embeddings: false
  embeddingProvider: openai     # openai | voyage | cohere | ollama
  embeddingModel: text-embedding-3-small
  embeddingAutoOnDeep: true
  ollamaBaseUrl: http://localhost:11434
```

API keys live in **`~/.panopticon.env`**, NEVER `config.yaml` (config may be in dotfiles repo).

---

## Dashboard: Archived Conversations Page

### Route + navigation

- New top-level page: `/conversations` (or `/archived` — bikeshed in implementation)
- Sidebar entry under Mission Control: **"Conversations"**
- Page title: **Archived Conversations**

### Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Archived Conversations                              [⚙ Settings]     │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 🔍 Search...                          [Semantic ⚪] [Filters ▾] │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Filters──────────────────────────────────────────────────────────┐ │
│ │ Source: [● All] [○ Managed-Archived] [○ Discovered] [○ Active]  │ │
│ │ Workspace: [▾ Any] | Model: [▾ Any] | Since: [▾ 30d]            │ │
│ │ Cost: [min] – [max] | Tag: [+] | Tool: [+] | File: [+]          │ │
│ │ [✓ Enriched only] [Clear filters]                               │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Facets (collapsible)─────────────────────────────────────────────┐ │
│ │ Workspace: myn (412) · panopticon-cli (287) · auricle (143) ... │ │
│ │ Model:     opus-4-6 (621) · sonnet-4-6 (312) · haiku-4-5 (98)   │ │
│ │ Period:    last 7d (84) · last 30d (412) · older (1247)         │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Results (virtualized list)───────────────────────────────────────┐ │
│ │ ⚓ PAN-449 · myn-ingest · 4h · opus-4-6 · $1.23 · 234 msgs       │ │
│ │    "Refactored the cost parser to handle batched events..."     │ │
│ │    [debugging] [refactor] [parser]                               │ │
│ │ ─────────────────────────────────────────────────────────────── │ │
│ │ 📄 ~/Projects/foo · 2d · sonnet-4-6 · $0.41 · 56 msgs           │ │
│ │    "Investigating a flaky CI test on the payment flow..."       │ │
│ │    [debugging] [ci]                                              │ │
│ │ ─────────────────────────────────────────────────────────────── │ │
│ │ ... (virtual scroll)                                             │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Row badges (`source` field)

- ⚓ **Managed-Archived** — Panopticon-archived, links to issue + agent
- 🟢 **Managed-Active** — Panopticon-managed, not yet archived
- 📄 **Discovered** — found via JSONL scan, no Panopticon link

Click any row → opens **ConversationViewer** (PAN-451 component) in a side panel or modal — same renderer for all three sources.

### Conversation viewer reuse (PAN-451 dependency)

The detail view is the existing T3Code-style viewer from PAN-451:
- Same `MessagesTimeline`, `ChatMarkdown`, `WorkLogEntry` rendering
- For managed sessions, the existing `/api/agents/:id/conversation` path is used
- For discovered sessions, a new `/api/discovered-sessions/:id/conversation` endpoint serves the same `ChatMessage[]` shape parsed from the JSONL file
- Sessions opened from this page are **read-only** by default — no input bar (or input bar disabled with tooltip: "This session is archived/external and cannot accept input")

### Real-time updates

Domain events over `/ws/rpc` already exist for managed conversations. Add:

- `DiscoveredSessionScanStarted { totalDirs }`
- `DiscoveredSessionScanProgress { dirsScanned, sessionsFound }`
- `DiscoveredSessionScanCompleted { totalSessions, durationMs }`
- `DiscoveredSessionEnriched { sessionId, level }`
- `DiscoveredSessionEmbedded { sessionId }`

Page subscribes and refreshes results live during scans/enrichments.

### Settings panel additions — "Conversations & Search"

A new section in dashboard Settings:

| Field                          | Type         | Notes                                    |
|--------------------------------|--------------|------------------------------------------|
| Enable embeddings              | toggle       | writes `conversations.embeddings`        |
| Embedding provider             | dropdown     | OpenAI / Voyage / Cohere / Ollama        |
| Embedding model                | dropdown     | scoped to provider                       |
| API key                        | password     | conditional on provider; writes env file |
| Ollama base URL                | text         | only when provider = Ollama              |
| Auto-embed on deep enrich      | toggle       | `conversations.embeddingAutoOnDeep`      |
| Watch directories              | list editor  | `conversations.watchDirs`                |
| Test connection                | button       | 1-token embed against provider, reports  |
|                                |              | success/failure + latency                |

Validation:
- Embeddings on + hosted provider + missing key → save blocked, inline error
- Provider switch → model dropdown resets to provider's default
- Embeddings disabled → semantic search UI disabled with tooltip
- Changing model after sessions are embedded → warning: "Existing embeddings used `<old>` (dim=N). Run `pan conversations embed --regenerate` — models cannot be mixed."

API keys go to **`~/.panopticon.env`** via existing secrets path. NEVER `config.yaml`.

---

## CLI Interface (full surface)

```bash
# Discovery
pan conversations scan <dir>...                     # targeted
pan conversations scan --watched                    # configured dirs
pan conversations scan --system                     # full system
pan conversations scan --system --dry-run

# Search
pan conversations search "query"                    # FTS5
pan conversations search --workspace ~/Projects/foo
pan conversations search --tag debugging --since 7d
pan conversations search --semantic "race condition"
pan conversations search --similar <session-id>
pan conversations search "query" --format json

# Enrichment
pan conversations enrich
pan conversations enrich --limit 50
pan conversations enrich --deep
pan conversations enrich --deep <session-id>
pan conversations enrich --with <model> <session-id>
pan conversations enrich --with <model> --full <session-id>
pan conversations enrich --with <model> --prompt "..." <session-id>
pan conversations enrich --deep --upgrade

# Embeddings
pan conversations embed
pan conversations embed --regenerate
pan conversations embed --status

# Browsing
pan conversations list
pan conversations list --managed
pan conversations list --unmanaged
pan conversations list --archived
pan conversations show <session-id>
pan conversations cost
pan conversations cost --by workspace
pan conversations cost --by model

# Config (parity with Settings UI)
pan config set conversations.embeddings true
pan config set conversations.embeddingProvider openai
pan config set conversations.embeddingModel text-embedding-3-small
pan config set conversations.embeddingAutoOnDeep true
pan config set conversations.ollamaBaseUrl http://localhost:11434
pan secrets set OPENAI_API_KEY sk-...
```

---

## Server Endpoints

```
GET  /api/archived-conversations
       ?source=all|managed-archived|managed-active|discovered
       &workspace=...&model=...&since=...&before=...
       &min-cost=...&max-cost=...&min-messages=...
       &tag=...&tool=...&file=...&issue=...
       &enriched=true|false
       &q=...                            (FTS5 query)
       &semantic=...                     (semantic query, requires embeddings)
       &similar=<session-id>             (find-similar)
       &cursor=...&limit=...
       &format=json|brief|ids
   → { rows: ArchivedConversationRow[], facets: {...}, nextCursor }

GET  /api/discovered-sessions/:id          → metadata row
GET  /api/discovered-sessions/:id/conversation
       → { messages: ChatMessage[], sessionId, streaming: false }

POST /api/conversations/scan               { mode: 'targeted'|'watched'|'system', dirs? }
POST /api/conversations/enrich             { ids?, level: 1|2|3, model?, full?, prompt?, scope }
POST /api/conversations/embed              { regenerate?: boolean, ids? }
GET  /api/conversations/embed/status       → { total, embedded, model }

GET  /api/conversations/cost?by=workspace|model|day
   → aggregated cost rows
```

All routes follow the existing Effect patterns in `src/dashboard/server/routes/`. **No `execSync` / `readFileSync` / `writeFileSync`** — async only.

Domain events (already covered above) emit on `/ws/rpc`.

---

## Files Changed (planning estimate)

| File | Action |
|------|--------|
| **Schema + DB** | |
| `src/lib/database/schema.ts` | MODIFY — add `discovered_sessions`, `sessions_fts`, `session_embeddings`, `archived_conversations_v` view |
| `src/lib/database/migrations/<v>-discovered-sessions.ts` | CREATE — migration for new tables/view |
| `src/lib/database/discovered-sessions-db.ts` | CREATE — CRUD + filtered queries |
| `src/lib/database/archived-conversations-db.ts` | CREATE — unified view query helpers |
| **Discovery** | |
| `src/lib/cost-parsers/jsonl-parser.ts` | MODIFY — extend extraction (tools, files, models) |
| `src/lib/conversations/scanner.ts` | CREATE — work-stealing scanner |
| `src/lib/conversations/system-probe.ts` | CREATE — CPU/drive/memory detection |
| `src/lib/conversations/hash-resolver.ts` | CREATE — Claude project hash → workspace path |
| **Enrichment + embeddings** | |
| `src/lib/conversations/enrichment.ts` | CREATE — L1/L2/L3 logic |
| `src/lib/conversations/sample-strategy.ts` | CREATE — message sampling per level |
| `src/lib/conversations/embeddings.ts` | CREATE — OpenAI/Voyage/Ollama clients |
| `src/lib/conversations/cosine-similarity.ts` | CREATE — SQLite UDF or WASM |
| **CLI** | |
| `src/cli/commands/conversations/scan.ts` | CREATE |
| `src/cli/commands/conversations/search.ts` | CREATE |
| `src/cli/commands/conversations/enrich.ts` | CREATE |
| `src/cli/commands/conversations/embed.ts` | CREATE |
| `src/cli/commands/conversations/list.ts` | CREATE |
| `src/cli/commands/conversations/show.ts` | CREATE |
| `src/cli/commands/conversations/cost.ts` | CREATE |
| `src/cli/commands/conversations/index.ts` | CREATE — command group registration |
| **Server** | |
| `src/dashboard/server/routes/archived-conversations.ts` | CREATE |
| `src/dashboard/server/routes/discovered-sessions.ts` | CREATE |
| `src/dashboard/server/routes/conversations.ts` | MODIFY — extend with scan/enrich/embed endpoints |
| `src/dashboard/server/services/archived-conversations.ts` | CREATE |
| `src/dashboard/server/services/scan-orchestrator.ts` | CREATE |
| `src/dashboard/server/services/enrichment-orchestrator.ts` | CREATE |
| `src/dashboard/server/services/conversation-service.ts` | MODIFY — handle discovered sessions too |
| `src/dashboard/server/server.ts` | MODIFY — wire new routes/services |
| **Frontend** | |
| `src/dashboard/frontend/src/pages/ArchivedConversations.tsx` | CREATE — page shell |
| `src/dashboard/frontend/src/components/archived/SearchBar.tsx` | CREATE |
| `src/dashboard/frontend/src/components/archived/FilterPanel.tsx` | CREATE |
| `src/dashboard/frontend/src/components/archived/FacetsPanel.tsx` | CREATE |
| `src/dashboard/frontend/src/components/archived/ResultsList.tsx` | CREATE — virtualized |
| `src/dashboard/frontend/src/components/archived/ResultRow.tsx` | CREATE — managed/discovered badges |
| `src/dashboard/frontend/src/components/archived/ConversationDetailPanel.tsx` | CREATE — wraps PAN-451 viewer |
| `src/dashboard/frontend/src/components/settings/ConversationsSettings.tsx` | CREATE |
| `src/dashboard/frontend/src/components/AppShell.tsx` (or routing root) | MODIFY — add nav entry + route |
| `src/dashboard/frontend/src/store/archived-conversations-store.ts` | CREATE — Zustand slice |
| **Contracts** | |
| `packages/contracts/src/archived-conversations.ts` | CREATE — RPC schemas + types |
| `packages/contracts/src/domain-events.ts` | MODIFY — add scan/enrich/embed events |
| **Config** | |
| `src/lib/config/schema.ts` | MODIFY — add `conversations.*` config |
| `src/lib/config/defaults.ts` | MODIFY |

---

## Acceptance Criteria

### Discovery
- [ ] `pan conversations scan ~/Projects` indexes all sessions under that path with zero LLM calls
- [ ] `pan conversations scan --system` indexes all sessions in `~/.claude/projects/`
- [ ] System scan adapts parallelism (SSD: cores, HDD: 2)
- [ ] Re-scan skips unchanged files (size + mtime match)
- [ ] Scan never deletes, truncates, or modifies any JSONL file
- [ ] Scan correlates discovered sessions with existing `conversations` rows (`panopticon_managed = 1`)
- [ ] Hash resolution maps `~/.claude/projects/<hash>` back to original workspace path; unresolvable hashes leave `workspace_path = NULL`
- [ ] Tools and files used by each session are extracted via JSON parsing (no LLM)

### Search
- [ ] Tier 1 structured filters return correct results and compose with AND
- [ ] Tier 2 FTS5 query returns BM25-ranked results with snippets
- [ ] FTS5 prefix, phrase, and boolean queries work
- [ ] Tier 3 semantic search returns cosine-similar results when embeddings exist
- [ ] `--similar <id>` returns nearest neighbors
- [ ] Filters compose with FTS and semantic searches
- [ ] All output formats (`table`, `json`, `brief`, `ids`) produce correct output

### Enrichment
- [ ] L1 uses cheapest model + 3 sampled messages
- [ ] L2 uses mid-tier model + 11-message sample + tool summaries
- [ ] L3 uses user-specified model; `--full` sends entire transcript; `--prompt` is appended to system prompt
- [ ] Cost estimate shown before expensive operations; confirmation required
- [ ] L1 `summary` is never overwritten by L2/L3
- [ ] `--upgrade` bulk-converts all L1 sessions to L2
- [ ] Subagent parallelism caps at configured `maxParallel`
- [ ] FTS5 index updated on every enrichment write
- [ ] Failures on individual sessions don't stop the batch

### Embeddings
- [ ] `pan conversations embed` generates embeddings for all enriched, un-embedded sessions
- [ ] `--regenerate` overwrites all embeddings
- [ ] `--status` reports counts and current model
- [ ] OpenAI, Voyage, and Ollama all work as providers
- [ ] Auto-embed on deep enrich respects config flag

### Page
- [ ] Sidebar nav entry **Conversations** routes to the new page
- [ ] Page shows managed-archived + managed-active + discovered rows in one virtualized list
- [ ] Each row carries a source badge (anchor / green-dot / document)
- [ ] Search bar drives FTS5; toggle switches to semantic mode
- [ ] Filter panel covers all Tier 1 filters; chips reflect active filters
- [ ] Facet panel groups by workspace / model / time / cost; click-to-filter works
- [ ] Click row → opens ConversationViewer (PAN-451) with messages, tool calls, code blocks, syntax highlighting
- [ ] Discovered sessions render messages identically to managed sessions
- [ ] Read-only mode: no input bar (or disabled with tooltip) on archived/discovered sessions
- [ ] Real-time updates during scans / enrichments via `/ws/rpc` domain events
- [ ] No `execSync` / `readFileSync` / `writeFileSync` in any new server route or service

### Settings UI
- [ ] **Conversations & Search** section renders all fields
- [ ] API key field is conditional on provider (hidden for Ollama)
- [ ] Ollama base URL only shown when provider = Ollama
- [ ] Provider change resets model dropdown
- [ ] Save blocked when embeddings on + hosted provider + missing key
- [ ] **Test connection** button hits provider with 1-token embed and reports
- [ ] Keys written to `~/.panopticon.env`, NEVER `config.yaml`
- [ ] Disabling embeddings disables semantic search UI in Conversations page
- [ ] Changing embedding model after sessions are embedded surfaces re-embed warning
- [ ] CLI `pan config set` and `pan secrets set` paths work for every Settings field

### CLI parity
- [ ] Every Settings UI field is also settable via `pan config set` or `pan secrets set`
- [ ] Every command in the CLI section above is implemented and documented in `--help`

---

## Testing

### Scanner
```
- discovers all sessions in target dir
- resolves project hash to workspace path
- extracts message count, timestamps, models from JSONL
- extracts tools_used / files_touched from tool_use blocks
- calculates cost estimate within 1% of actual
- correlates with existing conversations rows
- skips unchanged files (size + mtime)
- handles corrupt / empty JSONL gracefully
- handles missing sessions-index.json
- never modifies a JSONL file (verify via mtime + content hash before/after)
```

### System scan
```
- detects SSD vs HDD via lsblk rotational flag
- adjusts parallelism per drive type
- work-stealing pool processes all directories
- progress events fire with correct counts
- handles permission-denied directories gracefully
- respects maxParallel limit
```

### Search
```
- structured filters compose with AND
- relative + absolute date filters parse correctly
- tag / tool / file filters match JSON arrays
- FTS5 BM25 ranking is correct
- prefix, phrase, boolean queries work
- semantic search returns cosine-correct rankings
- --similar finds related sessions
- filters intersect with FTS / semantic results
- all --format outputs are valid
```

### Enrichment
```
- L1 selects cheapest available model
- L1 sends only 3 sampled messages
- L2 sends 11 messages + tool summaries, mid-tier model
- L3 uses user-specified model
- --full sends entire transcript
- --prompt appends to system prompt
- cost estimate within 20% of actual token count
- confirmation prompt fires for expensive ops
- L1 summary preserved across re-enrichment
- --upgrade batch converts L1 → L2
- enrichment writes update FTS5
- API failure on one session doesn't stop the batch
- subagent fanout respects maxParallel
```

### Embeddings
```
- correct dimensions stored per provider/model
- --regenerate overwrites
- --status reports correct counts
- cosine similarity ranks correctly
- OpenAI / Voyage / Ollama paths all succeed
- auto-embed on deep enrich respects config
- API failure handled per-session
```

### Page (Playwright)
```
- nav entry routes to /conversations
- page renders rows from all three sources
- search bar filters via FTS
- semantic toggle switches to vector search
- filter panel applies all Tier 1 filters
- facet click adds filter chip
- row click opens ConversationViewer
- discovered session renders identically to managed
- read-only enforcement: no input or disabled input
- scan progress updates UI in real time
- enrichment progress updates UI in real time
```

### Settings (Playwright + unit)
```
- all fields render
- conditional fields show/hide on provider switch
- save blocked when key missing
- test connection reports success/failure
- keys land in ~/.panopticon.env, never config.yaml
- semantic search disabled when embeddings off
- model-change warning shown when sessions already embedded
```

### Integration (end-to-end)
```
- scan → enrich → embed → search across all three tiers
- re-scan updates changed sessions, skips unchanged
- managed session links to issue_id and agent_id in row
- cost aggregation sums correctly across managed + discovered
- FTS index stays in sync after re-enrichment
- semantic search results improve after L2 enrichment
- Archived Conversations page shows the union with correct badges
```

---

## Dependencies

- **PAN-451** — T3Code-style Conversation View. Required as the detail-view renderer. The viewer must accept any session source (managed, archived, discovered) via a uniform `ChatMessage[]` shape.

If PAN-451 isn't merged when this issue starts, the implementation includes the minimum viewer surface needed (MessagesTimeline + ChatMarkdown + read-only mode) so this issue is deliverable independently — but the design **must** match PAN-451's component contract so the two converge.

---

## Risks

1. **Hash resolution for old projects** — Claude Code's project hash algorithm has changed across versions. Reverse map needs to handle current + at least one prior format; unresolvable hashes fall through to `workspace_path = NULL` (still browsable, search by JSONL path).

2. **System scan on machines with thousands of sessions** — Drive type matters. SSD probe verifies via `lsblk -d -o name,rota`; if probe fails, fall back to `4` workers. Test on slow HDDs with 5000+ sessions in CI fixtures.

3. **FTS5 + tags as JSON** — Tags stored as JSON array but indexed as space-joined string in FTS5. Need a tokenizer that splits on JSON delimiters (or store a parallel space-joined column for FTS only).

4. **Cosine similarity in SQLite** — Native addon adds build complexity (per-platform). Start with pure-JS cosine over Float32 BLOBs; profile; only switch to native addon if measurable hot-path. Brute-force at thousand-session scale is < 100ms.

5. **Bundle size for embeddings UI** — Avoid pulling provider SDKs into the frontend. All embedding requests go through the dashboard server.

6. **Schema migration** — Adds three tables and a view. Single migration step; reversible-ish (drop tables/view). Must run on existing v12+ databases.

7. **JSONL files are sacred** — Reinforced in CLAUDE.md. Scanner is read-only; tests verify file mtime/checksum unchanged after scan.

---

## Out of Scope (this issue)

- Editing or replaying past conversations (read-only view only)
- Deleting JSONL files (forbidden — see CLAUDE.md)
- Cross-machine sync of discovered sessions
- Automatic enrichment without user trigger
- Privacy redaction of summaries (defer to a follow-up if requested)

---

## Priority

**Medium-High.** This is the primary observability deliverable for "single pane of glass" — every Claude Code interaction on this machine, surfaced and searchable, with the polished T3Code reader. Not blocking workflows, but high leverage.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

