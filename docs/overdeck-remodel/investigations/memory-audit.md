# Overdeck Remodel — Memory Domain Field Audit

**Goal:** radical complexity reduction on a fresh EMPTY DB. No backward compat,
no migration. Keep ONLY fields we genuinely NEED ("NEED, not nice-to-have").
Classify every field as **SOURCE-OF-TRUTH** (must survive a wipe; needs a
durable home), **CACHE** (rebuildable from a source of truth), or **DEAD**
(never read for a decision).

Method: every field traced through its accessor across `src/` (non-test). The
discriminator for **KEEP vs DROP** is the same as the review-state audit: *does
any read drive control flow* (`if`/`filter`/comparison), not whether the field
is "touched". The discriminator for **SOURCE-OF-TRUTH vs CACHE** is the same as
the conversations audit: *after `rm panopticon.db` (and after the source
transcript is gone), is there any path to reconstruct this value?*

**Headline counts.** Memory's footprint in `panopticon.db` is **exactly ONE
table** — `transcript_checkpoints` (14 columns, 830 live rows, 84 distinct
issues). **All 14 columns are CACHE; 11 KEEP (real dedup/lease/rate-limit
state), 3 DROP (1 never-read field + 2 timestamps with no branch).** The
*irreplaceable* Memory state — the observations themselves, status snapshots,
reset markers — lives **on disk as files** under `~/.panopticon/memory/`
(170 MB), entirely outside `panopticon.db`. A per-project FTS index
(`memory-search.db`) is 100% CACHE but has **no rebuilder** — a NEED gap.

> **The one-line verdict:** Memory contributes **zero source-of-truth** to
> `panopticon.db`. Its sole DB table is **100% disposable cache**. Every
> irreplaceable Memory artifact is already **file-resident outside the DB-wipe
> scope** — so unlike Conversations (PAN-1937), Memory needs **no DB export
> target**. The real "first-class Memory" gaps are different: (1) is
> `~/.panopticon/memory/` in the backup surface, and (2) it is per-machine /
> non-portable. And the FTS search index can be deleted but **nothing today can
> rebuild it from the JSONL** it indexes.

## Glossary

- **Observation** — one atomic memory record: an LLM-extracted summary of a
  slice of an agent transcript (`MemoryObservation`,
  `packages/contracts/src/memory.ts:22`). The unit of Memory. Stored append-only
  as a line in a per-day JSONL file.
- **The memory store** — NOT a database. It is a **file tree** on disk under
  `~/.panopticon/memory/<projectId>/<issueId>/` containing `observations/*.jsonl`
  (the records), `observations/*.md` (a human mirror), `status.json` (the current
  rolled-up status), `archive/*.json` (prior statuses), `summaries/*.md`,
  `pending/*.json` (un-rolled turns), `rag-runs/*.jsonl` (injection decision
  log), `health.json`, and `reset-markers.json`. Path layout in
  `src/lib/memory/paths.ts`.
- **`memory-search.db`** — a **separate** per-project SQLite file at
  `~/.panopticon/memory/<projectId>/memory-search.db` (NOT `panopticon.db`).
  Holds the FTS5 search index (`memory_fts`), a byte-offset lookup
  (`observation_index`), and a `reset_markers` table. Schema in
  `src/lib/memory/fts-operations.ts:55`. The read engine for injection.
- **`transcript_checkpoints`** — the ONLY Memory table in the main
  `panopticon.db`. A byte-offset cursor + claim-lease + rate-limit row per
  session. Schema in `src/lib/database/schema.ts:317`; accessors in
  `src/lib/memory/checkpoints.ts`.
- **Status rollup** — periodically the pending turns are synthesized (LLM) into a
  single `MemoryStatus` (`rollup.ts`), the durable "where this issue stands" doc.
- **Reset marker** — an operator/pipeline-authored "hide everything before this
  timestamp" record (`createResetMarker`, `cli.ts:96`). Filters stale
  observations out of search.
- **Branch-read** — a read that feeds an `if`/`filter`/comparison that changes
  behaviour. The opposite is **write-only** (set but never read) or **display**.
- **The rebuild engine** — the extraction machinery (`pipeline.ts`,
  `extract.ts`, `compress.ts`, `providers/*`, `query-expansion.ts`,
  `worker-pool.ts`). This is **compute, not state** — it produces observations
  from transcripts; it stores nothing of its own. Not field-audited here.

---

## 1. What Memory actually stores (the data model end to end)

