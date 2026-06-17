# Overdeck — The Memory Domain (Effect API tier)

> **Status:** the second domain modelled to the issues.md proof-of-shape.
> Grounded in a no-loss mapping of the real current surface (Part 1), then the
> Effect v4-beta services derived from that mapping (Part 2). Every service
> method traces to a Part-1 row; no column, file, or endpoint is invented.
>
> **Operator goal — functional parity, not cache-purity.** Preserve every
> existing capability — observation extraction, search, prompt-time injection,
> status rollup, reset markers — and drop only the redundant or wrong *ways* of
> doing them (the two divergent search paths, the dead column). Nothing a user or
> the pipeline can do today is lost.
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `transcript_checkpoints` table + the separate `memory-search.db`
> section: `reset_markers`, `observation_index`), [`issues.md`](issues.md) (the
> template this follows), and the evidence audit
> [`../investigations/memory-audit.md`](../investigations/memory-audit.md).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Observation** — one atomic memory record: an LLM-extracted summary of a slice
  of an agent transcript (`MemoryObservation`,
  [`packages/contracts/src/memory.ts:22`](../../../packages/contracts/src/memory.ts)).
  The unit of Memory. Stored append-only as a line in a per-day JSONL file.
- **The memory store (files)** — NOT a database. A file tree under
  `~/.panopticon/memory/<projectId>/<issueId>/` holding `observations/*.jsonl`
  (the durable records), `observations/*.md` (human mirror), `status.json` (the
  rolled-up status), `archive/*.json`, `summaries/*.md`, `pending/*.json`,
  `rag-runs/*.jsonl`, `health.json`, and `reset-markers.json`. Layout in
  `src/lib/memory/paths.ts`. **This is the source of truth for Memory** — see the
  headline.
- **`transcript_checkpoints`** — the ONLY Memory table in the shared
  `panopticon.db`/`overdeck.db`. A byte-offset cursor + claim-lease + mid-turn
  rate-limit, one row per session. Schema
  [`../overdeck-schema.ts:387`](../overdeck-schema.ts); accessors in
  `src/lib/memory/checkpoints.ts`.
- **`memory-search.db`** — a **separate, per-project** SQLite file at
  `resolveMemoryRoot(projectId)/memory-search.db` (NOT the shared overdeck.db).
  Holds `memory_fts` (FTS5), `observation_index` (id → JSONL path + byte offset),
  and `reset_markers`. Schema in
  [`fts-operations.ts:50`](../../../src/lib/memory/fts-operations.ts). Reached
  through a **worker thread** client (`fts-db.ts`), not the shared `Db` handle.
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  Memory cache (both SQLite stores + the read-only file paths behind them).
- **Writer / write door** — the one `Context.Service` allowed to *mutate* Memory.
  Persists to the source of truth (the observation JSONL / the file store) first,
  then the search cache, then emits an event.
- **Claim lease** — the atomic single-writer byte-range lock on
  `transcript_checkpoints` (`claimTranscriptRange` / `commitTranscriptRange` /
  `releaseTranscriptRange`, `checkpoints.ts:70/146/215`) that stops the poller,
  stop-hook, and reconciliation sweep from double-extracting the same range.
- **Status rollup** — periodic LLM synthesis of pending turns + recent
  observations + prior statuses into one durable `MemoryStatus`
  (`rollup.ts:synthesizeStatusRollup` 97 → `commitStatusRollup`).
- **Reset marker** — an operator/pipeline-authored "hide everything at or before
  T" record (`createResetMarker`, `cli.ts:92`). Filters stale observations out of
  search; stored twice today (the file `reset-markers.json` is truth, the
  `memory-search.db.reset_markers` table is the SQL-predicate copy).
- **Relocate** — a disposition: the current surface is **not lost and not
  Memory's to own**; it maps to a sibling concern (the EventBus transport, the
  command palette's own search composition). Distinct from DELETE.

---

## ⚠️ Headline finding — Memory inverts the durability model, and its cache spans TWO databases plus a file tree

Two structural facts make Memory's doors shaped differently from Issues', and
both must be honored or the design is wrong:

**1. The source of truth is files on disk, not the DB.** For Issues, git
`.pan/records` is truth and the `issues` table is a rebuildable mirror; the writer
writes git *first*, then the cache. For Memory the equivalent truth is the
**observation JSONL** under `~/.panopticon/memory/` (memory-audit "central
SOURCE-OF-TRUTH judgment", lines 365-374: re-extraction is unavailable once the
transcript is gone, paid, non-deterministic, and ~50% lossy — therefore **not** a
rebuild path, therefore the JSONL **is** truth). Every other Memory artifact —
`transcript_checkpoints`, `memory_fts`, `observation_index`, the markdown mirror,
the daily summaries — is 100% CACHE rebuildable from those JSONL files
(memory-audit §2/§Layer-C). So the writer's source-first ordering
([CONVENTIONS §5](../ARCHITECTURE-CONVENTIONS.md)) becomes **JSONL first, then the
FTS cache** — same principle (persist truth, then update a self-healing cache),
inverted target.

**2. The cache is not one `Db` — it is two SQLite databases plus the file tree.**

| Cache surface | Where | Door handle it needs |
|---|---|---|
| `transcript_checkpoints` | the shared `overdeck.db` | the standard `Db` (Drizzle) service |
| `memory_fts` + `observation_index` + `reset_markers` | a **separate per-project** `memory-search.db` | a **second** service — `MemorySearch` — keyed by `projectId` (today: the `fts-db.ts` worker client) |
| observation JSONL / status.json / reset-markers.json | the file tree | a `MemoryFiles` capability (today: `observations.ts` / `rollup.ts` / `paths.ts`) |

