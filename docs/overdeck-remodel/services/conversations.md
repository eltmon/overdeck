# Overdeck — The Conversations Domain (+ the Transcripts read service)

> **Status:** the second domain section, built to the keystone's shape
> ([`issues.md`](issues.md)). Grounded in a no-loss mapping of the real current
> API surface (Part 1), then the Effect v4-beta services derived from it
> (Part 2). Every service method traces to a Part-1 row; no column or endpoint is
> invented.
>
> **Operator goal: functional parity** — preserve every existing capability, drop
> only the redundant/wrong ways. NOT cache-purity for its own sake.
>
> **Critical invariant (this domain's reason to exist as a section):** the
> backing **session files** (claude/pi/codex JSONL) are **SACRED**. The writer
> touches only the DB and creates **NEW** backing files; it **never mutates,
> truncates, appends-to, or deletes an existing one**. The single current
> violation — `conversation-compaction.ts:164` appending a compact boundary into
> the live claude JSONL — converts to the **fork pattern** (write a new file).
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `conversations` / `conversation_files` / `favorites` / `transcripts`
> tables), and the two evidence audits
> [`../investigations/conversations-transcripts-audit.md`](../investigations/conversations-transcripts-audit.md)
> (every column classed SOURCE-OF-TRUTH / CACHE / DEAD) and
> [`../investigations/conversation-backing-files.md`](../investigations/conversation-backing-files.md)
> (the pointer model + the sacred-file write-side audit).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Conversation** — an operator-facing, human-supervised coding session. A thin
  **DB-resident metadata record** (name, title, model/effort/harness, lineage,
  archive flag) plus a **pointer** to one or more sacred backing files. Distinct
  first-class entity from an Agent; the operator does not think in "sessions".
- **Backing session file (transcript)** — the harness-owned JSONL the coding
  agent appends to as the conversation runs. Claude Code, pi, codex, and
  kimi-via-CLIProxy each use a different on-disk shape (backing-files §2).
  **Sacred:** Panopticon reads these, never mutates/deletes them, never commits
  them to git. They live under `~/.claude/projects/` and `~/.panopticon/agents/`,
  both outside any repo.
- **Pointer** — the field(s) that locate a backing file: `claude_session_id`
  (claude-code) **or** the per-agent locator keyed by `tmux_session` + `harness`
  (pi/codex). One conversation may point at **several** files across its life (a
  harness switch creates a new file; the old one is preserved). The locked schema
  normalizes these into the **`conversation_files`** table (schema 121-127).
- **Metadata (the irreplaceable set)** — the 14 conversation fields + `favorites`
  rows that exist **only** in the DB row (audit §"The export target"): `name`,
  `cwd`, `issue_id`, `created_at`, `claude_session_id`, `title`(manual),
  `title_source`, `model`, `effort`, `harness`, `archived_at`, and the three
  lineage edges `handoff_doc_path` / `handoff_target_conv_id` /
  `cleared_to_conv_id`. **The one DB-as-truth exception in the whole remodel.**
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  domain's cache (`ConversationsResolver`). Returns validated `Conversation`
  entities.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  domain's cache (`ConversationWriter`). Writes **only** the DB and creates
  **new** backing files; never mutates an existing one.
- **TranscriptsResolver** — the shared **read-only** service that parses a backing
  file across harness shapes and rebuilds the disposable `transcripts` index. Not
  a domain (no writer that owns durable truth, no pane). Consumed by both
  Conversations and Agents. "Read-only" means **toward the sacred files** — it
  may rebuild its own cache index.
- **The fork primitive** — the single "create a fresh UUID backing file +
  register a `conversation_files` pointer" path. Every file-creating verb
  (handoff, clear, summary-fork, switch-model, compaction) routes through it.
  Backed today by `summary-fork.ts` (`reserveSummaryForkSession` → `randomUUID()`)
  and `session-format-converter.ts` (harness switch → new file).
- **ConversationRuntime** — the live-session control surface for a conversation:
  tmux spawn/stop/resume/restart, message + keystroke delivery, attachment
  staging, and the live needs-you/pending-input scan. **This section introduces
  it as a NEW sibling service, retained in scope** — it is the conversation's
  *process* half, the way `AgentWriter.spawn` is the agent's process half
  (CONVENTIONS splits lifecycle-stage from process). It is **not** AgentWriter:
  conversations are not in the `agents` table (no `issueId` FK; rows
  `conv-<name>`). It mutates tmux + the CACHE columns (`status`, `tmux_session`,
  `delivery_method` — all audited CACHE), never the irreplaceable metadata. Kept
  thin and separate so `ConversationWriter` owns only durable metadata.
- **Relocate** — a disposition: the current endpoint/verb is **not lost and not
  the metadata writer's to own**; it maps to a *sibling* surface — chiefly
  **ConversationRuntime** (above), or Transcripts, or Diffs, or Cost. Distinct
  from DELETE (genuinely dropped). (Runtime is in-domain-scope-but-different-door,
  not shipped to another team; Diffs/Cost are other domains.)
- **Aggregate read** — a cross-cutting read (the enriched list) that **recomposes**
  Conversation metadata + Transcripts-derived facts at the controller. Not a
  single stored shape.

---

## ⚠️ Headline finding — Conversations **inverts** the writer durability model, and the one durable home (PAN-1937 export) is **not built**

Issues' writer is **source-first**: git `.pan/records` is the truth, the DB row is
a rebuildable cache, so `IssueWriter.advance` does `records.writeIssue()` **then**
the cache. **Conversations is the explicit exception to that model** (schema
90-96; audit §4.1; backing-files §4): there is **no git mirror** for conversation
metadata. The `conversations` row (+ `favorites`) **is** the source of truth.

Two consequences the section must state loudly and must NOT paper over by
pattern-matching the Issues template:

1. **`ConversationWriter` has no `records.*` step.** Its ordering is: **write the
   DB row (that write *is* the commit point) → emit the event.** Copying Issues'
   `records.writeX()` then cache here would be wrong — there is nothing to mirror
   to.

2. **The durable home does not exist yet.** The irreplaceable metadata's only
   cross-wipe durability is the **PAN-1937 export**, which is **not built** —
   verified: no `export` command/endpoint/function exists (backing-files §4.2;
   `src/cli/commands/conversations/` has no `export`). **So today, on
   `rm panopticon.db`, the conversation metadata is LOST.** This is the single
   biggest correctness gap in the domain and is recorded in the residue (§1F).
   Until the export lands, `overdeck.db`'s `conversations`/`favorites` remain the
   one set of rows that are **not** safely rebuildable — the schema header calls
   this out (schema 9-12).

Everything else in the domain — the transcript, all derived facts, the
`transcripts` index, FTS, embeddings — **is** disposable cache that rebuilds from
the surviving sacred files. The asymmetry (metadata = truth, everything else =
cache) is the spine of both audits and drives every disposition below.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, `pan` CLI verb, RPC method) that **reads or
writes conversation state OR reads a transcript** — with its new home.
Disposition is one of four:

- **READ →** a `ConversationsResolver` or `TranscriptsResolver` method.
- **WRITE →** a `ConversationWriter` verb (`create` / `archive` /
  `setFavorite` / `handoff` / `clear` / `forkNewFile` / `retitle` / `setHarness`).
- **RELOCATE →** a *sibling* surface (ConversationRuntime/delivery, Transcripts
  rebuild, Diffs). Not lost, not Conversations' to own.
- **DELETE →** deliberately dropped (redundant door, dead field, folded), with
  the reason.