Memory is a **transcript → observation → status** pipeline with three storage
layers. Only the **first** lives in `panopticon.db`.

### The flow

1. An agent runs; its transcript JSONL grows.
2. Two triggers feed the pipeline: the **poller** (`poller.ts`, mid-turn, every
   ~2 s while an agent is active) and the **stop-hook** (`hooks.ts` →
   `enqueueMemoryPipelineJob`, end of turn). A **reconciliation** sweep
   (`reconciliation.ts`) catches up offsets for sessions that went away.
3. `pipeline.ts:extractFromTranscriptDelta` **claims** a byte range in
   `transcript_checkpoints` (atomic lease), **compresses** the delta, sends it to
   an LLM (`extract.ts`) to produce one `MemoryObservation`, **writes** it, then
   **commits** the consumed offset back to the checkpoint.
4. `writeObservation` (`observations.ts:22`) appends the observation to the
   per-day **JSONL** (`observations/<date>.jsonl`), upserts a human-readable
   **markdown** line (`observations/<date>.md`), and indexes it into the
   per-project **`memory-search.db`** FTS (`memory_fts` + `observation_index`).
5. A `PendingTurn` is written to `pending/`; when the count crosses a threshold,
   `rollup.ts:synthesizeStatusRollup` (LLM) collapses pending turns + recent
   observations + prior statuses into a fresh `MemoryStatus`, written to
   `status.json` (old one archived to `archive/`).
6. At spawn / user-prompt time, `injection.ts:injectPromptTimeMemory` searches
   `memory-search.db` (`search.ts`) + reads `status.json`, budgets the hits, and
   injects them into the agent's context. Each decision is logged to
   `rag-runs/<date>.jsonl`.

### The three storage layers

| Layer | Where | What | In `panopticon.db`? |
| --- | --- | --- | --- |
| **A. Checkpoint cursor** | `panopticon.db` → `transcript_checkpoints` | byte-offset + claim lease + mid-turn rate-limit, per session | **YES (the only one)** |
| **B. The memory store (files)** | `~/.panopticon/memory/<proj>/<issue>/` | observations JSONL+MD, status.json, archive, summaries, pending, rag-runs, health, reset-markers.json | No |
| **C. Search index** | `~/.panopticon/memory/<proj>/memory-search.db` | `memory_fts` (FTS5), `observation_index`, `reset_markers` | No (separate SQLite file) |

**The observations are NOT in the database.** This is the single most important
structural fact and it makes the central verdict for Memory *different* from
Conversations: the irreplaceable records already sit on the filesystem.

---

## 2 + 3. `transcript_checkpoints` — field-by-field (the NEED set + the central verdict)

`transcript_checkpoints` is consumed **only** by `src/lib/memory/*` (verified:
the sole non-test consumers are `checkpoints.ts`, `checkpoint-client.ts`,
`pipeline.ts`, `poller.ts`, `reconciliation.ts`, `checkpoint-worker.ts`, plus the
`schema.ts` definition — no other domain reads it). It is one row per session,
PK `session_id`.

Single writers: `claimTranscriptRange` / `commitTranscriptRange` /
`releaseTranscriptRange` (`checkpoints.ts:70/146/215`). Single readers:
`getTranscriptCheckpoint` / `listTranscriptCheckpoints` (`checkpoints.ts:256/230`),
consumed by `pipeline.ts:safeClaim` and `poller.ts`.