The single biggest design consequence: **`MemoryWriter`'s Layer `R` carries
`Db | MemorySearch | MemoryFiles | EventBus`, not just `Db`.** The per-project FTS
store cannot be the shared `Db` (it is one file per project, opened lazily,
[`fts-operations.ts:14`](../../../src/lib/memory/fts-operations.ts)), so the
remodel models it as its own door-guarded service rather than folding it into the
single `overdeck.db` handle. This is the Memory analogue of the Issues headline
("`hold()` would need two foreign tables in its `R`") — here the multiplicity is
real and legitimate, so the door **admits** the second handle instead of
forbidding it.

**The self-heal that closes the real bug.** Because the FTS store is pure cache
of the JSONL, deleting/losing it (or arriving on a fresh machine) silently drops
every existing observation out of injection search — and **today nothing can
rebuild it** (memory-audit surprise 3: the lone `memory_fts_rebuild` token at
`fts-operations.ts:106` is a *column migration*, not a JSONL→FTS reconstruction).
The remodel makes the rebuilder a first-class writer verb — **`rebuildIndex`** —
so the "cache update failed → self-heals on next rebuild" guarantee CONVENTIONS §5
promises is actually *achievable* for Memory. Without it, parity is not met.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, `pan memory` CLI verb, RPC/event stream,
and the in-process pipeline triggers) that **reads, writes, or injects Memory
state** — observations, checkpoints, status, reset markers, search, health — with
its new home. Disposition is one of four:

- **READ →** a `MemoryResolver` method.
- **WRITE →** a `MemoryWriter` verb.
- **RELOCATE →** a sibling concern (EventBus transport, palette composition). Not
  lost, not Memory's to own.
- **DELETE →** deliberately dropped (dead field, or a redundant duplicate of a
  kept path), with the reason.

## 1A. HTTP endpoints

Memory has **no dedicated `/api/memory` resource module** today — its endpoints
live in `hooks.ts` (the three agent-hook ingress points) and one in
`workspaces.ts`. They are all **write/ingress** (the dashboard does not expose a
Memory read-API; reads happen via the CLI and the command palette).

### Writes / ingress → `MemoryWriter`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/memory/inject` ([`hooks.ts:258`](../../../src/dashboard/server/routes/hooks.ts)) | reads (RAG) | **`MemoryResolver.injectPromptTime(prompt, identity, surface)`** | Prompt-time RAG: searches the FTS + reads `status.json`, budgets, returns context (`injection.ts:injectPromptTimeMemory`). It is a *read* composition over `search` + `getStatus`; the door is a resolver method, not a writer. The decision-log append is fire-and-forget telemetry (see RELOCATE). |
| `POST /api/memory/session/start` ([`hooks.ts:299`](../../../src/dashboard/server/routes/hooks.ts)) | writes | **`MemoryWriter.claimRange` path (kickoff)** via the pipeline trigger | Session-start hook arms the extraction pipeline for a new session. The durable effect is the first checkpoint claim/seed; folds into the writer's claim verb (no separate door). |
| `POST /api/memory/turn` ([`hooks.ts:325`](../../../src/dashboard/server/routes/hooks.ts)) | writes | **`MemoryWriter.extractDelta(identity, transcriptPath, trigger)`** | Stop-hook end-of-turn trigger → `enqueueMemoryPipelineJob` → `pipeline.ts:extractFromTranscriptDelta`. The one orchestrating writer (claim → compress → extract → write → commit). |
| `POST /api/workspaces/:issueId/memory-summary` ([`workspaces.ts:3145`](../../../src/dashboard/server/routes/workspaces.ts)) | writes | **`MemoryWriter.generateSummary(projectId, issueId, date?)`** | Generates the daily markdown summary (`cli.ts:generateDailySummary` → indexes into FTS). A cache-derivative write; the writer owns it. |

## 1B. CLI verbs (`pan memory ...`, `src/cli/commands/memory.ts`)

The full subcommand surface — verified at
[`src/cli/commands/memory.ts`](../../../src/cli/commands/memory.ts) lines
17/45/66/85/99/126.

| Current verb | r/w | New door | Reason |
|---|---|---|---|
| `pan memory search <query>` (`memory.ts:17` → `cli.ts:71` `searchMemory`) | reads | **`MemoryResolver.search(input)`** | **THE search unification.** Today the CLI calls the *naive JSONL substring scan* (`cli.ts:71`), a different implementation from the FTS resolver injection uses (`search.ts:85`). Collapse to ONE — the FTS `search.ts` path — behind both surfaces (memory-audit §5 "Read side — SPLIT"). |
| `pan memory status <issue>` (`memory.ts:45` → `cli.ts:88` `getMemoryStatus` → `rollup.ts:155` `readCurrentStatus`) | reads | **`MemoryResolver.getStatus(projectId, issueId)`** | Reads `status.json`. Already single-reader; becomes a resolver method. |
| `pan memory reset <scope> <scopeId>` (`memory.ts:66` → `cli.ts:92` `createResetMarker`) | writes | **`MemoryWriter.createResetMarker(scope, scopeId, reason, fromTimestamp?)`** | Authored "hide before T" intent (SOURCE-OF-TRUTH, memory-audit Layer-B). Writes `reset-markers.json` (truth) + the FTS `reset_markers` copy + emits. |
| `pan memory summary <issue>` (`memory.ts:85` → `cli.ts:119` `generateDailySummary`) | writes | **`MemoryWriter.generateSummary(projectId, issueId, date?)`** | Same verb as the HTTP `memory-summary`. Deterministic regen from the day's observations; a cache derivative. |
| `pan memory doctor` (`memory.ts:99` → `cli.ts:146` `runMemoryDoctor`) | reads | **`MemoryResolver.getHealth(projectId)`** (+ aggregate) | Reads `health.json` per issue + active-agent staleness. A read; the staleness cross-check recomposes with AgentsResolver at the controller (operational telemetry, not Memory state). |
| `pan memory config` (`memory.ts:126` → `cli.ts:169` `readMemorySettingsSummary`) | reads | **RELOCATE → Settings** | Provider + rollup-threshold are `app_settings`/memory-settings config, not Memory-store state (`settings.ts`). A Settings read. |
| `pan memory rollup` (palette `palette.ts:84`; CLI alias of summary/status synthesis) | writes | **`MemoryWriter.rollupStatus(projectId, issueId)`** | Forces a status rollup (`rollup.ts:synthesizeStatusRollup` → `commitStatusRollup`). The single status writer. |

