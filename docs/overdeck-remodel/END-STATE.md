# Overdeck — End-State Architecture (DRAFT)

> **Status:** working draft. The architecture and the two fully-audited domains
> (Issues, Agents) are firm. Sections marked ⏳ are being filled from in-flight
> current-state audits; Effect code blocks are marked `‹fill from
> ARCHITECTURE-CONVENTIONS.md›` until the Effect v4-beta idiom audit lands.
> Companion docs: [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md)
> (the Effect house style) and [`investigations/`](investigations/) (the
> evidence base).

## 0. The thesis

Every recurring state/pipeline bug roots to the same disease: **one fact, many
writers, no owner, no integrity.** The remodel cures it structurally, not by
discipline:

- **One read door per domain** (a resolver `Service`) and **one write door per
  domain** (a writer `Service`). Nothing else touches a store.
- **The SQLite cache is the only surface running code uses, and it is
  disposable** — rebuilt from the sources of truth. The new `overdeck.db` starts
  **empty**; the old `panopticon.db` is kept untouched as a backup. That is why
  this big-bang is *low-risk*, not dangerous.
- **Effect everywhere, all the way down**: `@effect/schema` entities,
  `@effect/sql` for the cache, `Service`/`Layer` for the two doors, `HttpApi`
  controllers, typed errors. The two-door rule stops being a guideline you can
  violate and becomes a **type** you cannot — a handler never receives the `Sql`
  service in its requirements, only the domain resolver/writer.

### Sources of truth (durable — survive a DB wipe, travel with the repo)

| Source | Owns |
|---|---|
| **GitHub** | issue/PR open/closed/merged status, labels |
| **git `.pan/records/<issue>.json`** | the durable per-issue record: plan, verdicts, decisions, hazards, ownership |
| **JSONL transcripts** (`~/.claude/projects/.../*.jsonl`) | every conversation/agent message, token usage (→ cost), tool calls |
| **tmux** (`-L panopticon`) | liveness — is a process actually running |

Everything else in the DB is **cache** (rebuildable) or **dead** (deleted).

### Running deletion scoreboard

| Area | Before | After |
|---|---|---|
| Issue stage | 8 status axes, ~148 write sites | **1 stage**, one `advance()` |
| Issue transitions | ~148 trigger sites | **~15 legal moves** |
| Review/merge state | 49 fields (36 "kept") | **~5–8 durable verdict** fields on the issue; the rest → Orchestration runtime or deleted |
| Agent state | 44-col table **+ `state.json` plane (48 files)** | **18 fields**, no `state.json` |
| `ready_for_merge` + repair sweeps | a stored column + 2 boot-time repair sweeps | **derived**, sweeps deleted |
| Conversations/Transcripts | 30-col table + 9 satellite tables | **14 durable fields + favorites**; transcript subsystem **100% cache**; cost stored 3× → 1× |
| Cost | 396k rows, **4 cost stores** (3 redundant), 1.4 GB | 14/20 cols; **one resolver**; 3 stores deleted; ~90-day retention |
| Observability | 624k unbounded `events`; 2 modules for `health_events` | **infra, not a domain** — thin EventBus; tiered retention; `health_events` → Agents |
| Orchestration/Config | 16 tables (6 dead) | **6 tables deleted**; Orchestration → **Merge + Control/Settings**; Config = `projects.yaml` (file) |

---

## 1. The two doors (the whole architecture in one picture)

```
   SOURCES OF TRUTH      GitHub · git .pan/records · JSONL · tmux
          │  ▲
   reconstruction        rebuild cache from sources   ·   writer mirrors durable state back to git
          ▼  │
   ┌──────────────────────────────────────────────┐
   │   overdeck.db  (@effect/sql SqlClient)        │   ← a CACHE. starts empty. disposable.
   └──────────────────────────────────────────────┘
        ▲                              ▲
   READ DOOR                      WRITE DOOR
   <Domain>Resolver  Service      <Domain>Writer  Service     (one each, per domain)
        ▲                              ▲
   ┌────┴───────────┬──────────────────┴─────────┐
  HttpApiGroup    RpcGroup (dashboard)         the CLI
   per domain     subscribeDomainEvents
        └──── every caller goes through a door; nothing touches Sql directly ────┘
```

- **Resolver (read door)** — one `Service` per domain. Requires `Sql` (+ source
  clients like `GitHub`, `Records`). Returns decoded Schema entities. The *only*
  reader of its domain's cache.