| Column | Written-at | Branch-read-at | What it drives | Verdict | Class |
| --- | --- | --- | --- | --- | --- |
| `session_id` (PK) | `claimTranscriptRange` insert (`checkpoints.ts:78`) | every lookup keys on it (`getTranscriptCheckpoint` 256; poller `getCheckpoint`) | Row identity = the session whose transcript is being consumed | **KEEP** | CACHE |
| `transcript_path` | claim insert / commit (`checkpoints.ts:88,166`) | `reconciliation.ts:97` `stat(checkpoint.transcriptPath)` to detect growth; harness inference (`reconciliation.ts:122`) | Where to read the next delta from; re-fire decision | **KEEP** | CACHE |
| `last_offset` | commit (`checkpoints.ts:167` = `@consumedOffset`) | **THE dedup cursor.** `pipeline.ts:safeClaim` (`?.lastOffset ?? 0`); claim `WHERE last_offset = @expectedFromOffset` (104); `reconciliation.ts:96` `size <= lastOffset → empty`; `poller.ts:213` `fromOffset = checkpoint?.lastOffset` | Prevents re-extracting (and re-paying for) already-consumed transcript bytes | **KEEP** | CACHE (dedup guard) |
| `claim_owner` | claim (`checkpoints.ts:97`); cleared on commit/release | claim `WHERE (claim_owner IS NULL OR claim_expires_at < now)` (104); commit `WHERE claim_owner IS NOT NULL` (186); `already-claimed` check (132) | Atomic single-writer lease so poller + stop-hook + reconciliation don't double-extract the same range | **KEEP** | CACHE (ephemeral lease) |
| `claim_from` | claim (`checkpoints.ts:98`) | `releaseTranscriptRange` `WHERE claim_from = ?` (225) | Identifies the leased range to release on failure | **KEEP** | CACHE (ephemeral lease) |
| `claim_to` | claim (`checkpoints.ts:99`) | `releaseTranscriptRange` `WHERE claim_to = ?` (226) | Same — range identity for release | **KEEP** | CACHE (ephemeral lease) |
| `claim_expires_at` | claim (`now + 60_000ms`, `checkpoints.ts:100`) | claim steal predicate `claim_expires_at < @now` (104); `already-claimed` freshness (132) | 60 s lease expiry so a crashed claimant doesn't wedge the session forever | **KEEP** | CACHE (ephemeral lease) |
| `mid_turn_count_in_current_turn` | commit, `CASE` per trigger (`checkpoints.ts:174`): stop-hook→0, poller→+1 | **`poller.ts:218`** `>= maxMidTurnExtractionsPerTurn (3)` → rate-limit | Caps mid-turn (poller) extractions per turn so a chatty turn isn't extracted 50× | **KEEP** | CACHE (rate-limit breaker) |
| `last_mid_turn_at` | commit, `CASE` (`checkpoints.ts:169`): stop-hook→NULL, poller→now | **`poller.ts:219-220`** `now - lastMidTurnAt < minIntervalMs (60s)` → rate-limit | Min 60 s between mid-turn extractions for one session | **KEEP** | CACHE (rate-limit breaker) |
| `project_id` | claim insert / commit (`checkpoints.ts:83,163`) | re-fire identity in `reconciliation.ts:115` (`checkpointIdentity`); index `idx_..._issue` | Rebuilds the `MemoryIdentity` to re-fire extraction after the session went away | **KEEP** | CACHE |
| `workspace_id` | claim insert / commit | `reconciliation.ts:115` identity rebuild | Same — identity for re-fire | **KEEP** | CACHE |
| `issue_id` | claim insert / commit | `reconciliation.ts:115` identity rebuild; index | Same — identity for re-fire | **KEEP** | CACHE |
| `updated_at` | every claim/commit (`checkpoints.ts:101,183`) | `listTranscriptCheckpoints` `ORDER BY updated_at ASC` (249) — reconciliation scan order | Orders the stale-checkpoint reconciliation sweep | **KEEP** | CACHE |
| `last_observation_at` | commit (`checkpoints.ts:168` = `@now`) | **none** — written every commit, never read by any accessor anywhere in `src/` (verified: zero `.lastObservationAt` reads outside the row mapper) | nothing | **DROP** | DEAD-within-row |

### The DROP set (3 columns)

- **`last_observation_at`** — pure write-only. `commitTranscriptRange` sets it on
  every commit, `rowToCheckpoint` maps it into the interface, and **nothing ever
  reads `checkpoint.lastObservationAt`** for any decision or even display. Dead
  weight. **DROP.**
- The two claim/lease and two rate-limit timestamp fields are all genuine
  branch-reads (above) — they are NOT theatre. The only timestamp with no
  consumer is `last_observation_at`.

> No phantom columns: unlike the review-state audit (`reviewer_verdicts`,
> `lifetime_auto_requeue_count`), every column the task named for
> `transcript_checkpoints` exists. The brief's "14 cols" is exact.

### The central verdict on the table — 100% CACHE

Every `transcript_checkpoints` column is **rebuildable** and **none is
irreplaceable**:

- The cursor fields (`last_offset`, `transcript_path`, identity) re-derive on the
  next scan: `reconciliation.ts` re-`stat`s each transcript, and a wiped checkpoint
  simply re-extracts from offset 0 (the claim insert seeds `last_offset = 0`).
- The lease fields (`claim_*`) are **ephemeral by construction** — live data
  shows **1 of 830 rows** holding an active claim; they clear on every
  commit/release and expire after 60 s.