## 1C. RPC / event-stream + command-palette surface

There is **no dedicated observation/activity-feed RPC subscription** — verified:
`packages/contracts/src/rpc.ts` declares no `observation`/`memory`/`activity`
stream (the stream list ends at `subscribeFlywheelStatus`, rpc.ts:35-41). Memory
reaches the dashboard through the **generic domain-event bus**: the pipeline emits
`memory.observation_created` / `memory.status_updated` /
`memory.reset_marker_created` / `memory.health_changed` events
([`pipeline.ts:365`](../../../src/lib/memory/pipeline.ts),
`rollup.ts:259`, `cli.ts:470`, `health.ts:104`), which ride the same
`subscribeDomainEvents` / `activity.updated` transport every domain uses
(`ws-rpc.ts:214`).

| Current surface | r/w | New door | Reason |
|---|---|---|---|
| `memory.observation_created` event emit (`pipeline.ts:365`) | writes (announce) | **`MemoryWriter.extractDelta` → `bus.emit`** | The announce step of the write door, not a side channel. Events flow FROM the writer (CONVENTIONS §8). |
| `memory.status_updated` event emit (`rollup.ts:259`) | writes (announce) | **`MemoryWriter.rollupStatus` → `bus.emit`** | Same — the writer announces. |
| `memory.reset_marker_created` event emit (`cli.ts:470`) | writes (announce) | **`MemoryWriter.createResetMarker` → `bus.emit`** | Same. |
| `memory.health_changed` event emit (`health.ts:104`) | writes (announce) | **`MemoryWriter` internal → `bus.emit`** | Health is updated as a side effect of write/index; the writer emits it. Not a separate door. |
| `subscribeDomainEvents` / `activity.updated` consumption of the above (`ws-rpc.ts:214`) | reads (stream) | **RELOCATE → Observability/EventBus** | The generic event transport, not a Memory read door. The Memory slice is just events with a `memory.*` type; the live stream belongs to Observability (issues.md treats `replayEvents` the same way). |
| Command-palette memory search (`palette.ts:294`, `runMemoryFtsStatement` over `memory_fts`) | reads | **`MemoryResolver.search(input)`** (+ palette composition at the controller) | The palette runs its own raw FTS `MATCH` with `snippet()` excerpts. The *query* collapses into `MemoryResolver.search`; the palette's multi-source merge (memory + conversations) recomposes at the palette controller (an aggregate read, like issues.md `/api/show`). |

## 1D. In-process pipeline triggers (the real write fan-in)

The bulk of Memory's *writes* are not HTTP — they are the in-process extraction
pipeline. All funnel through `pipeline.ts:extractFromTranscriptDelta`
([line 104](../../../src/lib/memory/pipeline.ts)), which is already the single
orchestrator (memory-audit §5 "Write side — already single-writer").

| Current trigger | r/w | New door | Reason |
|---|---|---|---|
| Poller mid-turn (`poller.ts`, every ~2s while active) | writes | **`MemoryWriter.extractDelta(..., trigger:"poller")`** | One of two trigger paths into the orchestrator; rate-limited by `mid_turn_count_in_current_turn` / `last_mid_turn_at` (poller.ts:218-220). |
| Stop-hook end-of-turn (`hooks.ts` → `enqueueMemoryPipelineJob`) | writes | **`MemoryWriter.extractDelta(..., trigger:"stop-hook")`** | The other trigger path; same orchestrator. |
| Reconciliation sweep (`reconciliation.ts`) | writes | **`MemoryWriter.reconcile()`** | Catches up offsets for sessions that went away; re-`stat`s transcripts, re-fires `extractDelta` from the stored checkpoint identity (`reconciliation.ts:115`). |
| `claimTranscriptRange` / `commitTranscriptRange` / `releaseTranscriptRange` (`checkpoints.ts:70/146/215`) | writes | **`MemoryWriter.claimRange` / `commitRange` / `releaseRange`** | The atomic byte-range lease — the internal mechanics of `extractDelta`, exposed as writer verbs because the worker pool / checkpoint-client call them directly (`checkpoint-client.ts`). |
| `writeObservation` (`observations.ts:22`) | writes | **`MemoryWriter.writeObservation(observation)`** | The single observation writer: JSONL append (truth) + markdown upsert + FTS index, in one locked function. The remodel keeps it whole. |

## 1E. The DROP / RELOCATE residue

- **`transcript_checkpoints.last_observation_at` → DELETE.** Write-only, zero
  branch-reads, zero display reads (memory-audit §2/§6.1, `checkpoints.ts:168`
  writes it on every commit; `rowToCheckpoint` maps it; nothing reads
  `.lastObservationAt`). Already dropped from the locked schema (the table is 11
  cols, not 12 — `../overdeck-schema.ts:387` omits it).
- **The duplicate `searchMemory` (cli.ts:71) → DELETE the implementation,** unify
  the *capability* into `MemoryResolver.search`. Not a lost capability — the
  better (FTS) one survives behind both surfaces. **Parity caveat (decision made
  in this doc):** the CLI JSONL-scan is today the *only* path that works when the
  FTS index is empty (memory-audit surprise 4 — on this very repo `memory_fts` has
  0 rows). The unification is therefore **gated on `rebuildIndex` shipping first**,
  so an empty index is repaired rather than left as the silent-no-results bug.
- **Reset-marker double storage → kept, but single-writer.** `reset-markers.json`
  (file, truth) + `memory_fts.reset_markers` (SQL-predicate copy) both persist
  because `search.ts:121-128` filters in SQL. The remodel keeps both writes but in
  ONE verb (`createResetMarker` writes the file then mirrors to FTS), and
  `rebuildIndex` re-derives the FTS copy from the file — so the copy is honestly
  cache.
