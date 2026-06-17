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
| ⏳ Conversations/Transcripts | 2 overlapping entities | (audit pending) |
| ⏳ Cost | 396k rows + scattered rollups | (audit pending) |
| ⏳ Observability | 622k unbounded `events` | (audit pending) |
| ⏳ Orchestration/Config | ~13 tables (many empty) | (audit pending) |

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
| 4 | **Transcripts** ⏳ | `TranscriptsResolver` | (index writer) | JSONL | transcript index/FTS |
| 5 | **Cost** | `CostResolver` | `CostWriter` (ingest) | JSONL usage (+ API billing?) | cost events |
| 6 | **Projects/Config** | `ConfigResolver` | `ConfigWriter` | `projects.yaml` + config files | settings cache |
| 7 | **Observability** ⏳ | `EventsResolver`? | event emitter | derived / ephemeral | events, health |
| 8 | **Orchestration** ⏳ | `OrchestrationResolver` | control commands | DB flags + GitHub | merge-train, queue |

**Open boundary questions (audits resolving):**
- **(4) Transcript** — standalone domain with its own resolver, or an internal
  index/service shared by Issues-Agents-Conversations? *Conversations+Transcripts
  audit decides.*
- **(7) Observability** — a real domain (queryable resolver) or pure infra (an
  event bus + read-model, no domain surface)? Hinges on whether `events` is
  event-sourced truth or disposable pub/sub. *Observability audit decides.*
- **(8) Orchestration** — one domain or several (merge-train / deacon-control /
  flywheel)? *Orchestration+Config audit decides.*

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

## 5. Domain: Conversations  ⏳ (audit in flight)

Entity = a thin durable metadata record (name/title, archive, fork/handoff
lineage, favorites, issue/cwd binding) + a **Transcript** (derived). The
durable part is the only irreplaceable DB data (PAN-1937 export target). Open:
does conversation metadata become a git `.pan/records`-style durable artifact
(keeping the DB purely disposable), or stay the one DB-as-truth exception?
*Conversations+Transcripts audit fills this.*

## 6. Domain: Transcripts  ⏳ (audit in flight)

The shared, JSONL-derived substrate under Conversations *and* Agents
(`discovered_sessions` is already a universal transcript index). Open: standalone
domain vs internal index/service. *Audit decides.*

## 7. Domain: Cost  ⏳ (audit in flight)

Likely pure cache rebuildable from JSONL usage; rollups become
derived-on-read, not stored; must fix the pi/kimi capture gap (PAN-1935);
consolidate ~5 read endpoints into one resolver. *Cost audit fills this.*

## 8. Domain: Projects/Config  ⏳ (audit in flight)

Source of truth is `projects.yaml` + config files; `app_settings` is a small
cache. *Orchestration+Config audit fills this.*

## 9. Domain: Observability  ⏳ (audit in flight)

Hinges on whether `events` is event-sourced truth or disposable pub/sub. If
pub/sub, this is infra (event bus + read-model), not a domain. *Observability
audit decides.*

## 10. Domain: Orchestration  ⏳ (audit in flight)

The control plane: merge-train/queue, deacon, flywheel — plus the review-run
runtime and per-issue policy flags (`deacon_ignored`, `auto_merge`) that the
god-tables were squatting. Open: one domain or several; many candidate tables
are empty (possibly dead features to delete). *Orchestration+Config audit fills
this.*

---

## 11. Cross-cutting conventions (→ `ARCHITECTURE-CONVENTIONS.md`)

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