- **Writer (write door)** — one `Service` per domain. The *only* mutator. It
  validates the operation, writes the cache **and** mirrors durable state to the
  git record in one boundary, then emits a domain event.
- **Controllers** — one `HttpApiGroup` per domain; the dashboard's `RpcGroup`
  for live reads. Both delegate to the same resolver/writer, so HTTP and RPC
  cannot diverge.
- **The guard** — because handlers only ever receive resolver/writer Tags in
  their `R`, direct `Sql` access is a compile error. A CI check backs it up for
  non-Effect code (CLI scripts, hooks).

---

## 2. Domain map

Eight domains. Three boundary questions are being settled by the in-flight
audits and are flagged ⏳ OPEN.

| # | Domain | Read door | Write door | Source(s) of truth | Cache tables |
|---|---|---|---|---|---|
| 1 | **Issues** | `IssuesResolver` | `IssueWriter` (`advance`, `hold`) | GitHub + `.pan/records` | issue/verdict cache |
| 2 | **Agents** | `AgentsResolver` | `AgentWriter` | tmux + `.pan/records` | agent cache |
| 3 | **Conversations** | `ConversationsResolver` | `ConversationWriter` | `.pan/records` (metadata) + JSONL | conversation cache |
| 4 | **Cost** | `CostResolver` | `CostWriter` (ingest) | JSONL usage (+ API billing?) | cost events |
| 5 | **Merge** | `MergeResolver` (`merge-set.ts`) | `MergeWriter` | GitHub PR state + `projects.yaml` | `merge_sets`, `merge_queue`, `pending_auto_merges`, `uat_generations` |
| 6 | **Control/Settings** | `SettingsResolver` (`app-settings.ts`) | `SettingsWriter` | DB flags (reset-at-cutover) | `app_settings` + per-issue policy (`deaconIgnored`, `autoMerge`) |

**File-backed resolver** (a domain with no DB cache): **Config** — `projects.yaml`
is the source of truth (`loadProjectsConfig`, mtime-cached); survives any DB wipe,
no table, no DB writer.

**Not domains** (no resolver, no pane — internal services / infra):

| Piece | What it is | Backing |
|---|---|---|
| **Transcripts** | shared internal index — where Conversation (`claudeSessionId`) + Agent (`sessionId`) converge to compute derived facts once per JSONL | `discovered_sessions` + FTS (100% cache) |
| **Observability** | a thin **EventBus** (live-stream transport) + a health side-log | `events` (4 cols), `health_events` → folds into Agents |
| **Memory** *(candidate)* | persistent knowledge / checkpoints — surfaced by audit, not in the original eight | `transcript_checkpoints`, `src/lib/memory/*` |

**Boundary questions — all three resolved:**
- **(4) Transcript → service, not a domain.** 100% cache, rebuilt from the JSONL scan.
- **(7) Observability → infra, not a domain.** `events` is disposable pub/sub (4 proofs); a thin EventBus.
- **Orchestration → TWO domains, not one or three.** Merge (cache; `merge-set.ts` is already one-resolver/one-writer) + Control/Settings (`app_settings` flags). Deacon and flywheel are NOT separate data domains — they persist only as flags.
- **(NEW) Memory — needs a decision:** an Overdeck domain, or out of scope? *Flag for the operator.*

**Net: 8 → 6 DB-cache domains + Config (file-backed).**

Cross-cutting reminder, per the tenet: **"state" is not a domain.** Every entity
*has* a status; there is no `/api/state` and no state resolver.

---

## 3. Domain: Issues  ✅ (fully audited)

The keystone. Evidence: [`investigations/pipeline-transitions.md`](investigations/pipeline-transitions.md),
[`investigations/review-state-audit.md`](investigations/review-state-audit.md).

### 3.1 The central insight

Today an issue's "stage" is **not stored** — it is a composite read across **8
independent status axes**, each its own enum/store/writer, mutated from ~148
sites. We replace all of it with **one `stage` field** advanced through **one
write door** with a small, validated set of legal moves.

### 3.2 Entity — `Issue`

Durable (mirrored to `.pan/records/<issue>.json`) unless marked *cache*.