- **`rag-runs/*.jsonl` → RELOCATE → Observability telemetry.** Append-only
  injection-decision log, two writers (`injection.ts:397`,
  `query-expansion.ts:246`), **no reader** in `src/` (memory-audit §6.4). Not
  load-bearing; the writer keeps appending it as telemetry, not as Memory state.
- **`pan memory config` → RELOCATE → Settings** (provider/threshold config, §1B).

**Nothing real is lost.** Every observation, every search, every status, every
reset marker, every checkpoint lease, and prompt-time injection all retain a door.
The only deletions are a dead column and a redundant *duplicate* of a kept search.

## 1F. Rollup of the collapse

| Surface | Current sites | New home |
|---|---|---|
| HTTP endpoints | 4 (3 in hooks.ts + 1 in workspaces.ts) | 1 resolver read (`injectPromptTime`) + 3 writer verbs (claim path, `extractDelta`, `generateSummary`) |
| `pan memory` CLI verbs | 7 (search/status/reset/summary/doctor/config/rollup) | 3 resolver reads (`search`, `getStatus`, `getHealth`) + 3 writer verbs (`createResetMarker`, `generateSummary`, `rollupStatus`); `config` relocates to Settings |
| Search implementations | **2** (`cli.ts:71` JSONL-scan + `search.ts:85` FTS) | **1** — `MemoryResolver.search` (FTS), behind CLI + palette + injection |
| Reset-marker filtering implementations | **2** (`cli.ts:251` JSONL-side + `search.ts:114` SQL) | **1** — the SQL `reset_markers` predicate inside `MemoryResolver.search` |
| In-process write triggers | poller + stop-hook + reconciliation + claim/commit/release + writeObservation | `MemoryWriter`: `extractDelta`, `reconcile`, `claimRange`/`commitRange`/`releaseRange`, `writeObservation` |
| Event emits | 4 (`memory.observation_created`/`status_updated`/`reset_marker_created`/`health_changed`) | the writer's `bus.emit` announce step |
| **Missing capability** | FTS rebuilder — **does not exist** (memory-audit surprise 3) | **`MemoryWriter.rebuildIndex(projectId)`** — the new, required verb |

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md):
`Context.Service` (never `Effect.Service`), `effect/unstable/*` imports, Drizzle
behind `Db`, `Schema.Literals([...])` taking arrays, `Schema.TaggedErrorClass`,
source-first-then-cache writer ordering (§5). Every method below traces to a
Part-1 row. The entities reuse the **existing** `@panctl/contracts` Memory
schemas verbatim (`packages/contracts/src/memory.ts`) — they are already Effect
`Schema.Struct`s, so no parallel definition is created.

## 2.1 Entities & errors — `Schema` (reuse contracts)

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq } from "drizzle-orm"
import { transcriptCheckpoints } from "../overdeck-schema"          // the locked Drizzle table
import {
  MemoryObservation, MemoryStatus, ResetMarker, ResetMarkerScope,
  MemoryIdentity, PendingTurn,
} from "@panctl/contracts/memory"                                    // already Effect Schema.Struct — reused, not redefined
import { Db, MemorySearch, MemoryFiles, EventBus } from "./infra"    // see §2.2 for MemorySearch / MemoryFiles

// ── The checkpoint entity — the DB-row decoder AND the cursor read type ─────
// 11 cols (last_observation_at dropped — overdeck-schema.ts:387).
export const TranscriptCheckpoint = Schema.Struct({
  sessionId:                 Schema.String,
  transcriptPath:            Schema.String,
  lastOffset:                Schema.Number,                         // the dedup cursor
  claimOwner:                Schema.NullOr(Schema.String),          // lease holder
  claimFrom:                 Schema.NullOr(Schema.Number),
  claimTo:                   Schema.NullOr(Schema.Number),
  claimExpiresAt:            Schema.NullOr(Schema.Date),            // 60s lease-steal predicate
  midTurnCountInCurrentTurn: Schema.Number,                         // poller rate-limit breaker
  lastMidTurnAt:             Schema.NullOr(Schema.Date),
  projectId:                 Schema.NullOr(Schema.String),          // re-fire identity
  workspaceId:               Schema.NullOr(Schema.String),
  issueId:                   Schema.NullOr(Schema.String),
  updatedAt:                 Schema.Date,
})
export type TranscriptCheckpoint = typeof TranscriptCheckpoint.Type

// ── Search input + hit — reuse search.ts's existing shapes (search.ts:23/36) ─
export const SearchMemoryInput = Schema.Struct({
  query:              Schema.String,
  projectId:          Schema.String,
  workspaceId:        Schema.optional(Schema.String),
  issueId:            Schema.optional(Schema.String),
  sibling:            Schema.optional(Schema.Boolean),
  siblingTokenBudget: Schema.optional(Schema.Number),
  limit:              Schema.optional(Schema.Number),
  tags:               Schema.optional(Schema.Array(Schema.String)),
  includeArchived:    Schema.optional(Schema.Boolean),              // reset-marker bypass
})
export type SearchMemoryInput = typeof SearchMemoryInput.Type
// MemorySearchHit is the existing search.ts:36 interface, promoted to a Schema.

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ─────────────────────
export class CheckpointNotFound extends Schema.TaggedErrorClass<CheckpointNotFound>()(
  "CheckpointNotFound", { sessionId: Schema.String },
) {}
// Claim contention is a normal control-flow outcome, NOT an error — it mirrors
// the existing { status:'empty', reason } result (checkpoints.ts:72/133/135), so
// claimRange returns a typed Result union, not a failed Effect.
export const ClaimResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("claimed"), fromOffset: Schema.Number, toOffset: Schema.Number, checkpoint: TranscriptCheckpoint }),
  Schema.Struct({ status: Schema.Literal("empty"),   reason: Schema.Literals(["invalid-range","already-claimed","offset-mismatch"]) }),
])
export type ClaimResult = typeof ClaimResult.Type

