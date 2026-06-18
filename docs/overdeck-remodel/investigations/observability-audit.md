# Overdeck Remodel — Observability Field Audit (`events` + `health_events`)

**Goal:** radical complexity reduction on a fresh EMPTY DB. Keep only what the
system genuinely NEEDS. The SQLite DB is a disposable CACHE rebuilt from sources
of truth (GitHub / git / tmux / JSONL / per-issue records); classify each field
**SOURCE-OF-TRUTH** (must survive a wipe) vs **CACHE** (rebuildable, can start
empty) vs **DEAD** (no live consumer).

**Domain: Observability.** Tables: `events` (4 cols) and `health_events`
(7 cols).

**Method:** every column traced through its writers and readers across `src/`
(non-test). The discriminator for a kept read is *does any read drive control
flow* (an `if`/`filter`/gate/comparison), or is it transport (pub/sub fan-out) /
display / analytics. Live DB counts captured from `~/.overdeck/panopticon.db`
on 2026-06-16. Both column lists were verified against the running schema with
`PRAGMA table_info` (Node-22 production path through `schema.ts` migrations, not
the Bun inline CREATE): `events` = exactly 4 columns, `health_events` = exactly 7.
No hidden columns.

---

## Headline

- **`events` (624,210 rows, 4 cols)** is a **disposable pub/sub notification
  stream, NOT an event-sourced source of truth.** The read-model is reconstructed
  from real sources (state.json + tmux + GitHub + per-issue records), explicitly
  *not* by replaying the event log. Verdict: **CACHE — can start empty.** All 4
  columns are NEEDed for the live transport role; none is a source of truth.
- **`health_events` (22,304 rows, 7 cols)** is a **diagnostic side-log feeding
  exactly one display route** (`/api/agents/:id/health-history` →
  `AgentDetailView` chart/timeline). No read drives control flow. Verdict:
  **CACHE — can start empty.** Of 7 cols, 6 NEEDed for the display, `previous_state`
  is borderline (display nicety).
- **Observability is INFRA, not a domain** — an event bus (`events`) plus a
  diagnostic side-log (`health_events`). It has **one analytics reader**
  (`pipeline-run-metrics.ts`) and one diagnostic display reader. No other domain
  queries Observability for truth. No resolver needed; it is plumbing + two
  read-only viewers.
- **The junk-drawer is real and one half is unbounded.** `events` retention
  (7-day) runs **only at startup** — unbounded between restarts. `health_events`
  retention (`cleanupOldHealthEvents`, 7-day) has **ZERO callers** — it has never
  run; the oldest row is from **2026-03-18 (3 months)**.
- **Headline surprise — the flywheel scorecard is silently truncated.** The
  flywheel stats window defaults to **`30d`** (`flywheel.ts:424`), but all
  pipeline-run metrics are derived **exclusively `FROM events`**
  (`pipeline-run-metrics.ts`), which retains only **7 days**. The per-issue
  permanent record carries no per-phase durations, so these metrics are
  **unreconstructable** and vanish on a wipe. A 30-day operator scorecard shows at
  most 7 days of data.

Live counts:

| Table | Rows | Distinct agents | Oldest | Newest | Retention working? |
| --- | --- | --- | --- | --- | --- |
| `events` | 624,210 | — | 2026-06-09 (~8 d) | 2026-06-17 | Partial — startup-only, slightly past 7-day cutoff |
| `health_events` | 22,304 | 1,255 | **2026-03-18 (~3 mo)** | 2026-06-17 | **No — cleanup never called** |

`events` by type (top): `agent.output_received` 266,749 · `agent.activity_changed`
148,441 · `activity.detailed` 78,131 · `cost.event_recorded` 44,087 ·
`agent.status_changed` 21,124 · `agent.heartbeat_dead` 10,170. The top three
(493k rows, 79%) are pure live-stream telemetry with no analytics value.

---

## Glossary

- **Event-sourcing** — application state is the *fold of the event log*; the log
  is the source of truth and replaying it from sequence 0 reconstructs state.
- **Pub/sub notification stream** — events are ephemeral change-notifications
  fanned out to live subscribers; state is held and rebuilt elsewhere. The log can
  be truncated or started empty with no loss of authoritative state.
- **Snapshot** — `getSnapshot` RPC: the full current read-model, built from
  sources, that a client loads on connect.