| Field | Type | Source / cache | Notes |
|---|---|---|---|
| `id` | `IssueId` (branded) | GitHub | e.g. `PAN-1938` |
| `stage` | `Stage` (literal union) | derived/record | the single composite stage (replaces 8 axes) |
| `gates` | `{ review, test, verification?, inspect? }` → `GateOutcome` | record | the durable verdict per kept gate (see 3.4) |
| `verdictCommit` | `Sha` | record | the commit a passing verdict applies to (collapses `reviewed_at_commit` + `last_verified_commit`) |
| `blockers` | `Blocker[]` (typed) | record | merge-conflict etc.; replaces `blocker_reasons` JSON-sniffing |
| `plan` | `PlanRef` → vBRIEF on main | git `.pan/specs` | the spec; status is the only mutable field |
| `pr` | `{ url, number, headSha }` | GitHub | **issue/merge identity, not a "review" field**; `number` derives from `url` |
| `sideStates` | set of `Hold` | cache | paused/troubled/stuck/blocked/cancelled/deacon-ignored — orthogonal toggles |

Everything else from `review_status`/`issue_state`/`status_history` is either
**Orchestration runtime** (review-run cache, retry counters) or **deleted**
(`ready_for_merge` → derived; `merge_step` → derived; display-only timestamps;
dead `inspect_bead_id`; phantom `reviewer_verdicts`/`lifetime_auto_requeue_count`).

### 3.3 Write door — `IssueWriter`

Two verbs cover everything (~148 sites collapse here):

- **`advance(id, toStage, reason)`** — validates the move is one of the ~15
  legal edges, writes the cache, mirrors `stage`/`gates`/`verdictCommit` to the
  git record, emits `issue.advanced`. The *only* caller of the old
  `transitionTo` / `setReviewStatus` / `updateSpecStatus` / GitHub-label ops.
- **`hold(id, flag, on, reason?)`** — toggles an orthogonal side-state.

**The ~15 legal moves** (from the transitions audit):
spine (9): `todo→planning→planned→working→in_review→testing→verifying→merging→verifying_on_main→closed`;
failure edges (3): `in_review→working`, `testing→working`, `merging→working`;
out-of-band (3): `any→cancelled`, `closed→todo` (reopen), `any→todo` (wipe).

This kills the drift class outright: there is exactly one function that writes a
stage, and it writes every store in one boundary (no more GitHub-only path that
forgets the event; no more three-ways-in-one-function `verifying_on_main`).

### 3.4 Open product decision (sizes this domain)

**Which gates does the new pipeline keep — review / test / verification /
inspect / UAT?** Each kept gate is one `GateOutcome` in `gates` and justifies a
slice of Orchestration's review-run runtime. The audit found `verification`
overlaps `test`, `inspect`'s only durable field has a dead consumer, and `UAT`
isn't even persisted today. Folding `verification`→`test` and dropping the
separate `inspect` gate would leave **review + test (+ optional UAT)** — the
smallest honest set. *Recommend deciding this with the operator before
finalizing 3.2/3.3.*

### 3.5 Controller — `IssuesApi` (`HttpApiGroup`)

```ts
‹fill from ARCHITECTURE-CONVENTIONS.md — HttpApiGroup "issues":
   GET  /issues                      → list (filter)            → Issue[]
   GET  /issues/:id                  → get                      → Issue | IssueNotFound
   POST /issues/:id/advance          → advance(to, reason)      → Issue | IllegalTransition
   POST /issues/:id/hold             → hold(flag, on, reason)   → Issue ›
```

---

## 4. Domain: Agents  ✅ (fully audited)

Evidence: [`investigations/agents-state-audit.md`](investigations/agents-state-audit.md).

### 4.1 The central insight

The 44-column `agents` table is a dumping ground. The real need is **18 fields**,
and the entire **`state.json` plane (48 files) is deleted** — nothing lives only
there. Three planes collapse to two: **DB cache + tmux liveness**, rebuilt from
the git record.

### 4.2 Entity — `Agent`

| Group | Fields | Source / cache |
|---|---|---|
| **Identity / spawn-config (9)** | `id`, `issueId`, `role`, `workspace`, `harness`*, `model`*, `sessionId`, `hostOverride`, `deliveryMethod` | record-authoritative for `harness`/`model` (the PAN-1847/1927 trap — the row is a *mirror*); rest cache, rebuildable |
| **Lifecycle gates (8)** | `startedAt`, `lastResumeAt`, `stoppedByUser`, `kickoffDelivered`, `paused`(+`reason`), `troubled`, `consecutiveFailures`, `firstFailureInRunAt`, `lastFailureNextRetryAt` | cache (no rebuild fallback — a wiped DB just hands agents a fresh retry budget, which is fine) |
| **Liveness cache (2)** | `status` (reconciled from tmux each patrol), `updatedAt` | cache of the tmux oracle |