Stores legend used in reasons: **DB** = the `conversations`/`favorites`/
`conversation_files` rows (the SOURCE OF TRUTH here) · **JSONL** = the sacred
backing file (read-only) · **TX** = the disposable `transcripts` index (was
`discovered_sessions`) · **EXPORT** = the unbuilt PAN-1937 durable home.

> **Count correction.** The task brief and `API-SURFACE.md` §H both say
> `conversations.ts` has **27** routes; the actual `HttpRouter.add` count on `main`
> @ `840117fadc` is **30** (enumerated below). The template does exactly this
> correction (audit: brief "35 cols" → real 30), so the drift is expected; the
> real number is 30 and every one is dispositioned.

## 1A. HTTP endpoints — `conversations.ts` (30)

### Reads (conversation metadata + transcript) → resolvers

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/conversations` (`conversations.ts:2242`) | reads | **aggregate → recomposed** from `ConversationsResolver.list` + `TranscriptsResolver.facts` | `getEnrichedConversationList` LEFT-JOINs `discovered_sessions` for message_count/models/cost (audit §"The JOIN"). The list is metadata (resolver) **plus** derived facts (Transcripts) recomposed at the controller — not one stored shape. |
| `GET /api/conversations/archived` (`conversations.ts:2339`) | reads | **`ConversationsResolver.list({ archived: true })`** | Same list, `archived_at IS NOT NULL` filter. One resolver, a filter flag. |
| `GET /api/conversations/:id` (`conversations.ts:2355`) | reads | **`ConversationsResolver.get(id)`** | Single-row fetch (also serves agent/planning rows the list excludes). |
| `GET /api/conversations/pending-input` (`conversations.ts:2277`) | reads | **RELOCATE → ConversationRuntime (needs-you feed)** | PAN-1705 live-liveness scan: filters tmux-alive convs + scans JSONL for a pending AskUserQuestion. It is a *runtime liveness + transcript-tail* read, not a metadata read; pairs with the tmux oracle, not the `conversations` cache. |
| `GET /api/conversations/:name/messages` (`conversations.ts:3011`) | reads | **`TranscriptsResolver.parse(conv)`** | Parses the backing file across harness shapes (`getCachedMessages` → claude/pi/codex dispatch, `conversations.ts:541-547`). THE canonical transcript read. |
| `GET /api/conversations/:name/message-locator` (`conversations.ts:3155`) | reads | **`TranscriptsResolver.resolveFile(conv)`** | Returns the resolved backing-file path for a message — the harness-aware resolver's path output. |
| `GET /api/conversations/:name/handoff-doc` (`conversations.ts:2448`) | reads | **`ConversationsResolver.getHandoffDoc(name)`** | Reads the handoff doc the row's `handoff_doc_path` points at (under `~/.panopticon/handoffs/`, not git). Metadata-adjacent read keyed by the lineage edge. |
| `GET /api/conversations/:name/about` (`conversations.ts:4835`) | reads | **aggregate → recomposed** (metadata + Transcripts facts) | "About this conversation" summary card; same compose as the list, single-row. |
| `GET /api/conversations/:name/diffs` (`conversations.ts:4429`) | reads | **RELOCATE → Diffs** (`API-SURFACE.md` §H: "Diffs — `diffs.ts` (5) + `conversations/:name/diffs*`") | Per-turn workspace diffs are the Diffs domain; the conversation only supplies the name. |
| `GET /api/conversations/:name/diffs/full` (`conversations.ts:4592`) | reads | **RELOCATE → Diffs** | Same. |
| `GET /api/conversations/:name/diffs/:turnId` (`conversations.ts:4668`) | reads | **RELOCATE → Diffs** | Same. |

### Writes (metadata + new-file) → `ConversationWriter`; runtime/delivery → RELOCATE

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/conversations` (`conversations.ts:2469`) | writes | **`ConversationWriter.create(...)`** (+ RELOCATE spawn) | Writes the DB row + a **new** `claude_session_id` (`randomUUID()`, line 2528) and inserts a `conversation_files` pointer; the tmux **spawn** + initial message delivery is **ConversationRuntime** (split exactly as Issues split `start` → `advance` + `AgentWriter.spawn`). Row-first ordering already matches the writer rule (row inserted before spawn, line 2543 comment). |
| `PATCH /api/conversations/:name` (`conversations.ts:3453`) | writes | **`ConversationWriter.retitle(name, title)`** | `patchConversationTitle` → `updateConversationTitle` sets `title`/`title_source='manual'` (audit: manual title is SOURCE-OF-TRUTH). |
| `POST /api/conversations/:name/retitle` (`conversations.ts:4769`) | writes | **`ConversationWriter.retitle(...)`** | Duplicate title door (AI/auto retitle) → one verb; `title_source` distinguishes manual vs regenerable. |
| `POST /api/conversations/:name/archive` (`conversations.ts:3515`) | writes | **`ConversationWriter.archive(name)`** (+ RELOCATE stop) | Sets `archived_at` (SOURCE-OF-TRUTH), removes the favorite, cleans attachments; the runtime **stop** (`stopConversationRuntime`) relocates. Archiving is the ONLY removal — convs are never hard-deleted (line 2623 comment). |
| `DELETE /api/conversations/:name` (`conversations.ts:3478`) | writes | **FOLD → `ConversationWriter.archive` (idempotent variant)** | Same effect as archive (stop → markEnded → archive → removeFavorite → cleanup, lines 3494-3499) with **one difference**: `DELETE` has no "already archived" guard (it archives unconditionally → idempotent 200), whereas `POST …/archive` returns 400 if `conv.archivedAt` is already set (line 3530). Keep the HTTP `DELETE` verb as a thin alias, but have the alias **swallow `AlreadyArchived`** (return success) to preserve DELETE's current idempotent behavior — a deliberate, documented behavior match, not "identical bodies." |
| `POST /api/conversations/:name/unarchive` (`conversations.ts:3559`) | writes | **`ConversationWriter.unarchive(name)`** | Clears `archived_at`. The inverse of archive; a real write the named-verb list omits — kept. |
| `POST /api/conversations/:name/favorite` (`conversations.ts:3663`) | writes | **`ConversationWriter.setFavorite('conversation', name)`** | Inserts a `favorites` row (SOURCE-OF-TRUTH). |
| `DELETE /api/conversations/:name/favorite` (`conversations.ts:3692`) | writes | **`ConversationWriter.unsetFavorite('conversation', name)`** | Deletes the `favorites` row. |
| `POST /api/conversations/:name/switch-model` (`conversations.ts:2788`) | writes | **`ConversationWriter.setHarness/setModel` (+ `forkNewFile` on harness change) + RELOCATE respawn** | Persists requested model/harness (SOURCE-OF-TRUTH, audit rows `model`/`harness`); a **harness** change creates a NEW backing file via `session-format-converter.ts` (the fork primitive) and registers a `conversation_files` pointer; the tmux respawn is ConversationRuntime. |
| `POST /api/conversations/:name/summary-fork` (`conversations.ts:4177`) | writes | **`ConversationWriter.forkNewFile(...)` → new conv (+ RELOCATE spawn)** | Reads the source file read-only (`getTranscriptAdapter(...).resolveSessionFile`, line 4194), generates a summary, **creates a fresh UUID session file + a new conversation** (`reserveSummaryForkSession` → `randomUUID()`, `summary-fork.ts:562`). Source never touched — compliant by design (backing-files §3 row 1). Spawn relocates. |
| `POST /api/conversations/restart-all` (`conversations.ts:3597`) | writes | **RELOCATE → ConversationRuntime** | Kills + respawns every live conv's tmux session with its stored model; mutates the runtime, not metadata (it only calls `setConversationHarness`/`markConversationActive` as cache side-effects, both CACHE per audit). |
| `POST /api/conversations/:name/stop` (`conversations.ts:2628`) | writes | **RELOCATE → ConversationRuntime.stop** | Kills tmux + `markConversationEnded` (status is CACHE, recomputed from tmux at boot — audit row `status`). No metadata write. |
| `POST /api/conversations/:name/resume` (`conversations.ts:2668`) | writes | **RELOCATE → ConversationRuntime.resume** | Respawns the tmux session; runtime lifecycle. |
| `POST /api/conversations/:name/message` (`conversations.ts:3299`) | writes | **RELOCATE → ConversationRuntime.deliver** | `handleConversationMessage` → `deliverAgentMessage` into the tmux session. Pure delivery, not metadata. |
| `POST /api/conversations/:name/delivery-method` (`conversations.ts:3395`) | writes | **RELOCATE → ConversationRuntime** | Sets `delivery_method` (transient runtime routing — CACHE, audit row `delivery_method`). |
| `POST /api/conversations/:id/codex-approval` (`conversations.ts:3339`) | writes | **RELOCATE → ConversationRuntime** | PAN-1690: drives a codex TUI approval menu via `sendRawKeystroke`. Runtime input. |
| `POST /api/conversations/:name/plan-action` (`conversations.ts:4380`) | writes | **RELOCATE → ConversationRuntime** | Sends plan-mode keystrokes/feedback into the tmux session (`sendRawKeystroke` + `deliverAgentMessage`, line ~4400). Runtime input. |
| `POST /api/conversations/:name/upload-image` (`conversations.ts:3195`) | writes | **RELOCATE → ConversationRuntime (attachments)** | Stages a paste attachment for the next delivery; not a `conversations`-row field. |
| `POST /api/conversations/:name/delete-image` (`conversations.ts:3263`) | writes | **RELOCATE → ConversationRuntime (attachments)** | Removes a staged attachment. |

