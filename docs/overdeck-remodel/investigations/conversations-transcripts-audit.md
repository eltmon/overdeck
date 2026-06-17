# Overdeck Remodel — Conversations + Transcripts Field Audit

**Goal:** radical complexity reduction on a fresh EMPTY DB. No backward compat,
no migration. Keep ONLY fields we genuinely NEED ("NEED, not nice-to-have").
Classify every field as **SOURCE-OF-TRUTH** (must survive a wipe; needs a
durable home — the PAN-1937 export target), **CACHE** (rebuildable from JSONL /
git / tmux / cost_events), or **DEAD** (delete).

Method: every field traced through its accessor across `src/` (non-test). The
discriminator for SOURCE-OF-TRUTH is **"after `rm panopticon.db`, is there any
path to reconstruct this value?"** If the only source is the DB row itself, it is
SOURCE-OF-TRUTH and must be exported. If a scanner/correlator/parser can recompute
it from a JSONL transcript, git record, tmux, or `cost_events`, it is CACHE.

**Headline counts:** 49 fields/columns audited across 10 tables
(`conversations` 30 cols + `discovered_sessions` 28 cols core + 4 satellite
tables + 5 search/checkpoint tables). **Conversations: 30 cols → 14 export
(SOURCE-OF-TRUTH) + favorites table, 12 CACHE, 4 DEAD.** **Transcript subsystem:
100% CACHE — every column rebuildable from JSONL.** **9 of the 10 in-scope tables
are pure disposable cache; only `conversations` (a subset) + `favorites` carry
irreplaceable Panopticon-authored state.** The collapse target: **one Transcript
index** (today `discovered_sessions`) computes the JSONL-derived facts ONCE;
Conversation references it by `claude_session_id`, Agent by `agents.session_id`.

## Glossary

- **SOURCE-OF-TRUTH (export target)** — Panopticon-authored intent or lineage
  that exists nowhere but the DB row. Must survive a wipe → exported to a durable
  home (per-issue git record or a conversations export file, PAN-1937).
- **CACHE** — recomputable from a source of truth (JSONL transcript, git
  `.pan/records`, tmux liveness, `cost_events`). Disposable; rebuilt on scan.
- **DEAD** — never read for a decision, or a deprecated/superseded field.
- **Transcript** — a single JSONL file under `~/.claude/projects/` (claude-code)
  or an agent-dir rollout (codex). Identified by its **session UUID** (the JSONL
  filename). The unit both a Conversation and an Agent point at.
- **The scan** — `src/lib/conversations/scanner.ts:scan()` walks every JSONL,
  parses it (`jsonl-async.ts`), resolves the workspace (`hash-resolver.ts`), runs
  the **correlator** (`correlator.ts`) to tag panopticon-managed sessions, and
  `upsertDiscoveredSession()`. This is the rebuild engine for the whole
  Transcript subsystem.
- **The JOIN** — `conversations` LEFT JOINs `discovered_sessions ON
  ds.session_id = c.claude_session_id` (`conversations-db.ts:445`). This is the
  load-bearing link: derived transcript facts (`message_count`, `models`,
  `first_ts`/`last_ts`, token counts, estimated cost) are **not stored on
  `conversations`** — they are read live off the Transcript index via this JOIN.

---

## Table 1 — `conversations` (30 columns)

> **The task brief says "35 cols". The canonical CREATE TABLE
> (`schema.ts:487-518`) has exactly 30.** The brief's `message_count`,
> `models_used`, `last_message_at`, `duration_seconds`, and `jsonl_path` are NOT
> `conversations` columns — they live on `discovered_sessions` and surface only
> through the LEFT JOIN (`conversations-db.ts:431-434`,
> `buildArchivedConversationFilterSql` `ds.message_count`/`ds.last_ts`). See the
> "Phantom columns" table below.