**Leaves the domain:** `cost_so_far` → Cost; the review-run cluster
(`review_run_id`, `review_synthesis_agent_id`, `review_output_path`,
`review_deadline_at`, `review_monitor_signaled`, `review_retry_attempt`,
`review_sub_role`) → Orchestration; `flywheel_run_id`/`role_run_head` →
Orchestration *(boundary the agents-audit flips vs the review-audit; settle in
the Orchestration section)*.

**Deleted:** `phase`, `work_type` (dead legacy PAN-118 routing); `branch`
(= `feature/<id>`, read live from git); `last_activity`, `stopped_at`
(derivable); 3 transport booleans → folded into `deliveryMethod`.

**Schema cleanup:** there are **two byte-identical `CREATE TABLE agents` blocks**
(`schema.ts:433` and `:1543`) — collapse to one in the new schema.

### 4.3 Doors

- `AgentsResolver` — enumerate/get agents (from the cache, reconciled with tmux).
- `AgentWriter` — `spawn` / `stop` / `pause` / `unpause` / `resume` / `markTroubled` / `clearTroubled`. Liveness columns rebuild from tmux; identity from the git record.

### 4.4 Controller — `AgentsApi` (`HttpApiGroup`)

```ts
‹fill from ARCHITECTURE-CONVENTIONS.md›
```

---

## 5. Domain: Conversations  ✅ (audited)

Evidence: [`investigations/conversations-transcripts-audit.md`](investigations/conversations-transcripts-audit.md).
`conversations` is **30 cols, not 35** — 5 fields the brief listed actually live
on `discovered_sessions` and only surface via a LEFT JOIN. Entity = a thin
durable metadata record + a Transcript (derived, §6). The durable part is the
**only** irreplaceable DB data — the exact PAN-1937 export target.

### 5.1 Entity — `Conversation`

| Group | Fields | Note |
|---|---|---|
| **Durable / EXPORT (14)** | `name`, `cwd`, `issueId`, `createdAt`, **`claudeSessionId`**, `title` (manual only), `titleSource`, `model`, `effort`, `harness`, `archivedAt`, + lineage edges `handoffDocPath`, `handoffTargetConvId`, `clearedToConvId` | must survive a wipe. **`claudeSessionId` is the single most important field** — the conversation↔transcript link is one-directional (the JSONL never names the conversation back), so it is **unreconstructable** after a wipe |
| **+ `favorites` table** | operator stars, keyed by conversation `name` | the other half of the irreplaceable set |
| **Derived-cache (DROP)** | `tmuxSession`, `status`, `endedAt`, `lastAttachedAt`, `totalCost`, `totalTokens`, `titleSeed`, all `fork*` (provisioning/recovery is transient), `deliveryMethod`, `spawnError`, `forkFallbackReason` | rebuilds from JSONL / tmux / Cost. `messageCount`/`models`/`tokens` aren't even stored here today (JOINed from `discovered_sessions`) |
| **Dead (4)** | per audit | delete |

### 5.2 The durable-home call

Only ~14 fields + `favorites` are irreplaceable — small enough that the clean
move is to make them a **git `.pan/records`-style durable artifact** (mirroring
the Issue record), so the DB stays purely disposable and the PAN-1937 export
becomes "write the record," not "preserve a special table." Alternative: keep
Conversations as the one DB-as-truth exception. *Recommend the git-record option;
operator's call.*

### 5.3 Duplication to delete

**Cost is stored 3×** — `conversations.total_cost`, `discovered_sessions.
estimated_cost`, and `SUM(cost_events)` (the code already cross-checks them via
`validateEstimatedCost`). Delete the two conversation copies; the Cost domain
derives it once.

### 5.4 Controller — `ConversationsApi` (`HttpApiGroup`)

```ts
‹fill from ARCHITECTURE-CONVENTIONS.md›
```

## 6. Transcripts — a shared service, **not a domain**  ✅ (resolved)

The Transcript subsystem (`discovered_sessions` + `_files`/`_tools`/`_tags` +
`sessions_fts` + `session_embeddings`) is **100% disposable cache**, rebuilt
entirely by the JSONL scan. It is **not** a navigable domain — no resolver, no
pane. It is the internal index where **Conversation** (by `claudeSessionId`) and
**Agent** (by `agents.sessionId`) converge to compute derived facts (counts,
models, tokens) **once per JSONL**. That single convergence point is what lets us
delete the duplicated derived fields elsewhere.