- **Gap-fill replay** — `replayEvents(fromSequence)` with `fromSequence =
  snapshot.sequence`: fetch only the events emitted *after* the snapshot was taken
  (i.e. missed during a disconnect). This is NOT reconstruction from 0.
- **Branch-read** — a read that feeds an `if`/`filter`/comparison changing what
  the system does. Opposite: **transport** (emitted to subscribers), **display**
  (serialized to a UI view), **analytics** (aggregated into a report).

---

## Q1 — `events` table: the 4 columns + role

Schema (`event-store.ts:138`, mirrored `schema.ts` / Bun path):

```sql
CREATE TABLE IF NOT EXISTS events (
  sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT    NOT NULL,
  timestamp TEXT    NOT NULL,
  payload   TEXT    NOT NULL DEFAULT '{}'   -- JSON
);
```

| Column | What it is | Consumed by | Verdict | Class |
| --- | --- | --- | --- | --- |
| `sequence` | Monotonic gap-free id (AUTOINCREMENT). Orders the stream; is the cursor for snapshot→now gap-fill. | `getLatestSequence` labels the snapshot (`read-model.ts:499`); `readFrom(seq)` gap-fill (`ws-rpc.ts:663`); frontend recovery coordinator dedup/ordering. | **KEEP** | CACHE — transport cursor |
| `type` | Event kind (`agent.output_received`, `review.status_changed`, …). | `readFrom` excludes `issues.snapshot`; `queryByType` for activity-feed metrics; per-type retention; frontend reducer dispatch. | **KEEP** | CACHE — transport |
| `timestamp` | ISO emit time. | 7-day compaction predicate (`compactStmt`); `idx_events_type_timestamp_*`; analytics windowing in `pipeline-run-metrics.ts`. | **KEEP** | CACHE — transport + analytics |
| `payload` | JSON event body (agentId, lines, status, cost, …). | Deserialized into `DomainEvent`, streamed to clients, reduced into the read-model on the *client*; analytics extract via `json_extract`. | **KEEP** | CACHE — transport |

**NEED set for `events`:** all 4 columns. They are the minimum for an
append-only, ordered, typed, payload-carrying pub/sub log. None is droppable
*as a column* — but the *rows* are disposable (Q2) and most *types* are noise
(Q5).

The flow the task names:
- **read-model** — bootstrapped from sources, NOT from `events` (Q2). `events`
  only supplies the `sequence` label.
- **`subscribeDomainEvents`** — live fan-out: `eventStore.streamEvents` merged
  with a 15 s heartbeat (`ws-rpc.ts:581`). Pure transport.
- **`replayEvents`** — gap-fill: `readFrom(fromSequence)` (`ws-rpc.ts:662`).
- **`getSnapshot`** — returns `readModel.getSnapshot` (`ws-rpc.ts:642`), the
  source-rebuilt read-model, not an event fold.

---

## Q2 — THE key question: event-sourcing or disposable cache?

### Verdict: **DISPOSABLE PUB/SUB CACHE.** The event log is NOT a source of truth. It can start empty on a fresh DB.

Application state is reconstructed from the **real sources** (state.json + tmux +
GitHub + per-issue git records), and `events` is an ephemeral notification stream
for live UI fan-out. Four independent pieces of evidence, all primary-source:

**Evidence 1 — the read-model bootstraps from sources, explicitly not the log.**
`read-model.ts:480-517` (PAN-1920), verbatim:

> *"bootstrap from durable sources (state.json + tmux + GitHub + per-issue
> records). … **The event log and projection_cache are no longer used as
> reconstruction inputs.**"*

and at the sequence read (`read-model.ts:493`):

> *"Sequence from event store (**labels the snapshot, not a replay source**)"*

The bootstrap calls `reconstructCache(getDatabase())` and assigns
`agentsById` / `reviewStatusByIssueId` from its result. `getLatestSequence()` is
read purely to stamp `state.sequence`.

**Evidence 2 — `reconstruct-cache.ts` reads no cache tables at all.** Its header
(`reconstruct-cache.ts:1-10`):

> *"Rebuilds the agents table from state.json + tmux, enumerates in-flight issues
> from GitHub + workspaces, derives pipeline phases from the per-issue record +
> GitHub PR state … **Reads NO SQLite cache tables: no events, no projection
> cache, no review_status.**"*