> **`clear` (the `/clear` lineage write).** There is no `POST /clear` HTTP route;
> the operator's `/clear` is intercepted server-side and handled by
> `conversation-lifecycle.ts:299` — it spawns a **sibling** conversation that
> continues the cleared one and records the lineage edge
> (`setClearedToConvId(parent.name, sibling.id)`, PAN-1458). This is a
> **`ConversationWriter.clear(name)`** write: create the new conv + new backing
> file (the fork primitive) + set the `cleared_to_conv_id` edge. Traced for
> completeness — the verb is real even though its trigger is not a REST route.

## 1B. Transcript / discovered-sessions HTTP — `discovered-sessions.ts` (12)

The Transcript index (`transcripts`, was `discovered_sessions`) is **100% cache**
(audit §2). Its reads are `TranscriptsResolver` methods; its rebuild/enrich/embed
operations are **cache-maintenance** that the resolver owns (there is no durable
source to mirror, so no separate writer — CONVENTIONS §5 rule 2: "pure-cache
domains have no step 1").

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/discovered-sessions` (`discovered-sessions.ts:211`) | reads | **`TranscriptsResolver.list(filter)`** | List the index rows. |
| `GET /api/discovered-sessions/:id` (`discovered-sessions.ts:375`) | reads | **`TranscriptsResolver.get(id)`** | Single index row. |
| `GET /api/discovered-sessions/stats` (`discovered-sessions.ts:198`) | reads | **`TranscriptsResolver.stats()`** | Aggregate counts over the index. |
| `GET /api/discovered-sessions/cost` (`discovered-sessions.ts:358`) | reads | **RELOCATE → Cost** | Estimated-cost rollup is a Cost concern (cost is triplicated; collapse to `cost_events` — audit Q3). |
| `GET /api/discovered-sessions/search` (`discovered-sessions.ts:303`) | reads | **`TranscriptsResolver.search(query)`** | FTS5 over enrichment text (`sessions_fts`). Pure derived index (audit §2c). |
| `GET /api/discovered-sessions/config` (`discovered-sessions.ts:706`) | reads | **RELOCATE → Settings** | Conversations/enrichment config; Settings domain. |
| `PUT /api/discovered-sessions/config` (`discovered-sessions.ts:725`) | writes | **RELOCATE → Settings** | Same. |
| `POST /api/discovered-sessions/test-connection` (`discovered-sessions.ts:751`) | writes | **RELOCATE → Settings** | Provider connectivity probe; not transcript state. |
| `POST /api/discovered-sessions/scan` (`discovered-sessions.ts:480`) | writes (cache) | **`TranscriptsResolver.rebuild(dirs?)`** | The scan that rebuilds the whole index from JSONL (read-only over the sacred files). Cache-maintenance, not a source write. |
| `POST /api/discovered-sessions/enrich` (`discovered-sessions.ts:571`) | writes (cache) | **`TranscriptsResolver.enrich(...)`** (opt-in, costs LLM $) | LLM summaries/tags — a search **nicety**, not load-bearing (audit Q2). Lazy/opt-in, never blocking. |
| `POST /api/discovered-sessions/:id/enrich` (`discovered-sessions.ts:400`) | writes (cache) | **`TranscriptsResolver.enrich(id)`** | Per-row enrich; same. |
| `POST /api/discovered-sessions/embed` (`discovered-sessions.ts:657`) | writes (cache) | **`TranscriptsResolver.embed(...)`** (opt-in, costs $) | Embeddings for semantic search (audit §2d). Regenerable. |

## 1C. CLI verbs (`pan ...`)

| Current verb | r/w | New door | Reason |
|---|---|---|---|
| `pan conversations scan [dirs]` (`conversations/index.ts:28`) | writes (cache) | **`TranscriptsResolver.rebuild`** | Same engine as the HTTP scan. |
| `pan conversations search [query]` (`conversations/index.ts:45`) | reads | **`TranscriptsResolver.search`** | FTS over the index. |
| `pan conversations list` (`conversations/index.ts:74`) | reads | **`TranscriptsResolver.list`** | Index list with filters. |
| `pan conversations show <id>` (`conversations/index.ts:88`) | reads | **`TranscriptsResolver.get`** | Single index row. |
| `pan conversations current` (`conversations/index.ts:103`) | reads | **`ConversationsResolver.getCurrent()`** | The conversation you are running inside (deterministic, no scan). |
| `pan conversations jsonl <conv-id>` (`conversations/index.ts:95`) | reads | **`TranscriptsResolver.resolveFile(conv)`** | Prints the backing-file path. **Today uses the claude-only `resolveConversationTranscript` (surface #4, backing-files §2.4)** — folds into the one harness-aware resolver so it can't route a pi/codex conv down a claude path. |
| `pan conversations cost` (`conversations/index.ts:111`) | reads | **RELOCATE → Cost** | Estimated-cost rollup; Cost domain. |
| `pan conversations enrich [ids]` (`conversations/index.ts:134`) | writes (cache) | **`TranscriptsResolver.enrich`** | Opt-in LLM enrichment. |
| `pan conversations embed [ids]` (`conversations/index.ts:121`) | writes (cache) | **`TranscriptsResolver.embed`** | Opt-in embeddings. |
| `pan conversations format` (`conversations/index.ts`) | reads | **`TranscriptsResolver.serialize(conv)`** | Serializes the transcript to text (the adapter's `serializeTranscript`). |
| `pan handoff [conv] [focus...]` (`index.ts:435`, `handoffCommand`) | writes | **`ConversationWriter.handoff(source, target, doc)`** (+ RELOCATE spawn) | Authors a handoff doc (to `~/.panopticon/handoffs/`), **creates a NEW conversation + new backing file** (fork primitive), records the lineage edge (`recordConversationHandoff`, `conversations-db.ts:739`). Spawn relocates. |
| `pan unarchive-conversation <query>` (`index.ts:446`) | writes | **`ConversationWriter.unarchive`** | Restore by name/title match. |

## 1D. RPC methods (`packages/contracts/src/rpc.ts`)

| Current RPC method | r/w | New door | Reason |
|---|---|---|---|
| `pan.scanConversations` (`rpc.ts:24`) | writes (cache) | **`TranscriptsResolver.rebuild`** via RPC | Same engine; RPC delegates to the same resolver (HTTP & RPC cannot diverge, CONVENTIONS §8). |
| `pan.searchConversations` (`rpc.ts:25`) | reads | **`TranscriptsResolver.search`** | FTS. |
| `pan.listDiscoveredSessions` (`rpc.ts:26`) | reads | **`TranscriptsResolver.list`** | Index list. |
| `pan.getDiscoveredSession` (`rpc.ts:27`) | reads | **`TranscriptsResolver.get`** | Single index row. |
| `pan.enrichSessions` (`rpc.ts:28`) | writes (cache) | **`TranscriptsResolver.enrich`** | Opt-in. |
| `pan.embedSessions` (`rpc.ts:29`) | writes (cache) | **`TranscriptsResolver.embed`** | Opt-in. |
| `pan.getConversationCost` (`rpc.ts:30`) | reads | **RELOCATE → Cost** | Cost domain. |
| `pan.getConversationCostByWorkspace` (`rpc.ts:31`) | reads | **RELOCATE → Cost** | Cost domain. |
| `pan.getConversationStats` (`rpc.ts:32`) | reads | **`TranscriptsResolver.stats`** | Index rollup. |
| `pan.subscribeConversationMessages` (`rpc.ts:39`) | reads (stream) | **`TranscriptsResolver.watch(subject)`** (stream) | Live JSONL tail across harness shapes (`ws-rpc.ts:690-710`: claude/pi/codex dispatch). Also streams **bare `agent-`/`planning-` ids that have NO conversations row** (`ws-rpc.ts:701`) — so `watch` takes a `TranscriptSubject` (conv **or** agent id), not only a `Conversation`. Read-only over the sacred file. |
| `pan.subscribeProjectSessionTree` (`rpc.ts:40`) | reads (stream) | **aggregate → recomposed** (Conversations + Agents presence) | The session tree spans both conversations and agents; recompose, don't fold into one. |

## 1E. Rollup of the collapse (the §1D-analog)

| Surface | Current sites | New home |
|---|---|---|
| HTTP `conversations.ts` | **30** routes | **3 resolver reads** (`get`, `list`, `getCurrent`) + Transcripts reads (`parse`/`resolveFile`) + **~8 writer verbs**; the runtime/delivery cluster (stop/resume/restart-all/message/delivery-method/codex-approval/plan-action/upload/delete-image/pending-input) **relocates** to ConversationRuntime; diffs **relocate** to Diffs |
| HTTP `discovered-sessions.ts` | **12** routes | **TranscriptsResolver** (`list`/`get`/`stats`/`search`/`rebuild`/`enrich`/`embed`); config/test-connection **relocate** to Settings; cost **relocates** to Cost |
| CLI verbs | **13** (`conversations/*` + handoff + unarchive) | same small door set; cost **relocates**, enrich/embed are opt-in cache ops |
| RPC methods | **11** conversation/transcript methods | Transcripts resolver methods + 1 aggregate (session tree); cost methods **relocate** |
| **Conversation-metadata write sites** | the ~24 `conversations-db.ts` writer fns (`conversations-db.ts:465-846`) | **~8 `ConversationWriter` verbs** — the transient/CACHE writers (`updateForkStatus`, `updateLastAttached`, `setForkRequest`, `updateConversationCost`, `updateConversationDeliveryMethod`, `updateSpawnError`, `markConversation*`) **drop to cache-internal** (not door verbs — their fields are CACHE, audit) |
| Backing-file resolvers | **3 harness-aware + 1 claude-only** (backing-files §2.4) | **1 harness-aware `TranscriptsResolver.resolveFile`** — surface #4's claude-only `resolveConversationTranscript` folds in |
| Search systems | **2 independent** (session-level FTS/embeddings + chunk-level palette over a SEPARATE DB) | TranscriptsResolver owns the session-level one; the chunk-level palette store is **out of scope** (separate DB) — flagged as its own remodel item (§1F) |

**DELETED outright** (the audit's DEAD set, not door-mapped):
`conversations.session_file` (`@deprecated` PAN-451, superseded by
`claude_session_id`), `conversations.total_cost` / `total_tokens` (triplicated
cost — derive from `cost_events`/JSONL, audit Q3), `title_seed` (regenerable),
and the transient `fork_*` / `spawn_error` cluster as **stored door fields** (they
remain cache-internal, never resolver/writer surface). These never become a
`ConversationsResolver`/`Writer` member.

**Relocated, not lost** (the no-loss integrity column): stop/resume/restart-all/
message/delivery-method/codex-approval/plan-action/upload-image/delete-image/
pending-input → **ConversationRuntime**; diffs → **Diffs**; cost (4 surfaces) →
**Cost**; discovered-sessions config/test-connection → **Settings**; session-tree
stream → **recomposed** (Conversations + Agents).

## 1F. What did NOT fit cleanly — the genuine residue

1. **The PAN-1937 export is unbuilt → metadata is currently lost on wipe.** The
   `ConversationWriter`'s source of truth is the DB row itself; the only durable
   home is the not-yet-built export (backing-files §4.2). **This is the one place
   the domain is *not* wipe-safe.** The remodel must build the export (the
   recommended target: a git `.pan/records`-style per-conversation artifact, so
   metadata travels across machines) before `overdeck.db` can be called fully
   disposable. **Required for parity-of-durability, not optional.**

2. **The one in-place backing-file mutation — `conversation-compaction.ts:164`.**
   `compactConversationNative` → `appendFile(sessionFile, …)` appends a
   `compact_boundary` + `isCompactSummary` entry **into the live claude JSONL**
   (backing-files §3.1). It is claude-only-gated and append-only, but it still
   writes a file Panopticon does not own — the **lone violator** of the sacred
   invariant. **It converts to the fork primitive** (`ConversationWriter.forkNewFile`):
   write a NEW session file seeded from the compact boundary (exactly PAN-1781's
   "fresh-session seeding, never boundary-JSON tweaks"), register a
   `conversation_files` pointer, leave the old file intact. After conversion, **no
   code path writes into an existing transcript** — the invariant becomes total
   and mechanically enforceable (TranscriptsResolver has no file-write method at
   all).

3. **A conversation backs to multiple files; today only the current one is
   surfaced.** A harness switch creates a new file and updates the pointer, but
   the resolver returns only the current-harness file (backing-files §5.1). The
   `conversation_files` table models the full set; **the remodel's
   `TranscriptsResolver.resolveFiles(conv)` must return ALL pointer rows**, not
   just the newest — so a pre-switch transcript stays reachable.

4. **Two independent transcript search systems.** Session-level FTS5 +
   embeddings over `transcripts` (this domain) vs the chunk-level command-palette
   search over a **separate** embeddings DB (`conversation-embeddings-db.ts`,
   audit Surprise #2). The separate DB is **out of scope** for these tables;
   consolidating the two is flagged as its own remodel item, not resolved here.

5. **Favorites is polymorphic but only half-wired.** Schema allows
   `type ∈ {'conversation','project'}` (schema 534); live code only ever writes
   `'conversation'` (`FavoriteType = 'conversation'`, `conversations-db.ts:824`).
   The writer keeps the polymorphic `(type, item_id)` door (the `'project'` arm
   is a designed-for affordance the export contract already anticipates), but no
   current surface writes `'project'` — so it ships as capability, not behavior
   change.

Everything else either is a metadata write (a `ConversationWriter` verb), a
transcript read/rebuild (a `TranscriptsResolver` method), relocates to a sibling
surface, or is deleted DEAD. Nothing real is lost.

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom (CONVENTIONS): `Context.Service` (never
`Effect.Service`), `effect/unstable/*` imports, Drizzle behind the `Db` service,
`Schema.Literals([...])` taking arrays, `Schema.TaggedErrorClass`. **The writer
ordering diverges from Issues by design (headline finding): the DB row IS the
source of truth, so there is no `records.*` mirror — the row write is the commit
point.** Every method below traces to a Part-1 row.

## 2.1 Entities & errors — `Schema`

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq, and } from "drizzle-orm"
import { conversations, conversationFiles, favorites, transcripts } from "../overdeck-schema"
import { Db, EventBus } from "./infra"          // NOTE: no `Records` — Conversations has no git source

// ── Branded ids ───────────────────────────────────────────────────────────
export const ConversationId   = Schema.String.pipe(Schema.brand("ConversationId"))
export type  ConversationId   = typeof ConversationId.Type
// The operator/launcher-assigned name is the durable key (favorites.item_id = name;
// lineage edges resolve by name — audit). A second brand keeps it un-swappable with id.
export const ConversationName = Schema.String.pipe(Schema.brand("ConversationName"))
export type  ConversationName = typeof ConversationName.Type

export const Harness = Schema.Literals(["claude-code", "pi", "codex", "kimi"])
export type  Harness = typeof Harness.Type

export const TitleSource = Schema.Literals(["manual", "auto", "ai", "default"])

// favorites is polymorphic (schema 534) — both arms modeled; only 'conversation'
// is wired today (residue §1F.5).
export const FavoriteType = Schema.Literals(["conversation", "project"])

// ── A backing-file pointer (the conversation_files row) ─────────────────────
export const BackingFile = Schema.Struct({
  harness: Harness,
  locator: Schema.String,        // claude: session UUID · pi/codex: agent-dir locator
  createdAt: Schema.Date,
})
export type BackingFile = typeof BackingFile.Type

// ── The Conversation entity — DB-row decoder AND API success type ───────────
// ONLY the irreplaceable metadata (audit "export target", 14 fields) + lineage.
// Derived facts (message_count/models/cost/tokens) are NOT here — they come from
// TranscriptsResolver via the controller (audit: the JOIN, not a stored copy).
export const Conversation = Schema.Struct({
  id:            ConversationId,
  name:          ConversationName,
  cwd:           Schema.String,
  issueId:       Schema.NullOr(Schema.String),    // soft pointer; nullable (schema 101)
  harness:       Schema.NullOr(Harness),
  model:         Schema.NullOr(Schema.String),
  effort:        Schema.NullOr(Schema.String),
  title:         Schema.NullOr(Schema.String),
  titleSource:   Schema.NullOr(TitleSource),
  createdAt:     Schema.Date,
  archivedAt:    Schema.NullOr(Schema.Date),
  // lineage edges (handoff / clear create NEW conversations) — resolve by name
  handoffDocPath:      Schema.NullOr(Schema.String),
  handoffTargetConvId: Schema.NullOr(ConversationId),
  clearedToConvId:     Schema.NullOr(ConversationId),
  // the pointer set — ALL backing files (residue §1F.3), not just the current one
  files:         Schema.Array(BackingFile),
})
export type Conversation = typeof Conversation.Type

export const ConversationFilter = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),      // archived_at IS NOT NULL
  issueId:  Schema.optional(Schema.String),
})
export type ConversationFilter = typeof ConversationFilter.Type

// ── The Transcript index entity — decodes a real `transcripts` row (schema 148-163) ──
// 100% CACHE; the read shape for TranscriptsResolver.get/list/stats/search.
export const Transcript = Schema.Struct({
  backingFilePath: Schema.String,                 // PK — the sacred file (read-only)
  sessionId:       Schema.NullOr(Schema.String),  // claude UUID (null for pi/codex)
  harness:         Schema.NullOr(Harness),
  workspacePath:   Schema.NullOr(Schema.String),
  messageCount:    Schema.NullOr(Schema.Number),
  models:          Schema.NullOr(Schema.Array(Schema.String)),
  tokenInput:      Schema.NullOr(Schema.Number),
  tokenOutput:     Schema.NullOr(Schema.Number),
  firstTs:         Schema.NullOr(Schema.Date),
  lastTs:          Schema.NullOr(Schema.Date),
  panIssueId:      Schema.NullOr(Schema.String),
  panAgentId:      Schema.NullOr(Schema.String),
})
export type Transcript = typeof Transcript.Type

// ── Errors — tagged, in the E channel ───────────────────────────────────────
export class ConversationNotFound extends Schema.TaggedErrorClass<ConversationNotFound>()(
  "ConversationNotFound", { name: ConversationName },
) {}
export class AlreadyArchived extends Schema.TaggedErrorClass<AlreadyArchived>()(
  "AlreadyArchived", { name: ConversationName },
) {}
export class NotArchived extends Schema.TaggedErrorClass<NotArchived>()(
  "NotArchived", { name: ConversationName },
) {}
```

## 2.2 `ConversationsResolver` — the read door (`Context.Service`)

Methods trace to Part-1 §1A reads: `get`, `list` (with `archived`/`issueId`
filters), `getCurrent`, `getHandoffDoc`. **No derived facts** — those come from
`TranscriptsResolver`; the enriched list/about views recompose at the controller.

```ts
export class ConversationsResolver extends Context.Service<ConversationsResolver, {
  readonly get:           (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound>
  readonly list:          (f: ConversationFilter)  => Effect.Effect<ReadonlyArray<Conversation>>
  readonly getCurrent:    ()                        => Effect.Effect<Conversation, ConversationNotFound>
  readonly getHandoffDoc: (name: ConversationName)  => Effect.Effect<string, ConversationNotFound>
}>()("overdeck/ConversationsResolver") {}

export const ConversationsResolverLayer = Layer.effect(ConversationsResolver, Effect.gen(function* () {
  const { q } = yield* Db
  const decode = Schema.decodeUnknown(Conversation)

  // hydrate the files[] pointer set from conversation_files (residue §1F.3 — ALL rows)
  const withFiles = (row: unknown, id: string) => Effect.gen(function* () {
    const files = yield* Effect.sync(() =>
      q.select().from(conversationFiles).where(eq(conversationFiles.conversationId, id)).all())
    return yield* decode({ ...(row as object), files })
  })

  const get = (name: ConversationName) => Effect.gen(function* () {
    const row = yield* Effect.sync(() =>
      q.select().from(conversations).where(eq(conversations.name, name)).get())
    return row
      ? yield* withFiles(row, (row as { id: string }).id)
      : yield* Effect.fail(new ConversationNotFound({ name }))
  })

  const list = (f: ConversationFilter) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() => {
      let sel = q.select().from(conversations)
      // archived flag maps to archived_at NULL/NOT NULL; default list excludes archived
      return f.issueId
        ? sel.where(eq(conversations.issueId, f.issueId)).all()
        : sel.all()
    })
    return yield* Effect.forEach(rows, (r) => withFiles(r, (r as { id: string }).id))
  })

  // deterministic "conversation I'm running inside" — keyed off the launcher env,
  // no scan (pan conversations current). Implementation reads the ambient conv name.
  const getCurrent = () => Effect.gen(function* () { /* resolve ambient name → get */ })

  const getHandoffDoc = (name: ConversationName) => Effect.gen(function* () {
    const conv = yield* get(name)
    if (!conv.handoffDocPath) return yield* Effect.fail(new ConversationNotFound({ name }))
    return yield* Effect.promise(() => readFile(conv.handoffDocPath!, "utf-8"))
  })

  return ConversationsResolver.of({ get, list, getCurrent, getHandoffDoc })
}))
```

## 2.3 `TranscriptsResolver` — the shared read-only service (`Context.Service`)

Not a domain (no durable source, no pane). It **reads** sacred backing files
across harness shapes and **rebuilds its own disposable index** (`transcripts`,
was `discovered_sessions`). It has **no method that writes a backing file** —
that is how "read-only toward the sacred files" becomes mechanically true.

It **formalizes the existing `getTranscriptAdapter(harness)`**
(`src/lib/conversations/transcript-adapter.ts:259` — a harness-keyed adapter with
`resolveSessionFile` / `serializeTranscript` / `compactSummary`) into one entry
point, and **folds in** the claude-only `resolveConversationTranscript` (surface
#4) so no caller can route a pi/codex conversation down a claude path.

```ts
// the harness-aware parse result — uniform regardless of on-disk shape
export const ParsedTranscript = Schema.Struct({
  messages: Schema.Array(/* ChatMessage */ Schema.Unknown),
  messageCount: Schema.Number,
  models: Schema.Array(Schema.String),
  firstTs: Schema.NullOr(Schema.Date),
  lastTs:  Schema.NullOr(Schema.Date),
})