- **Two live search systems** exist — session-level (`sessions_fts` +
  `session_embeddings`) vs a separate chunk-level `conversation-search/` with its
  **own** `~/.panopticon/conversations/embeddings.db`. Prime consolidation
  target (the chunk store is out of scope of the in-DB tables — flagged).
- **Enrichment** (`summary`, `tags`, `enrichment_level`) is a search nicety, not
  load-bearing — no pipeline/deacon gate reads it. Regenerable; costs API $.
- **`transcript_checkpoints` does not belong here** — only `src/lib/memory/*`
  reads it. It's the **Memory** candidate domain (see map). `processed_sessions`
  + `transcript_checkpoints` are dedup guards, safe to wipe only with their
  paired store.

## 7. Domain: Cost  ✅ (audited)

Evidence: [`investigations/cost-audit.md`](investigations/cost-audit.md). **14 of 20
columns NEEDed** (5 are 0%-populated `tldr_*`/`caveman_variant` — delete). **Pure
CACHE**, but rebuilt from a **union of three durable artifacts**, not one JSONL:
`reconcile(~/.claude transcripts) ∪ replay(~/.panopticon/costs/events.jsonl) ∪
import(per-project WALs)`, deduped on `request_id`.

- **Four parallel cost stores today; three are redundant.** Keep the SQLite
  GROUP-BYs behind one `CostResolver`; **delete** `aggregator.ts` `cache.json`,
  `cost-monitor.ts` `cost-data.json` (writer `recordCostSync` has **zero callers**
  — the cost-limit breaker is silently dead), the `/api/agents/:id/cost` re-parse,
  and the `/api/specialists/:name/cost` hardcoded-zero stub.
- **Keep `closeOut.usage`** — the durable per-issue total in the permanent record
  (correctly a snapshot, not a live second source).
- **Recompute `cost` from tokens on rebuild** — the stored USD has a confirmed
  legacy bug (2025-12 values ~110× inflated, capped at exactly $50).
- **pi/kimi gap (PAN-1935):** kimi *is* captured under Claude Code; the real gap
  is harness-native pi/codex — both ingest paths are hardcoded to
  `~/.claude/projects/`. The parsers (`pi-parser.ts`, `codex-parser.ts`) exist but
  feed live display only. Fix: extend the one reconciler to sweep pi/codex dirs.
- **Retention:** none today (no `DELETE FROM cost_events` exists). Bound to ~90
  days in the DB (closed-issue rows are ephemera — `closeOut.usage` keeps the
  total); `events.jsonl` + git WALs are the unbounded archive.

Attribution keys: `issueId` (primary), `agentId`, `sessionId`, `model`+`provider`,
`sessionType`. (Quality is lossy: 12.5% `UNKNOWN` issue; `request_id` NULL on 66%.)

## 8. Domain: Config  ✅ (audited)

Evidence: [`investigations/orchestration-config-audit.md`](investigations/orchestration-config-audit.md).
**`projects.yaml` is the source of truth — a file, not the DB.** The resolver is
`loadProjectsConfig` (mtime-cached); no DB table backs project config, so it
survives any wipe untouched and there is no DB writer (edits are file edits).
Runtime control flags are a *separate* concern — see Control/Settings (§10.2).

## 9. Observability — **infra, not a domain**  ✅ (resolved)

Evidence: [`investigations/observability-audit.md`](investigations/observability-audit.md).
**`events` is a disposable pub/sub cache, NOT event-sourced** — four
primary-source proofs (PAN-1920 rebuilds the read-model from the real sources,
not the log; `replayEvents` only gap-fills between a snapshot and now; the log is
routinely truncated and emits unpersisted events). It can start empty.

- **`events` (4 cols — `sequence`, `type`, `timestamp`, `payload`): a thin
  EventBus** for the dashboard's live stream. No resolver, no domain surface.
  Retention today is **startup-only → unbounded between restarts**; make it
  **periodic + tiered** (3 live-stream-only types are 79% of rows → retain hours;
  lifecycle/review/cost types → an analytics floor).
- **`health_events` (7 cols): fold into the Agent domain** as an optional
  projection (drop `previous_state` — derivable from the adjacent row). Cleanup
  has **never run** (zero callers); wire the 7-day purge into the periodic job.
  Two modules manage this one table — delete the dead `cloister/database.ts`
  duplicate.