It imports `backfillAgentsFromStateJsonSync`, `listRunningAgents` (tmux),
`enumerateInFlightIssuesFromSources` (GitHub + workspaces), `readIssueRecord`
(git-backed per-issue record). Zero reads of `events`.

**Evidence 3 — `replayEvents` is a gap-filler, not a reconstructor.** The
frontend (`EventRouter.tsx`) does: (1) `getSnapshot` → `syncSnapshot`; (2)
`subscribeDomainEvents` → apply incremental events; (3) `replayEvents({
fromSequence })` is called **only** with `fromSequence = snapshot.sequence`
(`EventRouter.tsx:136-138`, `replay(snapshot.sequence)`), and only when the
recovery coordinator reports a gap (`needsReplay`). It fetches the events emitted
*between* the snapshot and now — events missed during a disconnect — never from
sequence 0. There is no "replay the whole log to rebuild state" path anywhere.

**Evidence 4 — the log is routinely truncated and purged with no recovery
concern.** `compact()` deletes everything older than 7 days at every startup
(`event-store.ts:326`); `initEventStore` unconditionally `purgeType('issues.snapshot')`
(`event-store.ts:378`); `emitOnly`/`emitStored` fan out events that are *never
persisted* (sequence `-1` sentinel). A system that event-sources its state could
not casually delete 7-day-old events or emit unpersisted ones. It does both,
constantly.

**Corollary — even cost data is not sourced from `events`.** The 44,087
`cost.event_recorded` rows are pub/sub *notifications*; the cost ledger lives in
its own source-of-truth table `cost_events` (`schema.ts:171`, `INSERT OR IGNORE`
dedup on `request_id`). The events row is a fan-out echo, not the record.

**Net:** on a fresh empty DB, `events` simply starts at sequence 1 and accumulates
live notifications. No authoritative state is lost. **CACHE, startable empty.**

### One real constraint the verdict does NOT remove

`pipeline-run-metrics.ts` derives flywheel pipeline-run analytics
(plan/work/review/test/ship phase durations, merge time, outcome, intervention
count) **exclusively `FROM events`** (queries at lines 329/346/354/376; no
`readIssueRecord`, no other backing store). These metrics are consumed by
`flywheel-telemetry.ts` / `flywheel.ts` (the flywheel report). They are **not
reconstructable** from git/GitHub/JSONL — the per-issue permanent record carries
only `closeOut.{usage, merges, ranOn, closedAt}` (`record.ts:54-58`), no
per-phase timing. So:

- "Start empty on a fresh DB" still holds — a fresh start has no history by
  definition.
- But on a **wipe of an existing DB**, flywheel pipeline-run analytics are
  **lost**. This is an explicit retention/durability decision (Q5), not a refutation
  of the cache verdict. Either accept lossy flywheel analytics on wipe, or give
  those few metrics a durable home (e.g. write final phase timings into the
  per-issue `closeOut` record at merge).

---

## Q3 — `health_events`: the 7 columns

Schema (`schema.ts:290`):

```sql
CREATE TABLE IF NOT EXISTS health_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       TEXT NOT NULL,
  timestamp      TEXT NOT NULL,
  state          TEXT NOT NULL,        -- active | stuck | stale | warning
  previous_state TEXT,
  source         TEXT,                 -- heartbeat source
  metadata       TEXT                  -- JSON {confidence,lastAction,toolName,timeSinceActivity}
);
```

**What writes it:** exactly one live writer —
`Cloister.recordHealthEvent` (`service.ts:1640`) → `writeHealthEvent`
(`health-events-db.ts:46`). It writes a row only when an agent's health *state
changes* (`if previousState !== currentState`), capturing the transition for
later diagnostics.

**What consumes it:** exactly one live reader — `getHealthHistory`
(`health-events-db.ts:93`), called by the HTTP route
`GET /api/agents/:id/health-history` (`agents.ts:1143`), rendered by the frontend
`AgentDetailView.tsx` → `HealthHistoryTimeline` / `HealthHistoryChart`. **Pure
display.** No read drives control flow; the Cloister derives *live* health from
heartbeats, not from this history table.