// a backing-file locator — accepts a Conversation OR a bare agent/planning id
// (subscribeConversationMessages streams agent transcripts with NO conversations
// row, ws-rpc.ts:701). The resolver dispatches on whichever it gets.
export const TranscriptSubject = Schema.Union([Conversation, ConversationName /* = agent/planning id */])
export type TranscriptSubject = typeof TranscriptSubject.Type

export class TranscriptsResolver extends Context.Service<TranscriptsResolver, {
  // ── resolve / parse the SACRED files (read-only) ──
  // ALL backing files for a conversation (residue §1F.3), harness-aware:
  readonly resolveFiles: (subject: TranscriptSubject) => Effect.Effect<ReadonlyArray<string>>
  // the canonical transcript read (GET …/messages) — dispatches claude/pi/codex:
  readonly parse:        (subject: TranscriptSubject) => Effect.Effect<ParsedTranscript>
  readonly serialize:    (subject: TranscriptSubject) => Effect.Effect<string>          // pan conversations format
  // subscribeConversationMessages — also serves bare agent-/planning- ids (no conv row):
  readonly watch:        (subject: TranscriptSubject) => Stream.Stream<ParsedTranscript>
  // ── the disposable INDEX (transcripts table) — reads, decoded to Transcript ──
  readonly get:    (key: string)              => Effect.Effect<Transcript>
  readonly list:   (f: ConversationFilter)    => Effect.Effect<ReadonlyArray<Transcript>>
  readonly stats:  ()                         => Effect.Effect<{ count: number; managed: number }>
  readonly search: (query: string)            => Effect.Effect<ReadonlyArray<Transcript>>  // FTS5
  // ── cache-maintenance (rebuild the index from JSONL; NEVER writes a JSONL) ──
  readonly rebuild: (dirs?: ReadonlyArray<string>) => Effect.Effect<{ scanned: number }>   // the scan
  readonly enrich:  (ids?: ReadonlyArray<string>)  => Effect.Effect<{ enriched: number }>  // opt-in, LLM $
  readonly embed:   (ids?: ReadonlyArray<string>)  => Effect.Effect<{ embedded: number }>  // opt-in, $
}>()("overdeck/TranscriptsResolver") {}
```

> **Why no `TranscriptWriter`.** There is no durable source for the index to
> mirror to (CONVENTIONS §5 rule 2: pure-cache domains have no source-first step),
> and — critically — there must be **no** method anywhere that writes a backing
> file. `rebuild`/`enrich`/`embed` are cache-maintenance on the `transcripts`
> table; they read JSONL and write only the index. Folding them into the resolver
> (rather than a writer) keeps the "Transcripts never writes a sacred file"
> invariant a property of the type surface, not a convention.

## 2.4 `ConversationWriter` — the write door (`Context.Service`)

Verbs derived from Part-1 §1A/§1C writes. **Writes ONLY the DB + creates NEW
backing files via the fork primitive — never mutates an existing one.** No
`records.*` step (headline finding): the row write is the commit point.

```ts
export class ConversationWriter extends Context.Service<ConversationWriter, {
  // create the metadata row + a fresh claude_session_id + a conversation_files row.
  // (the tmux spawn is ConversationRuntime, not here — Part-1 split.)
  readonly create: (opts: {
    name: ConversationName; cwd: string; model?: string; effort?: string;
    harness?: Harness; issueId?: string; title?: string;
  }) => Effect.Effect<Conversation>