**⚠ The pipeline phase-duration metrics are the one non-disposable thing trapped
in `events`** (see §11) — relocate them to the per-issue `closeOut` record before
`events` can be aggressively bounded.

## 10. Domains: Merge + Control/Settings  ✅ (audited)

Evidence: [`investigations/orchestration-config-audit.md`](investigations/orchestration-config-audit.md).
The old "Orchestration" splits into two; deacon and flywheel are **not** separate
data domains (they persist only as flags).

### 10.1 Merge
`merge_sets` / `merge_set_repos` / `merge_queue` / `pending_auto_merges`
(+ `uat_generations`, + `git_operations` as an op-log). **All CACHE** —
`merge_sets` rebuilds structure from `projects.yaml` (`buildMergeSetForIssueSync`)
and gate outcomes from forge PR state; the durable record mirrors only
`artifactUrl`. `merge-set.ts` already satisfies one-resolver/one-writer.
**`uat_generations` belongs here, not Issues** (its writer is the merge-train
`uat-train.ts`).

### 10.2 Control/Settings
`app_settings` (the `deacon.*` + `flywheel.*` flags) plus the per-issue policy
squatters `deaconIgnored` / `autoMerge` evicted from `review_status`. Single
accessor `app-settings.ts` is already at target shape. **Caveat:** these flags
are source-of-truth-in-DB that nothing rebuilds — *acceptable to reset at cutover*
(see §11).

### 10.3 The review-run runtime
The cluster evicted from `agents`/`review_status` (run id, synthesis agent,
output path, deadline, monitor-signaled, retry, sub-role + the retry
counters/breakers) lands here as **ephemeral orchestration runtime** — pure
cache, dies with the run. How much survives is a function of how simple we make
the review engine.

---

## 11. Cutover-critical findings

### Source-of-truth hiding in the "disposable" cache
The DB-is-pure-cache claim holds **only after** three items get a durable home or
a conscious reset — they are the only things the audits found that don't rebuild:

| Item | Trapped today in | Fix before cutover |
|---|---|---|
| **Conversation metadata** (14 fields + `favorites`) | `conversations` / `favorites` rows | export to a git `.pan/records` artifact (recommended) so it travels (PAN-1937) |
| **Pipeline per-phase durations** (flywheel scorecard) | derived only `FROM events`; vanish on wipe | write final phase timings into the per-issue `closeOut` record (Issues) |
| **Control flags** (`deacon.globally_paused`, `flywheel.active_run_id`) | `app_settings` — nothing rebuilds them | **acceptable to reset** at cutover (fresh DB → deacon unpaused, no active run) — but make it a conscious decision |

Everything else is genuinely rebuildable or deletable.

### Tables to delete outright
Six dead tables (some must be removed from `schema.ts` or `overdeck.db` recreates them):
`issue_state` (abandoned shadow-state prototype) · `api_cache`, `rate_limits`
(**orphans** — the real tables live in a separate `~/.panopticon/cache.db`;
delete from `schema.ts`) · `auto_merge` (table), `label_sync_audit`, `outbox`
(legacy / phantom, zero refs). `flywheel_substrate_bugs` → drop unless flywheel
success metrics are a NEED. Plus the structural deletions already booked:
`state.json` (48 files), the 8 status axes, ~148 transition sites,
`ready_for_merge` + its 2 repair sweeps, and 3 of 4 cost stores.

### The Effect-stack risk to decide
`effect/unstable/sql` ships the abstractions but **no SQLite driver**, and the
only sqlite adapter (`@effect/sql-sqlite-bun`) is **Bun-only** — colliding with
the hard **dashboard-is-Node-22-only** rule. Resolution: wrap the existing
`node:sqlite` driver behind an Effect `SqlClient` interface (keeps Node-22),
*or* port/find a node sqlite driver for `effect/unstable/sql`. **Operator
decision before standardizing the cache layer.**

## 12. Cross-cutting conventions (→ `ARCHITECTURE-CONVENTIONS.md`)

- Entities are `@effect/schema`; IDs are branded; states are literal unions.
- Every store access is a `Service` method returning an `Effect`; `Sql` is a
  Tag only the resolver/writer Layers receive.
- Domain failures are tagged errors in the `E` channel; controllers map them to
  HTTP status.
- Writes emit domain events on a `Stream`; the read-model is a `SubscriptionRef`
  the dashboard subscribes to.
- The writer mirrors durable fields to the git record in the same boundary as
  the cache write — never a fire-and-forget mirror (the current silent-divergence
  bug).