| Column | What it is | NEED? | Verdict | Class |
| --- | --- | --- | --- | --- |
| `id` | PK. | yes (PK) | **KEEP** | CACHE |
| `agent_id` | Which agent. | yes — `WHERE agent_id=?` in every read | **KEEP** | CACHE |
| `timestamp` | When the transition happened. | yes — windowing + ORDER BY + retention | **KEEP** | CACHE |
| `state` | New health state. | yes — the value plotted | **KEEP** | CACHE |
| `previous_state` | Prior state. | borderline — display nicety (transition arrow); no consumer branches on it | **KEEP (low value)** | CACHE |
| `source` | Heartbeat source label. | yes — shown in the timeline | **KEEP** | CACHE |
| `metadata` | JSON diagnostics (confidence, lastAction, toolName, timeSinceActivity). | yes — surfaced in the detail view | **KEEP** | CACHE |

**NEED set for `health_events`:** 6 of 7 columns for the diagnostic display;
`previous_state` is droppable if the timeline derives the prior state from the
adjacent row (it can — rows are ordered). The whole table is **CACHE** — it backs
one optional diagnostic view and is regenerated as agents run. On a fresh DB it
starts empty; the only loss is past agents' health timelines, which is acceptable
diagnostic history, not authoritative state.

**Retention:** intended 7 days (`RETENTION_DAYS = 7`, `cleanupOldHealthEvents`)
but **never invoked** — see Q5. Hence 3 months of rows.

### Surprise — massive dead duplication over one table

There are **two modules** managing `health_events`:

| Module | Writers | Readers | Live? |
| --- | --- | --- | --- |
| `src/lib/database/health-events-db.ts` (panopticon.db) | `writeHealthEvent` ✅, `writeHealthEvents` ❌ | `getHealthHistory` ✅; `getRecentHealthHistory`/`getAllHealthHistory`/`getLatestHealthEvent`/`getAgentsWithHistory` ❌; `cleanupOldHealthEvents` ❌ | partly |
| `src/lib/cloister/database.ts` (legacy cloister.db variant, same table) | `writeHealthEventSync`/`writeHealthEvents*` | `getHealthHistorySync`/`getRecentHealthHistorySync`/`getAllHealthHistorySync`/`getLatestHealthEventSync`/`getHealthStats`/`getAgentsWithHistorySync` | **ALL DEAD** |

Confirmed by grep: **every read function in `cloister/database.ts` has zero
external callers**, and `getLatestHealthEvent` (imported into `service.ts:23`
from health-events-db) is **never called** — a dead import. The live surface is a
single write fn and a single read fn; everything else is duplicate plumbing the
remodel can delete outright.

---

## Q4 — Domain or infra?

**INFRA, with one analytics reader.** Observability is not a queryable domain —
nothing else in the system asks Observability for authoritative state. It is:

- **`events`** = an in-process event bus (EventEmitter + SQLite tail) for live UI
  fan-out. Transport.
- **`health_events`** = a diagnostic side-log feeding one optional detail view.

There is no "observability resolver" any other domain depends on. The only
non-display server-side reader of `events` is `pipeline-run-metrics.ts` (flywheel
analytics) — and that is a *derived report*, not a truth other domains consult.

**Recommendation:** do **not** model Observability as a domain with a resolver in
the one-resolver-per-domain target. Treat it as infrastructure:

1. `events` → a thin **EventBus** service: `append` / `appendAsync` /
   `subscribe` / gap-fill `readFrom`. One writer (`append*`), one transport
   surface. No domain reads it for truth.
2. `health_events` → fold into the **Agent** domain as an optional diagnostic
   projection. One writer (`recordHealthEvent`), one reader (the health-history
   view). Delete the entire `cloister/database.ts` health duplicate and the dead
   `health-events-db.ts` read/cleanup fns that aren't on the live path.
3. The flywheel pipeline-run metrics that read `FROM events` are an **analytics
   consumer** of the bus — phrase the infra as *"event bus with one analytics
   reader,"* and make the durability decision in Q5 so that dependency is not
   lost.

---

## Q5 — Retention / bounding (the junk drawer)

Current state is the worst of both: one table truncates only on restart, the
other never truncates at all.

### `events` — startup-only compaction

`compact()` deletes `timestamp < now-7d`, but its **only call site** is
`initEventStore()` (`event-store.ts:374`) — it runs once per server boot and never
again. Between restarts the table grows unbounded by construction. (The live
oldest row at ~8 days is consistent with compaction having run at the last
startup; the dispositive evidence is the single startup-only call site, not the
row age.) 79% of rows are high-frequency live-stream telemetry
(`agent.output_received`, `agent.activity_changed`, `activity.detailed`) with no
analytics or replay value beyond a short reconnect window.