| Column | Written-at (semantic) | Read / branch | Reconstructable after wipe? | Verdict | Class |
| --- | --- | --- | --- | --- | --- |
| `id` | autoincrement | FK target for `handoff_target_conv_id`, `cleared_to_conv_id` | No — but lineage uses it; export resolves lineage by `name` instead | **KEEP** | identity (export by name) |
| `name` | `createConversation` | every lookup keys on it; `favorites.item_id` = name; correlator joins on it | No — operator/launcher-assigned identity | **EXPORT** | SOURCE-OF-TRUTH |
| `tmux_session` | `createConversation` / reactivate | attach, delivery, `getConversationByTmuxSession` | Yes — tmux is the liveness oracle; session name is derivable/ephemeral | **DROP→CACHE** | CACHE |
| `status` | spawn / `markConversationEnded` / `markAllEndedOnStartup` | list filters `status='active'` | Yes — `markAllEndedOnStartup` already recomputes from tmux at boot | **DROP→CACHE** | CACHE |
| `cwd` | `createConversation` | correlator path build (`sessionFilePath(cwd, …)`); workspace binding | Partial — in JSONL first message (`cwdFromFirstMessage`), but the conv↔cwd binding is authored | **EXPORT** | SOURCE-OF-TRUTH |
| `issue_id` | `createConversation` (optional) | cost attribution; issue binding; filters | Partial — recoverable from `cost_events` for managed convs, but it is authored intent for unmanaged | **EXPORT** | SOURCE-OF-TRUTH (borderline) |
| `created_at` | `createConversation` | ordering; `COALESCE(ds.first_ts, c.created_at)` | Partial — JSONL first_ts approximates it, but spawn time is authored | **EXPORT** | SOURCE-OF-TRUTH |
| `ended_at` | `markConversationEnded` | display | Yes — JSONL last_ts / tmux death | **DROP→CACHE** | CACHE |
| `last_attached_at` | `updateLastAttached` | recency display | Yes — tmux / ephemeral | **DROP→CACHE** | CACHE |
| `session_file` | legacy (PAN-451) | correlator candidate path (`correlator.ts:51`) | — superseded by `claude_session_id` | **DEAD** (deprecated; only legacy rows) | DEAD |
| `claude_session_id` | `createConversation` / `setConversationClaudeSessionId` | **THE JOIN key** (`ds.session_id = c.claude_session_id`); correlator path build; `getConversationByClaudeSessionId` | **No — one-directional FK.** The JSONL filename IS this UUID, but nothing inside the JSONL names the conversation back. Lose it and the conv↔transcript link is unreconstructable. | **EXPORT** | SOURCE-OF-TRUTH (the critical one) |
| `title` | `updateConversationTitle` | display; `canReplaceTitle` | Only if `title_source='manual'` — auto/ai titles regenerate from JSONL | **EXPORT (manual only)** | SOURCE-OF-TRUTH (manual); CACHE (auto/ai) |
| `title_source` | `updateConversationTitle` | `canReplaceTitle` branch (`auto` replaceable, `manual` not) | Distinguishes manual (durable) from auto/ai (regenerable) | **EXPORT** | SOURCE-OF-TRUTH |
| `title_seed` | auto-title | `canReplaceTitle` (orig auto title for replacement check) | Yes — regenerable from JSONL first message | **DROP→CACHE** | CACHE |
| `total_cost` | `updateConversationCost` (from JSONL parse) | display | **Yes — `cost_events` SUM (managed) or JSONL estimate (unmanaged).** Cost is stored 3× (see surprises). | **DROP→CACHE** | CACHE |
| `total_tokens` | `updateConversationCost` (from JSONL parse) | display | Yes — JSONL token counts | **DROP→CACHE** | CACHE |
| `archived_at` | `archiveConversation` / `unarchiveConversation` | every list filters `archived_at IS NULL`; archive view | **No — operator "archive" decision, exists only here** | **EXPORT** | SOURCE-OF-TRUTH |
| `model` | `createConversation` / `setConversationModel` / `backfillConversationModel` | spawn routing; `COALESCE(ds.primary_model, c.model)` | Partial — `ds.primary_model` is the JSONL fallback (the COALESCE proves it); but the *requested* spawn model is authored | **EXPORT (borderline)** | SOURCE-OF-TRUTH (requested) |
| `effort` | `createConversation` | spawn routing | No — authored spawn parameter; not in JSONL | **EXPORT** | SOURCE-OF-TRUTH |
| `fork_status` | `updateForkStatus` (summarizing/spawning/injecting/failed) | `getStuckForks`, restart recovery | No, but transient provisioning state — dies with the spawn | **DROP→CACHE** | CACHE |
| `fork_error` | `updateForkStatus` | display | Transient | **DROP→CACHE** | CACHE |
| `harness` | `createConversation` / `setConversationHarness` | runtime dispatch | Partial — inferable from JSONL format (pi/codex/claude-code differ); but authored | **EXPORT (borderline)** | SOURCE-OF-TRUTH |
| `delivery_method` | `updateConversationDeliveryMethod` | delivery dispatch (`auto`/`channels`/`tmux`) | Transient runtime routing | **DROP→CACHE** | CACHE |
| `spawn_error` | `updateSpawnError` | display when background spawn failed | Transient | **DROP→CACHE** | CACHE |
| `handoff_doc_path` | `recordConversationHandoff` | handoff lineage; path to agent-authored doc | **No — lineage authored at handoff time** | **EXPORT** | SOURCE-OF-TRUTH (lineage) |
| `handoff_target_conv_id` | `recordConversationHandoff` | handoff lineage edge | **No — lineage edge between two convs** | **EXPORT** (resolve by name) | SOURCE-OF-TRUTH (lineage) |
| `fork_fallback_reason` | `updateConversationForkFallbackReason` | display (why fork mode fell back) | Transient diagnostic | **DROP→CACHE** | CACHE |
| `cleared_to_conv_id` | `setClearedToConvId` (PAN-1458) | `/clear` lineage: sibling conv that continues this one | **No — lineage edge** | **EXPORT** (resolve by name) | SOURCE-OF-TRUTH (lineage) |
| `fork_request` | `setForkRequest` (JSON blob for restart) | restart recovery | Transient restart-recovery state | **DROP→CACHE** | CACHE |
| `fork_retry_count` | `incrementForkRetryCount` | restart retry guard | Transient breaker | **DROP→CACHE** | CACHE |