- The rate-limit fields cap a transient in-turn burst; they reset per turn.

**Wiping `transcript_checkpoints` alongside the rest of `panopticon.db` is
safe** — exactly the dedup-guard caveat the conversations audit flagged: it must
be wiped *together with* its paired store. Here the paired store is the
observations JSONL. On a **full** wipe (DB + memory files together) it is
consistent. On a **partial** wipe (DB only, files kept) the observations'
deterministic IDs save you: observation IDs are
`obs-sha256(sessionId:fromOffset)` (`pipeline.ts:deterministicObservationId`) and
`writeObservation` is idempotent on `id` (`observations.ts:findObservationByteOffset`
short-circuits an existing offset), so re-extraction from offset 0 *upserts* rather
than duplicates — but it still re-pays the LLM cost. Treat it as a dedup guard:
wipe with its store.

---

## The other layers (B and C) — where the irreplaceable state actually is

These are file-resident, outside `panopticon.db`, so the DB-wipe question does
not apply to them in the same way. But the *first-class Memory* question
("must survive a wipe / needs a durable home") does — so they are classified
here against the broader source-of-truth test.

### Layer B — the memory store (files under `~/.panopticon/memory/`)

| Artifact | Path | Writer | Reconstruct after source transcript gone? | Class |
| --- | --- | --- | --- | --- |
| **Observation JSONL** | `observations/<date>.jsonl` | `observations.ts:appendJsonl` | **No** (see central judgment below) | **SOURCE-OF-TRUTH** |
| Observation markdown | `observations/<date>.md` | `observations.ts:upsertObservationMarkdown` | Yes — derived line-for-line from the JSONL (`renderObservationMarkdownLine`) | CACHE (human mirror) |
| **`status.json`** | `status.json` | `rollup.ts:commitStatusRollup` | **No** — LLM synthesis of pending turns + observations; non-deterministic, paid | **SOURCE-OF-TRUTH** (durable "where this issue stands") |
| Status archive | `archive/*.json` | `rollup.ts:archiveStatus` (keep last 3) | It IS the prior `status.json` values; durable only as far as those were | SOURCE-OF-TRUTH (bounded history) |
| Daily summary | `summaries/<date>.md` | `cli.ts:generateDailySummary` | Yes — regenerated deterministically from the day's observations | CACHE |
| Pending turns | `pending/*.json` | `pending.ts:writePendingTurn` | Transient — consumed and `unlink`ed by the next rollup | CACHE (transient queue) |
| RAG-run log | `rag-runs/<date>.jsonl` | `injection.ts:397` + `query-expansion.ts:246` | Append-only injection-decision audit; two writers, **no reader** anywhere in `src/` | DEAD/telemetry (write-only) |
| `health.json` | `health.json` | `health.ts:updateMemoryHealth` | Counters; `pan memory doctor` reads it but it is pure operational telemetry | CACHE (telemetry) |
| **`reset-markers.json`** | `reset-markers.json` | `cli.ts:createResetMarker` | **No** — operator/pipeline-authored "hide before T" intent | **SOURCE-OF-TRUTH** (authored) |

### Layer C — `memory-search.db` (per-project FTS) — 100% CACHE, **no rebuilder**

| Table | Source | Class |
| --- | --- | --- |
| `memory_fts` (FTS5) | written incrementally by `observations.ts:indexObservation` (per observation) + `cli.ts:indexDailySummary` | CACHE |
| `observation_index` (`id → jsonl path + byte_offset`) | same incremental write | CACHE |
| `reset_markers` | duplicate of `reset-markers.json` (`cli.ts:writeResetMarkerToFtsDb`) | CACHE (the file is the truth) |

**Verdict: 100% CACHE** — every row is derived from the observation JSONL (the
source of truth) or from `reset-markers.json`. **But there is no JSONL→FTS
reindexer.** `memory_fts` is written *only* incrementally inside
`indexObservation` as each observation is created. The only `rebuild` token in
the memory subsystem — `fts-operations.ts:106` `memory_fts_rebuild` — is a
**schema migration** (adds the `branch` column by copying FTS→FTS), not a
reconstruction from JSONL. **Consequence:** delete a `memory-search.db` and the
1000s of observations already on disk become unsearchable, because nothing walks
the JSONL to re-populate the FTS. This is a NEED gap (see surprises).

---

## 4. Keying / attribution (the join keys)