// Status absence is also not an error — getStatus returns NullOr (rollup.ts:155
// returns undefined). Memory reads degrade gracefully by design (the pipeline
// tolerates ~50% extraction failure — memory-audit surprise 5).
```

## 2.2 The two extra cache handles — `MemorySearch` and `MemoryFiles`

Unlike Issues, Memory's cache is not the single `overdeck.db`. The locked schema
([`../overdeck-schema.ts:403`](../overdeck-schema.ts)) documents `memory-search.db`
as a **separate per-project** database that "cannot FK into overdeck tables
(different DB)". The remodel models it as its own door-guarded service so the FTS
store still has exactly one reader-class and one writer-class.

```ts
// The per-project FTS store handle (today: the fts-db.ts worker client). Keyed
// by projectId because there is ONE memory-search.db per project, opened lazily
// (fts-operations.ts:14 getMemoryFtsDatabaseSync).
export class MemorySearch extends Context.Service<MemorySearch, {
  readonly statement:   <T>(projectId: string, stmt: FtsStatement) => Effect.Effect<T>
  readonly transaction: (projectId: string, stmts: ReadonlyArray<FtsStatement>) => Effect.Effect<ReadonlyArray<unknown>>
}>()("overdeck/MemorySearch") {}

// The file-store capability (today: observations.ts / rollup.ts / paths.ts). The
// SOURCE OF TRUTH lives here — appendObservationJsonl is the commit point.
export class MemoryFiles extends Context.Service<MemoryFiles, {
  readonly appendObservation: (o: MemoryObservation) => Effect.Effect<{ jsonlPath: string; byteOffset: number }>
  readonly upsertMarkdown:    (o: MemoryObservation) => Effect.Effect<void>
  readonly readStatus:        (projectId: string, issueId: string) => Effect.Effect<MemoryStatus | null>
  readonly writeStatus:       (projectId: string, issueId: string, s: MemoryStatus) => Effect.Effect<void>
  readonly readResetMarkers:  (projectId: string) => Effect.Effect<ReadonlyArray<ResetMarker>>
  readonly writeResetMarker:  (projectId: string, m: ResetMarker) => Effect.Effect<void>
  readonly listObservationFiles: (projectId: string) => Effect.Effect<ReadonlyArray<string>>  // for rebuildIndex
  readonly readObservationsFile: (path: string) => Effect.Effect<ReadonlyArray<MemoryObservation>>
}>()("overdeck/MemoryFiles") {}
```

## 2.3 `MemoryResolver` — the read door (`Context.Service`)

Methods trace to Part-1 §1B/§1C/§1A reads: `search` (the unified FTS resolver
collapsing both `searchMemory`s), `getStatus`, `getHealth`, `getCheckpoint` /
`listCheckpoints` (the cursor reads `pipeline.ts:safeClaim` and `poller.ts`
consume), `injectPromptTime` (the RAG composition).

```ts
export class MemoryResolver extends Context.Service<MemoryResolver, {
  // THE unified search — FTS-backed (search.ts:85), behind CLI + palette + injection.
  readonly search:           (input: SearchMemoryInput) => Effect.Effect<ReadonlyArray<MemorySearchHit>>
  // status.json read (rollup.ts:155). Null, not error, when absent.
  readonly getStatus:        (projectId: string, issueId: string) => Effect.Effect<MemoryStatus | null>
  // health.json read (health.ts) — operational telemetry.
  readonly getHealth:        (projectId: string) => Effect.Effect<ReadonlyArray<MemoryHealthSnapshot>>
  // the dedup cursor reads (checkpoints.ts:256/230) — consumed by the pipeline.
  readonly getCheckpoint:    (sessionId: string) => Effect.Effect<TranscriptCheckpoint | null>
  readonly listCheckpoints:  (limit?: number) => Effect.Effect<ReadonlyArray<TranscriptCheckpoint>>
  // reset markers (the kept SOURCE-OF-TRUTH file), for display + the search predicate.
  readonly listResetMarkers: (projectId: string) => Effect.Effect<ReadonlyArray<ResetMarker>>
  // prompt-time RAG composition (injection.ts) — a read over search + getStatus.
  readonly injectPromptTime: (input: PromptTimeInput) => Effect.Effect<PromptTimeResult>
}>()("overdeck/MemoryResolver") {}