  // archive (also the DELETE alias) / unarchive — toggles archived_at.
  readonly archive:   (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | AlreadyArchived>
  readonly unarchive: (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | NotArchived>

  // favorites — polymorphic door (only 'conversation' wired today, §1F.5).
  readonly setFavorite:   (type: "conversation" | "project", itemId: string) => Effect.Effect<void>
  readonly unsetFavorite: (type: "conversation" | "project", itemId: string) => Effect.Effect<void>

  // title (PATCH + /retitle) — title_source distinguishes manual (durable) from auto/ai.
  readonly retitle:   (name: ConversationName, title: string, source: "manual" | "auto" | "ai") =>
    Effect.Effect<Conversation, ConversationNotFound>

  // requested spawn params (model/harness) — a HARNESS change ALSO forks a new file.
  readonly setModel:   (name: ConversationName, model: string)   => Effect.Effect<Conversation, ConversationNotFound>
  readonly setHarness: (name: ConversationName, harness: Harness) => Effect.Effect<Conversation, ConversationNotFound>

  // ── the four file-creating verbs (the task's enumerated set) ──
  // EACH is a thin public delegate to the ONE private fork mechanism below;
  // they differ only in lineage edge + whether a NEW conversation is spawned.
  // handoff — author a doc, spawn a NEW conv + file, set handoff_target_conv_id:
  readonly handoff: (source: ConversationName, target: ConversationName, docPath: string) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>
  // clear — /clear lineage: spawn a sibling conv + file, set cleared_to_conv_id
  // (the conversation-lifecycle.ts:299 write):
  readonly clear: (source: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>
  // summaryFork — summary/plain fork: new conv + file seeded from a summary:
  readonly summaryFork: (source: ConversationName, opts: { mode: "summary" | "plain"; model?: string }) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>
  // compact — convert conversation-compaction.ts:164's in-place append to a fork:
  // seed a NEW file from the compact boundary, retarget the SAME conversation:
  readonly compact: (name: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>
}>()("overdeck/ConversationWriter") {}

// ── the ONE private fork mechanism — the ONLY way a new backing file is made ──
// NOT a public verb; the four verbs above delegate to it. Creates a fresh UUID
// session file (summary-fork.ts / session-format-converter.ts), inserts a
// conversation_files pointer, optionally creates a NEW conversation, records the
// lineage edge. NEVER opens an existing file for write. (A harness switch from
// setHarness also routes through it.)
type ForkKind = "handoff" | "clear" | "summary" | "plain" | "harness-switch" | "compaction"

export const ConversationWriterLayer = Layer.effect(ConversationWriter, Effect.gen(function* () {
  const { q } = yield* Db                         // the conversations/favorites/conversation_files tables ONLY
  const bus   = yield* EventBus
  const now   = () => new Date()
  // NOTE: NO `records` dependency. The DB row IS the source of truth here.

  const archive = (name: ConversationName) => Effect.gen(function* () {
    const resolver = yield* ConversationsResolver
    const conv = yield* resolver.get(name)                       // 404s if unknown
    if (conv.archivedAt) return yield* Effect.fail(new AlreadyArchived({ name }))

    // 1. THE COMMIT POINT — the DB row write (no git mirror; headline finding).
    //    archived_at is SOURCE-OF-TRUTH and lives nowhere else (audit).
    yield* Effect.sync(() => q.transaction((tx) => {
      tx.update(conversations).set({ archivedAt: now() }).where(eq(conversations.name, name)).run()
      tx.delete(favorites).where(and(eq(favorites.type, "conversation"), eq(favorites.itemId, name))).run()
    }))
    // (runtime stop + attachment cleanup are ConversationRuntime, fired by the controller)

    // 2. ANNOUNCE.
    yield* bus.emit({ type: "conversation.archived", payload: { name } })
    return { ...conv, archivedAt: now() }
  })

  const setFavorite = (type: "conversation" | "project", itemId: string) => Effect.gen(function* () {
    yield* Effect.sync(() =>
      q.insert(favorites).values({ type, itemId, createdAt: now() }).onConflictDoNothing().run())
    yield* bus.emit({ type: "conversation.favorited", payload: { type, itemId } })
  })

  // forkNewFile — the PRIVATE sacred-invariant heart. Reads the source file
  // READ-ONLY, writes a FRESH file, inserts the pointer, records lineage. The
  // four public verbs (handoff/clear/summaryFork/compact) delegate here; this is
  // also where the lone in-place compaction append (§1F.2) is converted to a fork.
  const forkNewFile = (opts: {
    source: ConversationName; kind: ForkKind;
    newHarness?: Harness; docPath?: string;
  }) => Effect.gen(function* () {
    const resolver = yield* ConversationsResolver
    const src = yield* resolver.get(opts.source)
    // 1. create a fresh UUID backing file (summary-fork / session-format-converter).
    //    The source is opened READ-ONLY; nothing is appended to it.
    const backingFile = yield* Effect.promise(() => createForkedBackingFile(src, opts))
    // 2. (handoff/clear/summary spawn a NEW conversation; harness-switch/compaction
    //    keep the same conversation and add a pointer + retarget.)
    const newConv = yield* /* createConversation(...) OR reuse src */ Effect.succeed(src)
    yield* Effect.sync(() =>
      q.insert(conversationFiles).values({
        conversationId: newConv.id,
        harness: opts.newHarness ?? src.harness ?? "claude-code",
        locator: backingFile,
        createdAt: now(),
      }).run())
    // 3. record the lineage edge on the SOURCE (handoff_target / cleared_to).
    if (opts.kind === "handoff" || opts.kind === "clear") {
      yield* Effect.sync(() => q.update(conversations).set(
        opts.kind === "handoff"
          ? { handoffTargetConvId: newConv.id, handoffDocPath: opts.docPath ?? null }
          : { clearedToConvId: newConv.id },
      ).where(eq(conversations.name, opts.source)).run())
    }
    yield* bus.emit({ type: "conversation.forked", payload: { source: opts.source, kind: opts.kind } })
    return { conversation: newConv, backingFile }
  })

  // the four PUBLIC file-creating verbs — thin delegates to forkNewFile.
  const handoff     = (source: ConversationName, target: ConversationName, docPath: string) =>
    forkNewFile({ source, kind: "handoff", docPath })
  const clear       = (source: ConversationName) => forkNewFile({ source, kind: "clear" })
  const summaryFork = (source: ConversationName, opts: { mode: "summary" | "plain"; model?: string }) =>
    forkNewFile({ source, kind: opts.mode })
  const compact     = (name: ConversationName)   => forkNewFile({ source: name, kind: "compaction" })

  // create / unarchive / retitle / setModel / setHarness / unsetFavorite follow
  // the same DB-row-is-the-commit-point pattern (omitted for brevity). setHarness
  // also calls forkNewFile({ kind: "harness-switch" }) when the harness changes.
  return ConversationWriter.of({ create, archive, unarchive, setFavorite, unsetFavorite,
                                 retitle, setModel, setHarness,
                                 handoff, clear, summaryFork, compact })
}))
```

> **Why `ConversationWriter`'s `R` is clean (and different from Issues').** Its
> dependencies are `Db` (the `conversations`/`favorites`/`conversation_files`
> tables only), `EventBus`, and `ConversationsResolver` — **and explicitly NOT
> `Records`**. It cannot mirror to git because there is no git source for
> conversation metadata; the DB row is the truth. It also has **no file-write
> primitive other than `forkNewFile`**, which creates fresh files — so it
> physically cannot mutate an existing backing transcript. That is the sacred
> invariant enforced by the surface, not a comment.

## 2.5 `ConversationsApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the
services; the handler's `R` is `ConversationsResolver | TranscriptsResolver |
ConversationWriter`, never `Db`. The enriched list/about views recompose metadata
+ Transcripts facts at the handler (audit: the JOIN, done in the controller).

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const ConversationsApi = HttpApiGroup.make("conversations")
  // ── reads ──
  .add(HttpApiEndpoint.get("list", "/conversations", {
    urlParams: ConversationFilter,
    success:   Schema.Array(Conversation),      // controller recomposes + Transcripts facts
  }))
  .add(HttpApiEndpoint.get("get", "/conversations/:name", {
    params:  Schema.Struct({ name: ConversationName }),
    success: Conversation, error: ConversationNotFound,
  }))
  .add(HttpApiEndpoint.get("messages", "/conversations/:name/messages", {   // → TranscriptsResolver.parse
    params:  Schema.Struct({ name: ConversationName }),
    success: ParsedTranscript, error: ConversationNotFound,
  }))
  .add(HttpApiEndpoint.get("handoffDoc", "/conversations/:name/handoff-doc", {
    params:  Schema.Struct({ name: ConversationName }),
    success: Schema.String, error: ConversationNotFound,
  }))
  // ── writes (metadata + fork) ──
  .add(HttpApiEndpoint.post("create", "/conversations", {
    payload: Schema.Struct({
      message: Schema.optional(Schema.String), model: Schema.optional(Schema.String),
      effort: Schema.optional(Schema.String), harness: Schema.optional(Harness),
      issueId: Schema.optional(Schema.String), projectKey: Schema.optional(Schema.String),
    }),
    success: Conversation,
  }))
  .add(HttpApiEndpoint.post("archive", "/conversations/:name/archive", {
    params: Schema.Struct({ name: ConversationName }),
    success: Conversation, error: Schema.Union([ConversationNotFound, AlreadyArchived]),
  }))
  // DELETE /conversations/:name is the verbatim alias → same archive handler (§1A fold)
  .add(HttpApiEndpoint.del("delete", "/conversations/:name", {
    params: Schema.Struct({ name: ConversationName }),
    success: Conversation, error: Schema.Union([ConversationNotFound, AlreadyArchived]),
  }))
  .add(HttpApiEndpoint.post("unarchive", "/conversations/:name/unarchive", {
    params: Schema.Struct({ name: ConversationName }),
    success: Conversation, error: Schema.Union([ConversationNotFound, NotArchived]),
  }))
  .add(HttpApiEndpoint.post("favorite", "/conversations/:name/favorite", {
    params: Schema.Struct({ name: ConversationName }), success: Schema.Void,
  }))
  .add(HttpApiEndpoint.del("unfavorite", "/conversations/:name/favorite", {
    params: Schema.Struct({ name: ConversationName }), success: Schema.Void,
  }))
  .add(HttpApiEndpoint.patch("retitle", "/conversations/:name", {
    params: Schema.Struct({ name: ConversationName }),
    payload: Schema.Struct({ title: Schema.String }),
    success: Conversation, error: ConversationNotFound,
  }))
  .add(HttpApiEndpoint.post("summaryFork", "/conversations/:name/summary-fork", {
    params: Schema.Struct({ name: ConversationName }),
    payload: Schema.Struct({
      forkMode: Schema.optional(Schema.Literals(["summary", "plain", "handoff"])),
      model: Schema.optional(Schema.String), cwd: Schema.optional(Schema.String),
      focus: Schema.optional(Schema.String),
    }),
    success: Conversation, error: ConversationNotFound,
  }))
  // switch-model: setModel/setHarness (+ forkNewFile on harness change); respawn is Runtime.
  .add(HttpApiEndpoint.post("switchModel", "/conversations/:name/switch-model", {
    params: Schema.Struct({ name: ConversationName }),
    payload: Schema.Struct({ model: Schema.optional(Schema.String), harness: Schema.optional(Harness) }),
    success: Conversation, error: ConversationNotFound,
  }))

export const OverdeckApi = HttpApi.make("overdeck")
  .add(ConversationsApi) /* .add(IssuesApi).add(AgentsApi) … */

// handlers: pure delegation. R = ConversationsResolver | TranscriptsResolver | ConversationWriter — never Db.
export const ConversationsApiLive = HttpApiBuilder.group(OverdeckApi, "conversations", (h) =>
  h.handle("list",       ({ urlParams }) => recomposeList(urlParams))   // resolver + Transcripts facts
   .handle("get",        ({ path })      => ConversationsResolver.get(path.name))
   .handle("messages",   ({ path })      => ConversationsResolver.get(path.name).pipe(Effect.flatMap(TranscriptsResolver.parse)))
   .handle("handoffDoc", ({ path })      => ConversationsResolver.getHandoffDoc(path.name))
   .handle("create",     ({ payload })   => ConversationWriter.create(payload))   // + Runtime.spawn fired after
   .handle("archive",    ({ path })      => ConversationWriter.archive(path.name))
   .handle("delete",     ({ path })      => ConversationWriter.archive(path.name).pipe(  // §1A fold: idempotent alias
       Effect.catchTag("AlreadyArchived", () => ConversationsResolver.get(path.name))))   // swallow → 200, matches DELETE today
   .handle("unarchive",  ({ path })      => ConversationWriter.unarchive(path.name))
   .handle("favorite",   ({ path })      => ConversationWriter.setFavorite("conversation", path.name))
   .handle("unfavorite", ({ path })      => ConversationWriter.unsetFavorite("conversation", path.name))
   .handle("retitle",    ({ path, payload }) => ConversationWriter.retitle(path.name, payload.title, "manual"))
   .handle("summaryFork",({ path, payload }) => ConversationWriter.summaryFork(path.name, { mode: payload.forkMode === "plain" ? "plain" : "summary", model: payload.model }))
   .handle("switchModel",({ path, payload }) => /* setModel/setHarness (+ forkNewFile if harness changed) */ ConversationWriter.setModel(path.name, payload.model!)))
```

The runtime/delivery routes (stop/resume/restart-all/message/delivery-method/
codex-approval/plan-action/upload-image/delete-image/pending-input) and the
diffs routes are **not** on `ConversationsApi` — they live on the
**ConversationRuntime** and **Diffs** controllers (§1A relocations). The
discovered-sessions routes live on a **TranscriptsApi** that delegates to
`TranscriptsResolver`.

## 2.6 Layer wiring

```ts
const ConversationsDomainLayer = Layer.mergeAll(
  ConversationsResolverLayer,
  ConversationWriterLayer,
  TranscriptsResolverLayer,            // shared — also provided to the Agents domain
).pipe(
  Layer.provide(DbLive),               // the ONLY place these tables' handle is provided
  Layer.provide(EventBusLive),
  // NOTE: NO RecordsLive here — Conversations has no git source (headline finding).
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(ConversationsApiLive),
  Layer.provide(ConversationsDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge** (CONVENTIONS §6).
Because no handler's `R` leaks `Db`, no controller reads or writes the cache
directly; because `ConversationWriter` has no `Records` and no backing-file write
primitive other than `forkNewFile`, the sacred-file invariant holds at the type
level.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `ConversationsResolver.get` | §1A `GET /api/conversations/:id` |
| `ConversationsResolver.list` | §1A `GET /api/conversations`, `/archived` (metadata half of the enriched list) |
| `ConversationsResolver.getCurrent` | §1C `pan conversations current` |
| `ConversationsResolver.getHandoffDoc` | §1A `GET /api/conversations/:name/handoff-doc` |
| `TranscriptsResolver.parse` / `resolveFiles` / `serialize` / `watch` | §1A `/messages`, `/message-locator`; §1C `jsonl`, `format`; §1D `subscribeConversationMessages` |
| `TranscriptsResolver.list`/`get`/`stats`/`search` | §1B + §1C + §1D discovered-sessions reads |
| `TranscriptsResolver.rebuild`/`enrich`/`embed` | §1B scan/enrich/embed; §1C; §1D `scanConversations`/`enrichSessions`/`embedSessions` |
| `ConversationWriter.create` | §1A `POST /api/conversations` |
| `ConversationWriter.archive` (+ DELETE alias) | §1A `POST …/archive`, `DELETE …/:name` |
| `ConversationWriter.unarchive` | §1A `POST …/unarchive`; §1C `pan unarchive-conversation` |
| `ConversationWriter.setFavorite` / `unsetFavorite` | §1A `POST`/`DELETE …/favorite` |
| `ConversationWriter.retitle` | §1A `PATCH …/:name`, `POST …/retitle` |
| `ConversationWriter.setModel` / `setHarness` | §1A `POST …/switch-model` (harness change → `forkNewFile` via the private mechanism) |
| `ConversationWriter.summaryFork` | §1A `POST …/summary-fork` |
| `ConversationWriter.handoff` | §1C `pan handoff` |
| `ConversationWriter.clear` | the `/clear` lineage write (`conversation-lifecycle.ts:299`) |
| `ConversationWriter.compact` | **the converted `conversation-compaction.ts:164`** (in-place append → fork) |
| relocated / deleted | §1E rollup — runtime/delivery → ConversationRuntime; diffs → Diffs; cost → Cost; config → Settings; DEAD set deleted; none map to a Conversations member by design |

No `ConversationsResolver`/`ConversationWriter` method reads or writes a column
outside the locked `conversations` / `conversation_files` / `favorites` tables;
no `TranscriptsResolver` method writes a sacred backing file; no endpoint is
invented; nothing real from the current surface is lost.