### The export target — irreplaceable conversation fields (PAN-1937)

These are the ONLY `conversations` fields with no reconstruction path. Export
exactly this set (plus the `favorites` table):

1. `name` — identity (lineage edges resolve to it)
2. `cwd` — conversation↔workspace binding
3. `issue_id` — cost/issue attribution (authored)
4. `created_at` — spawn time
5. `claude_session_id` — **the conv↔transcript link; one-directional, unreconstructable**
6. `title` *(only when `title_source='manual'`)*
7. `title_source`
8. `model` *(requested spawn model)*
9. `effort` *(requested spawn effort)*
10. `harness` *(requested runtime)*
11. `archived_at` — operator archive decision
12. `handoff_doc_path` — handoff lineage
13. `handoff_target_conv_id` — handoff lineage edge (export by target `name`)
14. `cleared_to_conv_id` — /clear lineage edge (export by sibling `name`)

Plus: **`favorites`** rows of `type='conversation'` (item_id = conversation
`name`) — operator "star" decisions, authored, unreconstructable.

Everything else on `conversations` is CACHE (rebuilds from JSONL/tmux/cost_events)
or DEAD.

### Phantom columns — listed in the task brief but NOT `conversations` columns

| Listed as a `conversations` field | Reality |
| --- | --- |
| `message_count` | Column on **`discovered_sessions`**. Surfaces on conversations only via the LEFT JOIN (`ds.message_count`, `conversations-db.ts:431`). CACHE (JSONL-derived). |
| `models_used` | **`discovered_sessions.models_used`** (JSON array). CACHE. |
| `last_message_at` | Not a column anywhere; the JOIN exposes **`ds.last_ts`** (`COALESCE(ds.last_ts, c.archived_at)`). CACHE. |
| `duration_seconds` | **Does not exist** in either table. Computed on the fly from `first_ts`/`last_ts` if at all. N/A. |
| `jsonl_path` | **`discovered_sessions.jsonl_path`** (the scan's UNIQUE key). Exposed via JOIN as `discoveredJsonlPath`. CACHE (it IS the file path). |

The brief's framing — "conversations stores message_count/models/cost/tokens
and a jsonl_path" — is half-true: only `total_cost`/`total_tokens` are real
`conversations` columns (and both are CACHE). The rest are read off the
Transcript index. **This is the duplication answer (Q3): there is no real
duplication to delete — the JOIN already means conversations does NOT store the
derived transcript facts.** The only true triplication is *cost* (below).

---

## Table 2 — Transcript subsystem (all CACHE)

### 2a. `discovered_sessions` (28 columns) — the Transcript index

Every column is written by `upsertDiscoveredSession()` from the scan. Source of
each value:

| Column | Source | Class |
| --- | --- | --- |
| `id` | autoincrement | identity (CACHE) |
| `jsonl_path` | the file path (UNIQUE scan key) | CACHE — it is the file |
| `session_id` | JSONL (`meta.sessionId`) = filename UUID | CACHE |
| `workspace_path` | `hash-resolver.ts` (JSONL cwd + watch dirs) | CACHE |
| `workspace_hash` | resolver | CACHE |
| `message_count` | JSONL parse (`meta.messageCount`) | CACHE |
| `first_ts` / `last_ts` | JSONL parse | CACHE |
| `models_used` | JSONL parse (`meta.modelsUsed`) | CACHE |
| `primary_model` | JSONL parse | CACHE |
| `token_input` / `token_output` | JSONL parse | CACHE |
| `estimated_cost` | `estimateCost(primaryModel, tokens)` — pricing × tokens | CACHE |
| `tools_used` | JSONL parse (`meta.toolsUsed`) | CACHE |
| `files_touched` | JSONL parse (`meta.filesTouched`) | CACHE |
| `tags` | **enrichment** (LLM) | CACHE (regenerable, costs $) |
| `summary` / `summary_detailed` | **enrichment** (LLM) | CACHE (regenerable, costs $) |
| `enrichment_level` (0–3) | enrichment tier reached | CACHE |
| `enrichment_model` / `enriched_at` | enrichment run metadata | CACHE |
| `enrichment_failed` | enrichment error flag | CACHE |
| `panopticon_managed` | **correlator** (JSONL path ↔ `conversations`/`cost_events`) | CACHE |
| `pan_issue_id` / `pan_agent_id` | correlator (from `conversations.issue_id`/`name` or `cost_events`) | CACHE |
| `file_size` / `file_mtime` | `fs.stat` — the scan's change-detection key | CACHE |
| `scanned_at` | scan timestamp | CACHE |

**Verdict: 100% CACHE.** The scan's incremental key is `(file_size, file_mtime)`;
after a wipe, a full scan rebuilds every row. The correlator's "managed" tagging
depends on `conversations` (authored) + `cost_events` (cache) — both available
post-rebuild, so even the managed flags reconstruct.

### 2b. Satellite index tables — `discovered_session_tags` / `_tools` / `_files`

Normalized inverted indexes (`(session_id, tag/tool/file_path)` PKs) for archived-
conversation filtering (`archivedArrayIndexCondition`, `conversations-db.ts:309`).
Rebuilt from `discovered_sessions.tags`/`tools_used`/`files_touched` on every
upsert (`schema.ts:48-63` `replaceRow`). **Pure CACHE.**

### 2c. `sessions_fts` (+ `_data`/`_config`/`_idx`/`_docsize`)

FTS5 virtual table over `(summary, summary_detailed, tags, files_touched)`,
`content='discovered_sessions'`. Rebuilt by `syncFts()` →
`INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')`
(`discovered-sessions-db.ts:653`). Queried live via `/api/discovered-sessions/search`
(`searchFtsSessions`, `searchFts`). **Pure CACHE** — a derived index over the
(already cached) enrichment text. Keep the *capability*; it stores nothing
irreplaceable.

### 2d. `session_embeddings`

Float32 BLOB embeddings keyed `(session_id, model)`, cosine-ranked by `topKCosine`
(`discovered-sessions-db.ts:787`) for semantic / similar-session search. Produced
from enrichment text. **Pure CACHE** (regenerable, costs $ — embedding API calls).

### 2e. `processed_sessions`

`(session_id PK, byte_offset, event_count)` — byte-offset cursor consumed ONLY by
`src/lib/costs/reconciler.ts` so the cost reconciler doesn't re-ingest already-
processed JSONL bytes into `cost_events`. **CACHE**, with a caveat: it is a
**dedup guard**. Wiping it without also wiping `cost_events` risks double-counting
cost. In a full-wipe rebuild (both gone) it is consistent.

### 2f. `transcript_checkpoints`

`(session_id PK, last_offset, mid_turn_count, claim_*, …)` — byte-offset + claim
lease consumed ONLY by the **`src/lib/memory/`** subsystem (poller, checkpoint-
worker, reconciliation) to incrementally feed the observation/memory pipeline.
**CACHE** dedup guard, same caveat as `processed_sessions` (pairs with the memory
store). **Boundary note: this table belongs to the Memory domain, not
Conversations/Transcripts** — it is listed here by the task but its sole consumer
is `memory/`. Recommend it move to the Memory audit.

---

## Q1 answer — irreplaceable metadata vs derived

The export-target list above (14 fields + favorites) is the **IRREPLACEABLE**
set. The task's proposed "DERIVED-from-JSONL" list is correct for
`message_count`, `models_used`, `total_cost`, `total_tokens`, `last_message_at`,
`duration_seconds`, `jsonl_path` — **with two corrections**:

- `claude_session_id` is **NOT** derived. It is the one-directional, unreconstructable
  conv↔transcript link → SOURCE-OF-TRUTH. (Task tentatively put it in the derived
  bucket; that is wrong.)
- The `fork_*`/`handoff_*`/`cleared_*` cluster **splits**: lineage edges
  (`handoff_doc_path`, `handoff_target_conv_id`, `cleared_to_conv_id`) are
  irreplaceable; provisioning/recovery (`fork_status`, `fork_error`,
  `fork_request`, `fork_retry_count`, `fork_fallback_reason`, `spawn_error`) are
  transient CACHE.

## Q2 answer — what we NEED to index + search transcripts

- **To index:** the scan + `discovered_sessions` (one row per JSONL, derived
  facts). That is the whole NEED. Everything in it is rebuildable.
- **Is it all pure cache?** Yes — 100%. Confirmed field-by-field against
  `scanner.ts:scan()` and `upsertDiscoveredSession()`.
- **FTS / embeddings used?** Both are live-wired (`/api/discovered-sessions/search`,
  `conversations/search.ts` FTS5 + `topKCosine`). Worth keeping the *capability*
  but both are pure derived indexes — they need no export and rebuild from
  enrichment text.
- **Enrichment (`summary`/`summary_detailed`/`tags`/`enrichment_level`):** a
  **nicety, not load-bearing.** It is LLM-generated text that exists to make FTS/
  semantic search meaningful; it drives no pipeline decision. Regenerable (costs
  $ in API calls). Classify as CACHE-that-costs-money-to-rebuild. Recommend
  enrichment stay opt-in / lazy, never blocking.

## Q3 answer — the duplication, quantified and collapsed

The brief's premise ("`conversations` and `discovered_sessions` both store
message_count/models/cost/tokens") is **mostly already false**: `conversations`
does NOT store message_count/models/first_ts/last_ts/tokens — those are read off
`discovered_sessions` via the JOIN (`ds.session_id = c.claude_session_id`). The
real overlap is narrow:

- **Cost is stored THREE times:** `conversations.total_cost` (actual, cache-
  discount-aware), `discovered_sessions.estimated_cost` (token×pricing estimate),
  and `cost_events` SUM (actual, authoritative for managed convs).
  `validateEstimatedCost` (`scanner.ts:373`) already cross-checks two of them.
- **Tokens twice:** `conversations.total_tokens` and
  `discovered_sessions.token_input+token_output`.

**Collapse:** delete `conversations.total_cost` and `conversations.total_tokens`.
Derive cost once — from `cost_events` for managed convs, JSONL estimate for
unmanaged — and let Conversation read it through the Transcript index (the JOIN
already does exactly this for every other derived fact). One Transcript concept
computes the derived facts ONCE keyed by `session_id`; Conversation references it
by `claude_session_id`, Agent by `agents.session_id`.

## Q4 answer — DOMAIN BOUNDARY: Transcript is a shared index/service, NOT a domain

**Recommendation: Transcript is an internal index/service shared by Conversations
and Agents — it gets NO top-level resolver and NO navigable view of its own.**

Grounding:
- A **Conversation** points at its transcript by `conversations.claude_session_id`.
- An **Agent** resolves its transcript directly by `agents.session_id` /
  `session.id` → `sessionFilePath(workspace, sessionId)`
  (`jsonl-resolver.ts`, `agents.ts:4631`) — it does not need
  `discovered_sessions` to FIND its JSONL.
- `discovered_sessions` is the place those two converge: it computes derived
  facts once per JSONL and tags each with the owning conv/agent/issue
  (`pan_issue_id`/`pan_agent_id`, via the correlator). It is an index keyed by
  session UUID, consumed by both.

This matches the operator's mental model (memory:
`project_issue_view_is_tree_plus_conversation`): the operator does **not** think
in "sessions". Conversation and Agent stay distinct first-class entities that
each *have* a transcript. Promoting Transcript to a domain with its own resolver/
view would resurrect the "sessions" concept the remodel is trying to dissolve.