export const MemoryResolverLayer = Layer.effect(MemoryResolver, Effect.gen(function* () {
  const { q }  = yield* Db             // transcript_checkpoints (shared overdeck.db)
  const fts    = yield* MemorySearch   // per-project memory-search.db
  const files  = yield* MemoryFiles    // the file store (status/health/reset-markers)

  // ── search: ONE implementation. The FTS path (search.ts:85) — bm25 + recency
  //    decay + tag boost + high-signal floor + the reset_markers SQL predicate
  //    (search.ts:121-128). Replaces BOTH the CLI JSONL scan and the duplicate
  //    JSONL-side reset filter. (Part-1 §1B search row + §1F.)
  const search = (input: SearchMemoryInput) => Effect.gen(function* () {
    const rows = yield* fts.statement(input.projectId, ftsMatchStatement(input))
    return rankAndFilter(rows, input)   // the existing rankHit/matchesTags logic, verbatim
  })

  const getStatus       = (p: string, i: string) => files.readStatus(p, i)
  const listResetMarkers = (p: string)            => files.readResetMarkers(p)

  const getCheckpoint = (sessionId: string) => Effect.gen(function* () {
    const row = yield* Effect.sync(() =>
      q.select().from(transcriptCheckpoints)
        .where(eq(transcriptCheckpoints.sessionId, sessionId)).get())
    return row ? yield* Schema.decodeUnknown(TranscriptCheckpoint)(row) : null
  })

  const listCheckpoints = (limit = 100) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      q.select().from(transcriptCheckpoints)
        .orderBy(transcriptCheckpoints.updatedAt).limit(limit).all())  // ORDER BY updated_at ASC (checkpoints.ts:249)
    return yield* Effect.forEach(rows, Schema.decodeUnknown(TranscriptCheckpoint))
  })

  // injectPromptTime composes search + getStatus + budgeting (injection.ts:64).
  // It is a READ — the only durable side effect (the rag-runs append) is telemetry
  // delegated to the writer/Observability, not part of the read result.
  const injectPromptTime = (input: PromptTimeInput) => /* compose search + getStatus, budget, render */ ...

  return MemoryResolver.of({ search, getStatus, getHealth, getCheckpoint, listCheckpoints, listResetMarkers, injectPromptTime })
}))
```

## 2.4 `MemoryWriter` — the write door (`Context.Service`)

Verbs derived from Part-1 §1A/§1B/§1D writes. The orchestrator (`extractDelta`)
absorbs the poller + stop-hook + reconciliation fan-in; the lease trio, the
observation writer, the status rollup, the reset-marker author, the summary
generator, **and the new `rebuildIndex`** complete the set. Source-first ordering
is **JSONL first, then FTS cache** (headline finding 1).

```ts
export class MemoryWriter extends Context.Service<MemoryWriter, {
  // ── the orchestrator — absorbs poller + stop-hook + reconciliation triggers
  //    (Part-1 §1A /api/memory/turn, §1D). claim → compress → extract → write →
  //    commit, with finally-release (pipeline.ts:104).
  readonly extractDelta: (input: ExtractDeltaInput) =>
    Effect.Effect<ExtractResult, never, MemoryResolver>
  readonly reconcile:    () => Effect.Effect<ReconcileResult>          // reconciliation.ts sweep

  // ── the byte-range lease (checkpoints.ts:70/146/215). Internal mechanics of
  //    extractDelta, exposed because checkpoint-client/worker-pool call them.
  readonly claimRange:   (input: ClaimInput)   => Effect.Effect<ClaimResult>
  readonly commitRange:  (input: CommitInput)  => Effect.Effect<CommitResult>
  readonly releaseRange: (sessionId: string, from: number, to: number) => Effect.Effect<void>

  // ── the single observation writer (observations.ts:22): JSONL (truth) + md +
  //    FTS index, in one locked function.
  readonly writeObservation: (o: MemoryObservation) => Effect.Effect<void>

  // ── status rollup (rollup.ts:97 → commitStatusRollup). The single status writer.
  readonly rollupStatus:  (projectId: string, issueId: string) => Effect.Effect<MemoryStatus | null>
  readonly generateSummary: (projectId: string, issueId: string, date?: string) => Effect.Effect<SummaryResult>

  // ── reset marker (cli.ts:92): file (truth) + FTS copy + emit.
  readonly createResetMarker: (input: ResetMarkerInput) => Effect.Effect<ResetMarker>

  // ── THE MISSING VERB (memory-audit surprise 3 / headline). Rebuild memory_fts
  //    + observation_index from the on-disk observation JSONL files. Without it,
  //    a lost/empty FTS index = injection silently returns nothing = real bug.
  readonly rebuildIndex:  (projectId: string) => Effect.Effect<RebuildResult>
}>()("overdeck/MemoryWriter") {}

