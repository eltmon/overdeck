---
specialist: verification-gate
issueId: PAN-457
outcome: failed
timestamp: 2026-04-20T19:13:40Z
---

VERIFICATION FAILED for PAN-457 (attempt 1/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 88/88 AC incomplete:

### Add discovered_sessions, sessions_fts, session_embeddings tables + migration (4/4 incomplete)
  - [ ] All three tables created idempotently in main + per-workspace DB on startup
  - [ ] discovered-sessions-db.ts exposes insert/upsert, findByFilters, searchFTS, insertEmbedding, topKCosine, getByJsonlPath
  - [ ] Upsert is idempotent on (jsonl_path) — re-inserting same row updates file_size/file_mtime without duplicates
  - [ ] Unit tests cover CRUD, filter composition, FTS insert/search, and embedding storage round-trip

### Async streaming JSONL parser for scanner use in dashboard server (5/5 incomplete)
  - [ ] Parses message_count, timestamps, models, token totals from a sample JSONL correctly (vitest fixture)
  - [ ] Extracts tools_used and files_touched arrays from tool_use blocks (Edit/Write/Read paths, Bash commands excluded)
  - [ ] Reads cwd from first JSONL message when present; returns null if absent or unparseable
  - [ ] Handles corrupt/empty/partial JSONLs without throwing — returns partial metadata
  - [ ] Uses only fs/promises + stream APIs — no sync FS calls (verified by lint rule or review)

### Claude project hash → workspace path resolver (4/4 incomplete)
  - [ ] JSONL-cwd primary path resolves correctly for a session with a cwd field
  - [ ] Reverse-map fallback resolves a hash to a known workspace when JSONL has no cwd
  - [ ] Returns null (not crashes) when hash is unknown and no JSONL cwd exists
  - [ ] Reverse map is built once per scan run (cached), not per session

### SystemCapabilities probe for adaptive scan parallelism (5/5 incomplete)
  - [ ] Probe returns SystemCapabilities with all four fields populated on Linux (SSD case)
  - [ ] Gracefully falls back to 'unknown' driveType on macOS/Windows without throwing
  - [ ] Chosen parallelism matches spec table (SSD→min(cores,16), HDD→2, unknown→4)
  - [ ] conversations.scanMaxParallel config override takes precedence over probe result
  - [ ] Probe uses execAsync + fs/promises — zero sync FS or execSync calls

### Scanner orchestrator with bounded parallelism work pool (9/9 incomplete)
  - [ ] Targeted mode scans only JSONLs whose resolved workspace is under the given dirs
  - [ ] Watched mode reads dirs from config.yaml conversations.watchDirs
  - [ ] System mode discovers all sessions under ~/.claude/projects
  - [ ] Change detection: re-scan of unchanged file does not re-parse JSONL (verified via parser call counter in test)
  - [ ] Work pool respects maxParallel from system-probe; concurrent reads never exceed limit
  - [ ] Progress callback fires with { dirsProcessed, dirsTotal, sessionsFound, elapsedMs }
  - [ ] Sessions matching existing conversations.session_file are marked panopticon_managed=1 with pan_issue_id + pan_agent_id populated
  - [ ] Permission-denied directories are skipped with a warning, not a crash
  - [ ] Cost estimate populated from token counts using model-capabilities.ts pricing

### CLI: pan conversations scan [dirs...] [--watched|--system|--dry-run] (5/5 incomplete)
  - [ ] `pan conversations scan ~/Projects/foo` scans and reports inserted/updated/skipped counts
  - [ ] `pan conversations scan --watched` reads watchDirs from config
  - [ ] `pan conversations scan --system` walks entire ~/.claude/projects
  - [ ] `--dry-run` performs no DB writes; prints planned counts
  - [ ] Progress bar renders with matching format to spec

### Search composer: structured filters + FTS5 + semantic + output formats (6/6 incomplete)
  - [ ] All structured filters compose with AND and produce correct SQL
  - [ ] --since 7d, --before ISO date, --after ISO date all parse and filter correctly
  - [ ] --tag/--tool/--file match against JSON array columns
  - [ ] FTS5 query with prefix (refact*), phrase ("error handling"), boolean (redis AND cache NOT test) all return BM25-ranked results
  - [ ] Filters + FTS compose: FTS query runs within the filtered set
  - [ ] --format table|json|brief|ids all produce correct shape

### CLI: search, list, show, cost subcommands (4/4 incomplete)
  - [ ] `pan conversations search "query"` runs FTS and prints table results
  - [ ] `pan conversations list --managed` lists only panopticon_managed=1 rows
  - [ ] `pan conversations show <id>` prints full session detail including current enrichment level
  - [ ] `pan conversations cost --by workspace` matches sum of discovered_sessions.estimated_cost grouped by workspace_path

### Tiered enrichment engine (L1 quick / L2 deep / L3 custom) via model-fallback router (10/10 incomplete)
  - [ ] Level 1 sends exactly 3 messages (first + last + 1 middle) to Haiku tier
  - [ ] Level 2 sends 11 messages + tool_use summaries to Sonnet tier
  - [ ] Level 3 with --with <model> calls the specified model; --full sends the entire transcript
  - [ ] --prompt "..." is appended to the enrichment system prompt
  - [ ] Re-enrichment preserves level-1 summary while overwriting summary_detailed and tags
  - [ ] Cost estimate printed and user prompted [y/N] when total exceeds costConfirmThreshold
  - [ ] Model API failure marks session as enrichment_failed (does not crash pool)
  - [ ] FTS5 rows are upserted after each successful enrichment
  - [ ] Enrichment goes through src/lib/model-fallback.ts (respects provider disabled state)
  - [ ] Cost estimate vs actual from cost_events stays within 20% on sample run

### CLI: pan conversations enrich with all flags (4/4 incomplete)
  - [ ] `pan conversations enrich --limit 50` enriches up to 50 un-enriched sessions at level 1
  - [ ] `--deep --upgrade` converts all level-1 sessions to level 2
  - [ ] `--with claude-opus-4-6 --full <id>` runs level 3 with full transcript
  - [ ] All flag combinations from spec CLI section parse and execute

### Embedding providers + pure-JS cosine similarity + semantic search (10/10 incomplete)
  - [ ] OpenAI provider calls text-embedding-3-small and stores 1536-dim Float32 BLOB
  - [ ] Voyage provider calls voyage-code-3 and stores 1024-dim BLOB
  - [ ] Ollama provider calls nomic-embed-text via local HTTP and stores BLOB
  - [ ] Cosine function ranks identical vectors as 1.0 and orthogonal as 0.0 (unit test)
  - [ ] `pan conversations embed` embeds all enriched un-embedded sessions
  - [ ] `pan conversations embed --regenerate` overwrites all embeddings
  - [ ] `pan conversations embed --status` prints indexed/embedded counts + model name
  - [ ] `pan conversations search --semantic "race condition"` returns cosine-ranked results
  - [ ] `pan conversations search --similar <id>` returns sessions ranked by similarity to that id
  - [ ] Missing API key produces an actionable error (not a silent crash)

### RPC + events contracts for conversation subsystem (3/3 incomplete)
  - [ ] All new types exported from @panopticon/contracts and typecheck passes project-wide
  - [ ] New RPC procs appear in PanRpcGroup with Effect Schema
  - [ ] Domain events are added to event-reducers.ts so the frontend store receives them

### Dashboard server routes + service for conversations (4/4 incomplete)
  - [ ] All seven endpoints return correct shapes and pass Effect Schema validation
  - [ ] Scan progress emits domain events on /ws/rpc subscribeDomainEvents stream
  - [ ] Enrichment progress emits per-session domain events with model + cost
  - [ ] Zero execSync/readFileSync/writeFileSync/readdirSync/statSync in routes or service (grep + review)

### Dashboard Conversations panel: search, facets, detail, enrichment controls (7/7 incomplete)
  - [ ] Conversations panel appears in Mission Control nav and loads recent sessions on open
  - [ ] Search bar: free-text, filter chips, semantic toggle all work and compose
  - [ ] Faceted results group by workspace/model/time/cost/enrichment-level; clicking a facet filters
  - [ ] Detail drawer shows full session with visual distinction between managed and ad-hoc sessions
  - [ ] Enrichment buttons trigger RPC calls and show live progress via domain events
  - [ ] Aggregate cost view matches `pan conversations cost --by workspace` output
  - [ ] Manual browser test: scan + search + enrich + detail view all work end-to-end

### config.yaml schema additions for conversations subsystem (3/3 incomplete)
  - [ ] New conversations config block loads with defaults when missing from config.yaml
  - [ ] Config migration leaves existing user values intact and fills defaults
  - [ ] Typed access via getConfig() for all new fields

### End-to-end integration tests: scan → enrich → embed → search (5/5 incomplete)
  - [ ] Full pipeline test: scan → enrich → embed → search returns expected top result
  - [ ] Re-scan on unchanged files does not re-parse (parser mock call count unchanged)
  - [ ] Cost aggregation equals sum of individual session estimated_cost
  - [ ] FTS stays in sync after re-enrichment (old summary text no longer matches; new text matches)
  - [ ] Managed session is correctly linked to an issue_id when conversations table has a matching session_file

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit: pan review request PAN-457 -m "Completed acceptance criteria"

Do NOT resubmit until all AC are completed.