So: **one Transcript service** (the read-side resolver for "give me the derived
facts + search for this JSONL"), invoked by the Conversation resolver and the
Agent resolver. Not a fifth pane.

## Q5 — Dead / duplicate / never-read fields

- **`conversations.session_file`** — DEAD. Deprecated by PAN-451; superseded by
  `claude_session_id`. Read only by the correlator as a legacy candidate path;
  no new row sets it.
- **`conversations.total_cost` / `total_tokens`** — duplicate (triplicated)
  cache; delete and derive (Q3).
- **`title_seed`** — regenerable; not export-worthy.
- The transient `fork_*`/`spawn_error`/`delivery_method`/`tmux_session`/`status`/
  `ended_at`/`last_attached_at` cluster — none irreplaceable; all rebuild from
  tmux/JSONL.
- No phantom columns inside the two tables themselves (unlike the review-status
  audit's `reviewer_verdicts`), but the **task brief's column list for
  `conversations` is stale**: it names 5 fields that live on `discovered_sessions`
  and claims 35 cols where there are 30.

---

## Surprises

1. **The "duplication" is mostly already collapsed.** `conversations` does NOT
   store the derived transcript facts — it JOINs `discovered_sessions ON
   ds.session_id = c.claude_session_id`. The brief's headline overlap
   (message_count/models/tokens stored in both) is false for everything except
   cost. The real win is deleting `total_cost`/`total_tokens` and the one
   genuine triplication (cost in 3 places), not de-duping the whole table.

2. **TWO independent search systems, both live.** (a) Session-level: `sessions_fts`
   (FTS5) + `session_embeddings` (cosine) over `discovered_sessions`, via
   `src/lib/conversations/search.ts`, exposed at `/api/discovered-sessions/search`.
   (b) Chunk-level: `src/lib/conversation-search/` (chunker/indexer/ranker) over a
   **separate embeddings DB** (`conversation-embeddings-db.ts:openEmbeddingsDb`),
   for the command palette. They do not share tables. This is the prime
   complexity-reduction target — but the chunk-level system's store is
   out-of-scope for these tables, so the recommendation is: **consolidate the two
   transcript search systems**, flag it as its own remodel item; do not audit the
   separate DB's fields here.

3. **Cost stored three times, already cross-validated.** `conversations.total_cost`,
   `discovered_sessions.estimated_cost`, and `cost_events` SUM.
   `validateEstimatedCost` exists *because* of this divergence. Collapse to a
   single derivation off `cost_events` / JSONL estimate.

4. **`claude_session_id` is the one irreplaceable transcript link.** The JSONL
   filename is the session UUID, but nothing in the JSONL names the conversation
   back. Lose the column → the conv↔transcript binding is gone forever. It is the
   single most important export field in this domain.

5. **`transcript_checkpoints` is Memory-domain state, not Conversation/Transcript
   state.** Its only consumers are `src/lib/memory/*`. Listed here by the task,
   but it belongs in the Memory audit. CACHE either way.

6. **`processed_sessions` and `transcript_checkpoints` are dedup guards, not
   data.** Both are byte-offset cursors into JSONL. Safe to wipe ONLY together
   with their paired store (`cost_events` for processed, the memory store for
   checkpoints); a partial wipe risks double-processing. In a full DB wipe this
   is consistent.

7. **Enrichment is a search nicety, not load-bearing.** `summary`/`tags`/
   `enrichment_level` feed FTS/embeddings and nothing else — no pipeline gate
   reads them. Regenerable, costs API $. Keep lazy/opt-in.

8. **`discovered_sessions.panopticon_managed` (+ `pan_issue_id`/`pan_agent_id`)
   is derived from `conversations` + `cost_events`, not stored truth.** The
   correlator joins JSONL paths against `conversations.session_file`/
   `claude_session_id` and `cost_events.session_id`. So the "managed" tagging
   rebuilds for free once those two tables exist — confirming the whole Transcript
   index is disposable.