export const MemoryWriterLayer = Layer.effect(MemoryWriter, Effect.gen(function* () {
  const { q }  = yield* Db
  const fts    = yield* MemorySearch
  const files  = yield* MemoryFiles    // the SOURCE OF TRUTH
  const bus    = yield* EventBus

  // writeObservation — source-first: JSONL append is the COMMIT POINT, then the
  // FTS index (a cache that self-heals via rebuildIndex if it throws). This is
  // the Memory analogue of CONVENTIONS §5 rule 1, inverted target (files, not git).
  const writeObservation = (o: MemoryObservation) => Effect.gen(function* () {
    // 1. SOURCE OF TRUTH FIRST — append the JSONL line (idempotent on the
    //    deterministic id obs-sha256(sessionId:fromOffset), observations.ts:28).
    const { jsonlPath, byteOffset } = yield* files.appendObservation(o)
    // 2. THEN the caches — markdown mirror + FTS index. A failure here is logged
    //    to health (degraded), NOT fatal — the JSONL already holds the truth and
    //    rebuildIndex re-derives the FTS. (observations.ts:30-38 today.)
    yield* files.upsertMarkdown(o)
    yield* fts.transaction(o.projectId, indexStatements(o, jsonlPath, byteOffset)).pipe(
      Effect.catchAll(() => recordHealthDegraded(o, "fts-index-failed")))
    // 3. ANNOUNCE.
    yield* bus.emit({ type: "memory.observation_created", payload: { observation: o } })
  })

  // rebuildIndex — the new self-heal. Walk the JSONL files (the truth), re-emit
  // every observation into a fresh memory_fts + observation_index, then re-apply
  // reset-markers.json into the FTS reset_markers copy.
  const rebuildIndex = (projectId: string) => Effect.gen(function* () {
    yield* fts.statement(projectId, dropAndRecreateFtsStatement())   // fresh memory_fts + observation_index
    const filePaths = yield* files.listObservationFiles(projectId)
    let count = 0
    yield* Effect.forEach(filePaths, (path) => Effect.gen(function* () {
      const observations = yield* files.readObservationsFile(path)   // STRICTLY READ-ONLY scan
      yield* Effect.forEach(observations, (o) => Effect.gen(function* () {
        const byteOffset = yield* files.findByteOffset(path, o.id)
        yield* fts.transaction(projectId, indexStatements(o, path, byteOffset))
        count++
      }))
    }))
    const markers = yield* files.readResetMarkers(projectId)         // re-apply the file truth
    yield* Effect.forEach(markers, (m) => fts.statement(projectId, insertResetMarkerStatement(m)))
    return { projectId, reindexed: count }
  })

  // createResetMarker — file (truth) first, then the FTS copy, then emit (cli.ts:92).
  const createResetMarker = (input: ResetMarkerInput) => Effect.gen(function* () {
    const marker: ResetMarker = { id: randomUUID(), createdAt: nowIso(), fromTimestamp: input.fromTimestamp ?? nowIso(), ...input }
    yield* files.writeResetMarker(input.projectId, marker)          // reset-markers.json — the SOURCE OF TRUTH
    yield* fts.statement(input.projectId, insertResetMarkerStatement(marker))  // the SQL-predicate copy
    yield* bus.emit({ type: "memory.reset_marker_created", payload: { marker } })
    return marker
  })

  // rollupStatus — synthesize (LLM) then write status.json (rollup.ts:97/commitStatusRollup),
  // archive the prior, emit memory.status_updated (rollup.ts:259).
  const rollupStatus = (projectId: string, issueId: string) => Effect.gen(function* () {
    const next = yield* synthesize(projectId, issueId)              // existing rollup.ts compute
    if (!next) return null
    yield* files.writeStatus(projectId, issueId, next)             // status.json — SOURCE OF TRUTH (Layer-B)
    yield* bus.emit({ type: "memory.status_updated", payload: { identity: { projectId, issueId }, status: next } })
    return next
  })

  // claimRange/commitRange/releaseRange — wrap checkpoints.ts atomics in Effect.sync;
  // pure-cache (overdeck.db only), no source-of-truth step (the checkpoint IS cache).
  const claimRange   = (input: ClaimInput)  => Effect.sync(() => claimTranscriptRange(input))
  const commitRange  = (input: CommitInput) => Effect.sync(() => commitTranscriptRange(input))
  const releaseRange = (s, f, t)            => Effect.sync(() => releaseTranscriptRange(s, f, t))

  // extractDelta — the orchestrator. Uses claimRange → compress → extract →
  // writeObservation → commitRange, releasing the lease in a finally (pipeline.ts).
  const extractDelta = (input: ExtractDeltaInput) => /* the pipeline.ts:104 body, wired through the verbs above */ ...

  return MemoryWriter.of({
    extractDelta, reconcile, claimRange, commitRange, releaseRange,
    writeObservation, rollupStatus, generateSummary, createResetMarker, rebuildIndex,
  })
}))
```

> **Why `MemoryWriter`'s `R` is `Db | MemorySearch | MemoryFiles | EventBus`.**
> Memory's cache legitimately spans two databases plus a file tree (headline
> finding 2). Each is its own door-guarded service, so the writer is still the
> ONLY mutator of each — it just holds three handles instead of one. No other
> domain receives `MemorySearch` or `MemoryFiles`, so nothing else can write the
> FTS index or the observation JSONL. The door guarantee holds; the multiplicity
> is the honest shape of the domain, not a leak.

## 2.5 `MemoryApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the two
services; the handler's `R` is `MemoryResolver | MemoryWriter`, never `Db` /
`MemorySearch` / `MemoryFiles` (CONVENTIONS §7 door enforcement). Endpoints trace
to the Part-1 §1A surface — the three agent-hook ingress points and the summary —
**plus** explicit read endpoints for the CLI/palette `search`, `status`, and the
new `rebuildIndex` (which today has no surface at all).

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const MemoryApi = HttpApiGroup.make("memory")
  // ── reads (CLI/palette/injection) ──
  .add(HttpApiEndpoint.get("search", "/memory/search", {
    urlParams: SearchMemoryInput, success: Schema.Array(MemorySearchHit),
  }))
  .add(HttpApiEndpoint.get("status", "/memory/:projectId/:issueId/status", {
    params: Schema.Struct({ projectId: Schema.String, issueId: Schema.String }),
    success: Schema.NullOr(MemoryStatus),
  }))
  .add(HttpApiEndpoint.get("resetMarkers", "/memory/:projectId/reset-markers", {
    params: Schema.Struct({ projectId: Schema.String }), success: Schema.Array(ResetMarker),
  }))
  // ── ingress / writes (the existing agent-hook surface, hooks.ts:258/299/325) ──
  .add(HttpApiEndpoint.post("inject", "/memory/inject", {           // hooks.ts:258 — RAG read composition
    payload: PromptTimeInput, success: PromptTimeResult,
  }))
  .add(HttpApiEndpoint.post("sessionStart", "/memory/session/start", { // hooks.ts:299
    payload: SessionStartInput, success: Schema.Struct({ ok: Schema.Boolean }),
  }))
  .add(HttpApiEndpoint.post("turn", "/memory/turn", {               // hooks.ts:325 → extractDelta
    payload: TurnInput, success: Schema.Struct({ ok: Schema.Boolean }),
  }))
  .add(HttpApiEndpoint.post("summary", "/memory/:projectId/:issueId/summary", { // workspaces.ts:3145
    params: Schema.Struct({ projectId: Schema.String, issueId: Schema.String }),
    payload: Schema.Struct({ date: Schema.optional(Schema.String) }), success: SummaryResult,
  }))
  .add(HttpApiEndpoint.post("reset", "/memory/:projectId/reset", {  // cli.ts:92
    params: Schema.Struct({ projectId: Schema.String }), payload: ResetMarkerInput, success: ResetMarker,
  }))
  .add(HttpApiEndpoint.post("rebuildIndex", "/memory/:projectId/rebuild-index", { // THE NEW VERB
    params: Schema.Struct({ projectId: Schema.String }), success: RebuildResult,
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(IssuesApi).add(MemoryApi) /* … */

// handlers: pure delegation. R = MemoryResolver | MemoryWriter — never a cache handle.
export const MemoryApiLive = HttpApiBuilder.group(OverdeckApi, "memory", (h) =>
  h.handle("search",       ({ urlParams })     => MemoryResolver.search(urlParams))
   .handle("status",       ({ path })          => MemoryResolver.getStatus(path.projectId, path.issueId))
   .handle("resetMarkers", ({ path })          => MemoryResolver.listResetMarkers(path.projectId))
   .handle("inject",       ({ payload })       => MemoryResolver.injectPromptTime(payload))
   .handle("sessionStart", ({ payload })       => MemoryWriter.armSession(payload))
   .handle("turn",         ({ payload })       => MemoryWriter.extractDelta(payload))
   .handle("summary",      ({ path, payload }) => MemoryWriter.generateSummary(path.projectId, path.issueId, payload.date))
   .handle("reset",        ({ path, payload }) => MemoryWriter.createResetMarker({ projectId: path.projectId, ...payload }))
   .handle("rebuildIndex", ({ path })          => MemoryWriter.rebuildIndex(path.projectId)))
```

The dashboard's live surface (CONVENTIONS §8) does NOT gain a dedicated Memory RPC
stream — Memory rides the generic `subscribeDomainEvents` transport (Part-1 §1C),
fed by `MemoryWriter`'s `bus.emit`. The command palette's memory search delegates
to `MemoryResolver.search` and recomposes the memory+conversation merge at the
palette controller (an aggregate read).

## 2.6 Layer wiring

```ts
const MemoryDomainLayer = Layer.mergeAll(
  MemoryResolverLayer,
  MemoryWriterLayer,
).pipe(
  Layer.provide(DbLive),            // transcript_checkpoints (shared overdeck.db)
  Layer.provide(MemorySearchLive),  // the per-project memory-search.db handle (fts-db worker)
  Layer.provide(MemoryFilesLive),   // the file store — SOURCE OF TRUTH
  Layer.provide(EventBusLive),
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(MemoryApiLive),
  Layer.provide(MemoryDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule;
// the memory-search.db worker is also Node-only — fts-db.ts uses worker_threads).
```

A missing dependency is a **compile error at the merge** (CONVENTIONS §6). Because
`MemoryApiLive`'s handler `R` resolves to `MemoryResolver | MemoryWriter` and
neither leaks `Db` / `MemorySearch` / `MemoryFiles`, no controller can touch the
two databases or the file store directly.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `MemoryResolver.search` | §1B `pan memory search` + §1C palette search — **the unification** (collapses `cli.ts:71` + `search.ts:85` into one) |
| `MemoryResolver.getStatus` | §1B `pan memory status` (`rollup.ts:155`) |
| `MemoryResolver.getHealth` | §1B `pan memory doctor` (`health.json`) |
| `MemoryResolver.getCheckpoint` / `listCheckpoints` | §1D the dedup-cursor reads (`checkpoints.ts:256/230`) |
| `MemoryResolver.listResetMarkers` | §1B/§1E the kept reset-marker file |
| `MemoryResolver.injectPromptTime` | §1A `POST /api/memory/inject` (`injection.ts`) |
| `MemoryWriter.extractDelta` | §1A `POST /api/memory/turn` + §1D poller/stop-hook (`pipeline.ts:104`) |
| `MemoryWriter.reconcile` | §1D reconciliation sweep (`reconciliation.ts`) |
| `MemoryWriter.claimRange` / `commitRange` / `releaseRange` | §1D the lease trio (`checkpoints.ts:70/146/215`) |
| `MemoryWriter.writeObservation` | §1D the single observation writer (`observations.ts:22`) |
| `MemoryWriter.rollupStatus` | §1B `pan memory rollup` (`rollup.ts:97`) |
| `MemoryWriter.generateSummary` | §1A `memory-summary` + §1B `pan memory summary` (`cli.ts:119`) |
| `MemoryWriter.createResetMarker` | §1B `pan memory reset` (`cli.ts:92`) |
| `MemoryWriter.rebuildIndex` | §1F **the missing capability** (memory-audit surprise 3) — no current row; the required new verb |
| relocated / deleted | §1E — `last_observation_at` (DELETE), the duplicate `cli.ts:71` search (DELETE impl / unify capability), `rag-runs` + `pan memory config` (RELOCATE); none map to a Memory member by design |

No method reads or writes outside the locked `transcript_checkpoints` table, the
per-project `memory-search.db`, or the observation file store. No endpoint is
invented except `rebuildIndex`, which exists to restore a capability the audit
proved is **missing** today (the FTS index has no rebuilder), satisfying the
operator's functional-parity goal: search keeps working after a wipe/reset of the
search DB.

## What didn't fit

- **The `injectPromptTime` placement is a judgment call, stated explicitly.** It
  is classed a **resolver** method because its *result* is a read composition over
  `search` + `getStatus`. Its one durable side effect — appending the RAG decision
  to `rag-runs/*.jsonl` — is write-only telemetry with no reader (§1E), so it does
  not make the operation a write. If a future reader of `rag-runs` appears, that
  append relocates to a `MemoryWriter.logRagDecision` verb; today it stays
  fire-and-forget telemetry inside the resolver, matching `hooks.ts:258`'s own
  fire-and-forget design.
- **`armSession` (the `/api/memory/session/start` handler) is thin.** The
  session-start hook's durable effect is just seeding/claiming the first
  checkpoint; it is shown as a small writer verb rather than folded into
  `extractDelta` because it fires before any delta exists. If implementation finds
  it does nothing durable beyond enabling-state, it collapses into `claimRange`.
- **`MemorySearch` and `MemoryFiles` are new door-guarded services, not part of
  the single `Db`.** This is the one place Memory's shape departs from the
  issues.md template, and it is forced by the schema's own note that
  `memory-search.db` is a separate per-project database. The alternative — folding
  per-project FTS into the shared `overdeck.db` — was rejected because it would
  break the per-project partition (`resolveFtsDbPath`) and the worker-thread
  isolation the live code depends on.
- **Backup / portability is out of scope here.** memory-audit surprises 1-2 note
  the real "first-class Memory" gaps are (a) is `~/.panopticon/memory/` in the
  backup surface and (b) it is per-machine / non-portable. Those are
  infrastructure concerns, not API-tier doors, and belong to a separate workstream
  — this document designs the resolver/writer/controller only.