Memory rows tie to the rest of the system through the **`MemoryIdentity`**
tuple (`packages/contracts/src/memory.ts:5`), stamped on every observation and
every checkpoint:

```
projectId · workspaceId · issueId · runId · sessionId · agentRole · agentHarness
```

- **`sessionId`** is the load-bearing key. It is the **PK of
  `transcript_checkpoints`** and the JOIN to the transcript: the checkpoint's
  `transcript_path` points at the JSONL whose filename *is* the session UUID
  (same one-directional conv↔transcript link the conversations audit flagged).
  It is also the `agents.session_id` an Agent resolves its transcript by, and the
  scope key for session-level reset markers.
- **`projectId` + `issueId`** is the **directory key** for the file store:
  `~/.panopticon/memory/<projectId>/<issueId>/` (`paths.ts:resolveIssueMemoryRoot`).
  `projectId` is the search-DB partition (`resolveFtsDbPath`).
- **`issueId`** is how Memory nests under the operator's issue mental model — the
  same key the dashboard issue view uses. `pan memory search --issue PAN-1234`
  scopes to one issue's dir; `--sibling` scopes to *other* issues in the same
  project (`cli.ts:readObservationScope`).
- **`runId` / `agentRole` / `agentHarness`** are denormalized onto each
  observation + the FTS row for attribution/filtering but drive no join.
- Reconciliation **rebuilds** identity from the checkpoint's stored
  `project_id`/`workspace_id`/`issue_id`/`session_id`
  (`reconciliation.ts:checkpointIdentity`) — which is *why* those columns are on
  the checkpoint at all (KEEP).

There is **no FK to `conversations` or `agents`** — Memory keys on the raw
`sessionId` string, not a row id. That is correct for the remodel: it keeps
Memory independent of which entity owns the session.

---

## 5. Read + write surface (resolver / writer shape)

### Write side — already single-writer (good)

The write path is centralized and clean:

- `observations.ts:writeObservation` is the **single observation writer** — it
  owns the append-lock, JSONL append, markdown upsert, and FTS index in one
  function.
- `pipeline.ts:extractFromTranscriptDelta` is the **single orchestrator** —
  claim → compress → extract → write → commit, with a `finally` that releases the
  lease on any failure. Both trigger paths (poller `enqueueMemoryPipelineJob`,
  stop-hook) funnel through it.
- `checkpoints.ts` is the **single checkpoint writer** (claim/commit/release).
- `rollup.ts:commitStatusRollup` is the **single status writer**.

**No action needed on the write side** — it is already one-writer-per-artifact.

### Read side — **SPLIT, needs consolidation**

There are **two `searchMemory` functions** that do not share an implementation:

| Resolver | File | Backing store | Algorithm | Powers |
| --- | --- | --- | --- | --- |
| `searchMemory` | `cli.ts:71` | reads **observation JSONL** off disk, in-memory scan | naive substring `occurrences()` count | `pan memory search` CLI |
| `searchMemory` | `search.ts:80` | reads **`memory-search.db` FTS5** | `bm25` + recency decay + tag boost + high-signal floor | `injection.ts` (spawn / prompt-time RAG) — the load-bearing one |

The CLI scans raw JSONL with a substring counter; injection uses the real ranked
FTS resolver. They can return **different results for the same query** because
they read different stores with different ranking. Reset-marker filtering is
*also* implemented twice (JSONL-side `isAfterLatestResetMarker` in `cli.ts:251`
vs SQL `reset_markers` subquery in `search.ts:114`).

**Target shape: ONE resolver — `search.ts:searchMemory` (FTS) — behind both
surfaces.** The CLI should query the same index injection does, not re-scan
JSONL. (This requires closing the FTS-reindexer gap first, since the CLI's
JSONL-scan is currently the *only* path that works when the FTS index is empty —
which, per the live data below, is often.)

Read-side status/identity resolvers are already single (`rollup.ts:readCurrentStatus`,
`getTranscriptCheckpoint`).

---

## 6. Dead / duplicate / never-read fields

1. **`transcript_checkpoints.last_observation_at`** — write-only, zero
   branch-reads, zero display reads. **DROP.**
2. **Two `searchMemory` implementations** (`cli.ts` JSONL-scan vs `search.ts`
   FTS) — duplicate read path; collapse to one (above).