**Recommend a periodic, tiered retention job:**

1. **Make compaction periodic**, not startup-only — run `compact()` on an
   interval (e.g. hourly) inside the dashboard server.
2. **Tier by type:**
   - **Live-stream-only types** (`agent.output_received`, `agent.activity_changed`,
     `activity.detailed`, `agent.thinking_started`, `agent.output_*`): retain
     **hours** (long enough to cover a reconnect gap-fill; nothing reads them
     after). This alone reclaims ~80% of rows.
   - **Lifecycle / review / cost-notification types** (`agent.created`,
     `agent.status_changed`, `review.status_changed`, `cost.event_recorded`,
     pipeline lifecycle): retain at the **analytics floor** set by the flywheel
     stats window (see below).
3. **Never persist** the oversized derived types — `issues.snapshot` is already
   `emitOnly` + startup-purged; keep that invariant.

### `health_events` — wire up the cleanup that already exists

`cleanupOldHealthEvents(retentionDays = 7)` (`health-events-db.ts:192`) exists and
is correct, but has **zero callers**. The legacy `cloister/database.ts` retention
fns (`cleanupOldEventsSync` / `deleteAgentHistorySync`, which also
`DELETE FROM health_events`) are **also dead** — zero external callers. So **no
effective retention runs against this table from either module**, which is why the
oldest row is from 2026-03-18 (3 months). **Wire `cleanupOldHealthEvents` into the
same periodic retention job** with its 7-day default. No new code beyond the call
site. Optionally cap per-agent rows (the table is transition-only, so volume is
modest — 22k rows / 1,255 agents — but unbounded agents over time is the leak).

### The retention-vs-analytics decision (must be stated, not buried)

The flywheel stats window defaults to **`30d`** (`flywheel.ts:424`) and
`parseFlywheelStatsWindow` accepts **any `Nd`** with no upper cap, but
pipeline-run metrics are derived **only `FROM events`** with **7-day** retention.
A 30-day (or 90-day) flywheel scorecard is **silently truncated to 7 days.**
Resolve explicitly — one of:

- **(A) Accept the truncation:** cap the flywheel window at the events retention
  (reject `>7d`, or document "last 7 days") so the operator is not misled. Cheapest;
  keeps events fully disposable.
- **(B) Give analytics a durable home:** at merge/close-out, write the final
  per-phase durations + outcome into the per-issue `closeOut` record (git-backed,
  survives wipe), and have `pipeline-run-metrics` read history from records and
  only *recent* runs from `events`. Then events retention can be short for ALL
  types, and the 30-day scorecard becomes real and wipe-safe.

**Recommendation: (B)** — it is the only option consistent with the Overdeck
tenet (DB is a disposable cache; durable truth lives in sources). It moves the
sole non-disposable thing currently trapped in `events` into the per-issue record
where the rest of the durable verdict already lives, and unlocks aggressive
events retention.

---

## Surprises (summary)

1. **The flywheel scorecard lies by up to 23 days.** Default 30-day window over a
   7-day event store; pipeline-run metrics are events-only and have no durable
   backing. Latent, operator-facing.
2. **`health_events` retention has never run.** The cleanup fns in *both* modules
   (`health-events-db.ts` and `cloister/database.ts`) have zero callers; the table
   holds 3 months (back to 2026-03-18) of supposedly-7-day data.
3. **`events` compaction is startup-only**, so the "7-day retention" is really
   "7 days plus however long since the last restart."
4. **Two full modules manage one `health_events` table**, and every read function
   in `cloister/database.ts` plus several in `health-events-db.ts`
   (`getLatestHealthEvent` dead import, `writeHealthEvents`, `getRecentHealthHistory`,
   `getAllHealthHistory`, `getAgentsWithHistory`, `cleanupOldHealthEvents`-as-uncalled)
   are dead — pure duplicate plumbing.
5. **`cost.event_recorded` (44k rows) is a redundant echo** — the cost ledger is
   the separate source-of-truth table `cost_events`; the event-log copies add no
   authority and full retention noise.
6. **79% of `events` rows are three live-stream-only types** that nothing reads
   after the reconnect window — the single biggest bounding win.