3. **Reset-marker double storage** — `reset-markers.json` (the file, the truth)
   AND `memory-search.db.reset_markers` (a copy for the SQL search predicate) AND
   re-merged/deduped at read time (`cli.ts:readResetMarkers`). The DB copy is
   pure CACHE; the file is the source. The dedupe logic exists *because* of the
   duplication.
4. **`rag-runs/*.jsonl`** — append-only injection-decision log; **two writers**
   (`injection.ts:397`, `query-expansion.ts:246`) and **no reader** anywhere in
   `src/` (write-only telemetry). Not load-bearing.
5. **`MemoryObservation.runId`** denormalized onto every observation + FTS row
   but joins to nothing; attribution-only.

---

## Surprises

1. **Memory puts ZERO source-of-truth in `panopticon.db`.** Its entire DB
   footprint is one table (`transcript_checkpoints`) that is 100% disposable
   cache. The records everyone means by "memory" — the observations — are
   **files on disk**, not DB rows. This flips the conversations-audit framing:
   there is **no PAN-1937-style DB export to design** for Memory. The
   irreplaceable state is already file-resident.

2. **…which means the durable-home answer is a different question.** The
   "first-class Memory" gaps are: **(a)** is `~/.panopticon/memory/` (170 MB
   today) in the **backup** surface? and **(b)** it is **per-machine and
   non-portable** — keyed by local `projectId`/`sessionId`, living under
   `$OVERDECK_HOME`, with nothing syncing it across machines. If Memory is to
   be first-class, *that* is the work: a durable/portable home for the
   `~/.panopticon/memory/` tree, not a DB column export.

3. **The FTS search index has no rebuilder.** `memory_fts` is written *only*
   incrementally as each observation is created (`indexObservation`). There is no
   JSONL→FTS reindex path — the lone `memory_fts_rebuild` is a column-migration,
   not a reconstruction. So `memory-search.db` is "CACHE by nature, but nothing
   can currently rebuild it from its source." Delete it (or lose it on a new
   machine) and existing observations silently fall out of injection search. A
   reindexer is a genuine NEED gap.

4. **The two search systems disagree by construction.** `pan memory search`
   (JSONL substring scan) and injection (`memory-search.db` bm25) read different
   stores with different ranking. Live data makes this worse: on `panopticon-cli`
   the FTS `memory_fts` and `observation_index` are **empty (0 rows)** while
   `reset_markers` has 175 and the issue dirs hold only `health.json` + empty
   `rag-runs/` — i.e. observations were reset/never-indexed, so injection finds
   nothing while the CLI scan still works. The split is actively papering over
   the missing reindexer.

5. **Extraction is failing ~half the time, and the system tolerates it.**
   `health.json` for one issue: 5512 succeeded / 11822 attempted, with 2117
   `write-failed`, 2096 `cost-cap`, 2097 `extraction-failed`. The pipeline
   degrades gracefully (each failure just commits the offset and moves on,
   `pipeline.ts`), but it means re-extraction is **not** a reliable rebuild path —
   which is precisely why the observations must be classed SOURCE-OF-TRUTH.

6. **The central SOURCE-OF-TRUTH judgment call (stated explicitly).** One could
   argue observations are CACHE "because they're extracted from transcripts."
   **Reject that.** The reconstruction path (re-run the LLM extractor over the
   transcript) is: **(a) unavailable** once the source transcript is gone —
   agent-workspace transcripts are torn down at close-out / deep-wipe; **(b)
   paid** — every re-extraction burns LLM tokens; **(c) non-deterministic** —
   the LLM output varies run to run; and **(d) ~50% lossy** per the health
   counters above. A path that is missing half the time, lossy, paid, and
   non-deterministic is **not** a rebuild path. **Observations are
   SOURCE-OF-TRUTH.**

7. **`bd remember` is NOT part of `src/lib/memory/*`.** The task pairs them, but
   `bd remember` is a **beads** command (the git-backed issue tracker's own
   persistent-knowledge store), entirely separate from the Panopticon Memory
   subsystem audited here. They share the word "memory" and nothing else — no
   shared store, table, or code path. The `pan memory` verb
   (`src/cli/commands/memory.ts`: `search`/`status`/`reset`/`summary`/`doctor`/`config`)
   is the CLI surface for *this* subsystem; `bd remember` is out of scope.

8. **`transcript_checkpoints` is correctly Memory-domain state.** The
   conversations audit listed it under Transcripts but flagged it belonged here.
   Confirmed: its only consumers are `src/lib/memory/*`. It is the Memory
   pipeline's dedup cursor, not a Conversation/Transcript field.
