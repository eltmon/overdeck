# Overdeck Remodel — Cost Domain Field & Architecture Audit

**Goal:** radical complexity reduction on a fresh empty DB. Keep only the cost
fields the dashboard/pipeline genuinely NEEDS. Classify every `cost_events`
column and every cost store as **SOURCE-OF-TRUTH**, **CACHE (rebuildable)**, or
**DEAD**. Target: one Cost resolver + one Cost writer; the SQLite DB is a
disposable cache rebuilt from the durable sources.

Method: every column traced through its writers (`insertCostEvent[s]`,
`appendCostEventSync`) and its readers (the aggregators in `cost-events-db.ts`,
`aggregator.ts`, and the 18 cost HTTP endpoints), with the discriminator being
**does any consumer read the column at all**, and **is the column reconstructable
from a durable source**. Empirical distribution was measured against the live
`~/.panopticon/panopticon.db` (395,910 rows, 1.4 GB) on 2026-06-16.

**Headline verdict:** the **entire `cost_events` table is pure CACHE** — every
row is rebuildable from the union of durable sources `{Claude transcripts} ∪
{~/.panopticon/costs/events.jsonl} ∪ {per-project WALs}`. Nothing in the table
is irrecoverably DB-only. Of the 20 columns: **14 NEED, 6 DEAD** (5 never
populated in 395,910 rows + 1 redundant). Of the cost rollups: **all are already
computed-on-read** — but they are computed on read **four different ways from
three different stores** (SQLite, `events.jsonl`→`cache.json`, `cost-data.json`),
which is the real complexity to collapse. The per-issue durable total already
lives in the permanent record (`closeOut.usage`), so the DB is only ever a
live-window cache.

---

## Glossary

- **`cost_events`** — the SQLite table (`~/.panopticon/panopticon.db`). One row
  per deduplicated assistant API response: tokens + computed USD + attribution.
- **Claude transcript** — `~/.claude/projects/<encoded-cwd>/<session>.jsonl`,
  written by Claude Code. Carries per-response `message.usage` token counts and
  `requestId`, but **no cost** (cost is computed by Panopticon from tokens ×
  pricing). The reconciler's source of truth for Claude/CLIProxy agents.
- **events.jsonl** — `~/.panopticon/costs/events.jsonl`, Panopticon's own
  append-only cost log written by `appendCostEventSync`. Carries the **computed
  cost** at write time. The source of truth for background-AI events that have no
  transcript at all.
- **WAL** — per-project, git-tracked `<events_repo>/.pan/events/<ISSUE>.jsonl`,
  appended by `appendToWalSync`. Enables multi-developer cost sync; a durable
  copy of each locally-recorded event.
- **Live hook** — `sync-sources/hooks/record-cost-event.ts`, a Claude Code
  `PostToolUse` hook. Reads new transcript bytes, computes cost, calls
  `appendCostEventSync` (→ events.jsonl + DB + WAL). **Claude Code only.**
- **Reconciler** — `src/lib/costs/reconciler.ts`. Periodic catch-up sweep of
  **`~/.claude/projects/` only**, importing any transcript events missing from
  the DB via `insertCostEvents` (DB-only, no events.jsonl append).
- **SOURCE-OF-TRUTH** — value that exists only here and is lost on DB wipe.
- **CACHE** — value reconstructable from a durable source (transcript / events.jsonl / WAL / pricing table).
- **DEAD** — written never (or written but read by nothing live), or a stored
  copy of a value derivable from a sibling column.

---

## 1. `cost_events` — the 20 columns, field by field

Schema: `src/lib/database/schema.ts:171-195`. Writers:
`insertCostEvent`/`insertCostEvents` (`cost-events-db.ts:68,126`). Type:
`CostEvent` (`src/lib/costs/events.ts:17-44`).

| # | Column | Class | NEED? | What it drives / why dead |
| --- | --- | --- | --- | --- |
| 1 | `id` | CACHE | drop | AUTOINCREMENT PK; no consumer reads it (all reads key on `request_id`/`issue_id`/`agent_id`/`ts`). Rebuild assigns fresh ids. **Not in NEED set as a value** — keep only as a row id. |
| 2 | `ts` | CACHE | **NEED** | ISO timestamp. Every aggregator orders/filters by it (`getDailyTrends`, retention cutoff, `idx_cost_ts`, `MAX(ts) last_updated`). From transcript `timestamp`/events.jsonl. |
| 3 | `agent_id` | CACHE | **NEED** | Attribution key. `getAgentRollup` GROUP BY; `queryCostEvents(agentId)`; `idx_cost_agent_id`. From session→agent index. |
| 4 | `issue_id` | CACHE | **NEED** | Primary attribution key. Every per-issue read (`getCostForIssueFromDb`, `getCostsByIssueFromDb`, `getCostBreakdownByStageAndModel`, records.ts closeOut). `idx_cost_issue_id`. |
| 5 | `session_type` | CACHE | **NEED** | Pipeline stage (planning/implementation/review/test/merge/…). `getStageBreakdownForIssue`, `getCostBreakdownByStageAndModel` (PAN-1908 stage view). From state.json role / agent-dir regex. |
| 6 | `provider` | CACHE | **NEED** | anthropic / openai / google / custom. `getCostBreakdownByStageAndModel` (`provider/model` grouping); pricing lookup. From model-name inference. |
| 7 | `model` | CACHE | **NEED** | Model id. `getModelRollup`, `getModelBreakdownForIssue` GROUP BY; pricing lookup. From transcript `message.model`. |
| 8 | `input` | CACHE | **NEED** | Input tokens. Summed everywhere; cost input. From transcript `usage.input_tokens`. |
| 9 | `output` | CACHE | **NEED** | Output tokens. Summed; caveman A/B output metric; cost input. |
| 10 | `cache_read` | CACHE | **NEED** | Cache-read tokens. Summed; cost input. From `usage.cache_read_input_tokens`. |
| 11 | `cache_write` | CACHE | **NEED** | Cache-write tokens. Summed; cost input. From `usage.cache_creation_input_tokens`. |
| 12 | `cost` | CACHE | **NEED** | Computed USD (`calculateCostSync(tokens, pricing)`). The headline number. **Point-in-time** — see drift note in §2. Carried verbatim in events.jsonl/WAL; recomputed from tokens×pricing on a transcript-only rebuild. |
| 13 | `request_id` | CACHE | **NEED** | **Dedup key.** `UNIQUE idx_cost_request_id` is the entire idempotency guarantee for re-import. Without it, reconciler re-runs would double-count. From transcript `requestId`. **66% NULL** in practice (260,109/395,910) — see surprise #4. |
| 14 | `session_id` | CACHE | **NEED** | Claude session UUID. Reconciler offset tracking (`processed_sessions` join, `idx_cost_session_id`). From transcript filename. 79% NULL (live-hook rows omit it). |
| 15 | `tldr_interceptions` | **DEAD** | drop | **0 / 395,910 rows non-null.** The live hook *attempts* to populate these (only when a TLDR daemon is active and reports interceptions on the session's first event) — but in the entire history only **6 events.jsonl lines** ever carried tldr fields and **none reached the DB**. Only consumer is `queryCostEvents` passthrough → no live reader branches on it. Effectively unused. |
| 16 | `tldr_bypasses` | **DEAD** | drop | Same — 0 rows populated. |
| 17 | `tldr_tokens_saved` | **DEAD** | drop | Same — 0 rows, `SUM = 0`. |
| 18 | `tldr_bypass_reasons` | **DEAD** | drop | Same — JSON column, never populated. |
| 19 | `source_file` | CACHE | **NEED** | Provenance tag (`reconciler:<path>`, `background:*`, `memory-extraction`, WAL path, or null=live-hook). Load-bearing: `getBackgroundCostBySource` filters `LIKE 'background:%'`; `queryMemoryExtractionCostUsd` filters `= 'memory-extraction'` for Background-AI spend display (PAN-1589). Keep — but it doubles as the rebuild-source discriminator. |
| 20 | `caveman_variant` | **DEAD** | drop | **0 / 395,910 rows non-null** (all NULL). Sole consumer `getCavemanExperimentData` → `/api/costs/experiments`. The A/B experiment (PAN-611) is concluded; column is pure accretion. |

**NEED set (14):** `ts, agent_id, issue_id, session_type, provider, model,
input, output, cache_read, cache_write, cost, request_id, session_id,
source_file`. Plus `id` — the **PK; KEEP** (every table needs it), but it carries
no semantic value (rebuild-assigned; no consumer reads it).
**Droppable (5):** the four `tldr_*` columns + `caveman_variant` — all five
literally 0% populated across 395,910 rows.

### Current writers → target single writer (matching the epic's "one writer" half)

Today `cost_events` has **three** write entry points:
- `appendCostEventSync` (`events.ts:102`) — live hook, background-AI, migration —
  fans out to DB + events.jsonl + WAL.
- `insertCostEvents` (batch) — reconciler (`reconciler.ts:405`) + sync-wal
  (`sync-wal.ts:65`) — DB-only.
- `insertCostEvent` (single) — memory provider (`memory/providers/types.ts:119`)
  + `appendCostEventSync` internal.

Target: **one writer** — a single `recordCost(event)` that owns the
DB+events.jsonl+WAL fan-out, with the reconciler and all harness sweeps
(Claude/pi/codex) feeding it the same `CostEvent` shape. No path should write the
DB directly except through it.

---

## 2. Central verdict — is `cost_events` fully derivable? **YES, it is pure CACHE.**

`cost_events` is a **disposable cache**: pure CACHE, fully rebuildable —
**provided the durable archive (Claude transcripts + events.jsonl + per-project
WALs) is retained.** No cost datum lives *only* in the DB **as a value**, but one
subset has a single-file backing: the **74,899 `reconciler:*` rows are written
DB-only and are backed solely by the Claude transcript** (not in events.jsonl,
not in any WAL). Their rebuildability is therefore equivalent to transcript
persistence. Within Panopticon's control this is safe — Panopticon never deletes
`~/.claude/projects/` transcripts and actively guards against it (`rm
~/.claude/projects/*` is in the denied-Bash list, `claude-settings-overlay.ts:73-75`,
consistent with the "JSONL is sacred" rule). Only **external / Claude-Code-side
transcript deletion or rotation** would make those specific rows unrecoverable —
in which case the per-issue total still survives in `closeOut.usage`. (Note: the
`processed_sessions` byte-offsets that the reconciler uses live in the same DB;
a fresh-empty rebuild resets them to 0 and re-imports every still-present
transcript — correct and idempotent via the `request_id` UNIQUE index.)

The source is **not a single JSONL** — it is the union of three durable
artifacts, because the three write paths are backed by three different files:

| Write path | Code | Durable backing file | Carries cost? |
| --- | --- | --- | --- |
| **Live hook** | `appendCostEventSync` (`events.ts:102`) → DB + events.jsonl + WAL | `events.jsonl` **and** WAL | yes (computed at write) |
| **Reconciler** | `insertCostEvents` (`reconciler.ts:405`) — **DB-only** | Claude transcript (`~/.claude/projects/`) | no (recomputed from tokens) |
| **WAL sync** | `insertCostEvents` (`sync-wal.ts:65`) — **DB-only** | per-project WAL (`.pan/events/*.jsonl`) | yes |
| **Background-AI** | `appendCostEventSync` (`background-ai/cost.ts:84`) → DB + events.jsonl | `events.jsonl` (no transcript exists) | yes |

Two facts make "just replay one JSONL" wrong, and both are load-bearing:

1. **events.jsonl is NOT a complete mirror of the DB.** The reconciler and
   sync-wal write to SQLite **without** appending to events.jsonl. Empirically
   the DB has 395,910 rows; events.jsonl has 651,564 lines (pre-dedup). They
   overlap but neither contains the other.
2. **Claude transcripts are NOT a complete source.** Background-AI /
   memory-extraction rows (`source_file IN ('background:*','memory-extraction')`)
   are born directly in events.jsonl with **no transcript at all**. A
   transcript-only rebuild would silently drop them.

**Rebuild recipe (the property, stated non-destructively):** the table is
reconstructable as `reconcile(all Claude transcripts) ∪ replay(events.jsonl) ∪
import(all WALs)`, deduplicated by `request_id` (and the 60s-window heuristic for
the 66% of rows lacking one). `request_id` UNIQUE makes the union idempotent.

**The one degradation to call out — the `cost` column is the only non-stable
datum across a rebuild.** `cost` is point-in-time `tokens × pricing-snapshot`.
events.jsonl/WAL rows carry the **original** USD verbatim; reconciler-only rows
recompute from tokens at rebuild using **current** `DEFAULT_PRICING`
(`cost.ts:86`), yielding bounded drift if pricing changed since.

**But the stored USD is not always trustworthy either** — see the **2025-12
anomaly**: 2,439 rows holding **$15,276** (35% of all dollars in 0.6% of rows),
all `claude-sonnet-4`, **avg $6.26/row and max exactly $50.00** vs the
~$0.056/row baseline of 2026-03 — a ~110× per-row outlier that dedup cannot
explain (dedup changes row *count*, not per-row cost). This is almost certainly a
historical **cost-calculation/pricing bug** (a flat `$50` max is a smell). Tokens
are intact; the stored `cost` is wrong.

**Recommendation:** make **recompute-cost-from-tokens canonical on rebuild**, not
"trust stored USD where present." The token columns are the durable truth; `cost`
is a derived convenience that has demonstrably been miscalculated. To keep
historical USD bit-stable where it *is* correct, snapshot a pricing-version id per
row; otherwise accept that the recomputed value is the more defensible number and
let it correct legacy bugs like 2025-12.

> Per repo rule (`feedback_no_destructive_acceptance_tests`): cache-derivability
> is asserted as a **property**, not as a "wipe the DB to prove it" recipe. Do
> not author a destructive recovery test.

---

## 3. Rollups — the kill-list (epic: "kill cost rollups")

**No materialized rollup table exists** in `cost_events` schema, and **no
authoritative cost aggregate is cached in the read-model / enrichment service.**
Every per-issue / per-agent / per-model / per-day / per-stage rollup is a live
`SELECT … GROUP BY` computed on read. So the epic's "kill rollups" is **not a
deletion of stored truth — it is a consolidation of four parallel
compute-on-read implementations into one resolver.** The sprawl:

### Store A — SQLite `cost_events` (`cost-events-db.ts`) — KEEP as the one resolver's backing
All compute-on-read GROUP BYs. These are the rollups to **keep, behind one resolver**:

| Rollup | Function | Grouping |
| --- | --- | --- |
| per-issue | `getCostsByIssueFromDb` / `getCostForIssueFromDb` | `GROUP BY issue_id` |
| per-model | `getModelRollup` / `getModelBreakdownForIssue` | `GROUP BY model` |
| per-agent | `getAgentRollup` | `GROUP BY agent_id` |
| per-day | `getDailyTrends` | `GROUP BY DATE(ts)` |
| per-stage×model | `getCostBreakdownByStageAndModel` / `getStageBreakdownForIssue` | `GROUP BY session_type, provider/model` |
| background-by-source | `getBackgroundCostBySource` | `GROUP BY source_file` |
| caveman A/B | `getCavemanExperimentData` | `GROUP BY caveman_variant` → **DEAD (all NULL)** → DERIVE-away |

### Store B — `aggregator.ts` JSON cache (`cache.json`) — **KILL (redundant second store)**
`getCostsForIssueSync` (`aggregator.ts:318`) reads a **separate JSON rollup
cache** (`syncCacheSync`/`loadCacheSync`/`saveCacheSync`) rebuilt by replaying
**events.jsonl** — a parallel per-issue rollup that duplicates store A from a
**different source**. `/api/issues/:id/costs` reads store B; `/api/costs/by-issue`
reads store A. Two answers for the same question. **Verdict: DERIVE — delete the
JSON cache, point the issues endpoint at the SQLite resolver.**

### Store C — `cost-monitor.ts` `cost-data.json` (`perAgent`/`perIssue`/`dailyTotal`) — **KILL (dead + second source of truth)**
A third rollup store, incremented live by `recordCostSync` and reset daily.
**`recordCostSync` has ZERO callers** (verified across `src/` and
`sync-sources/`). So `cost-data.json` is never written; `getCostSummary()`
(backing `/api/metrics/costs`) returns stale/empty rollups, and the cost-limit
circuit breaker `checkCostLimits` (called from `service.ts:1589`) gates on
never-incremented data — **effectively non-functional.** Verdict: **DEAD store.**
Either delete it, or (if daily-total cost limits are wanted) rederive
`dailyTotal`/`topAgents`/`topIssues` on read from the one SQLite resolver
(`getDailyTrends` + `getAgentRollup` already produce exactly these).

### Durable rollup — `closeOut.usage` in the permanent record — KEEP (this is correct)
`records.ts:116-128` (`projectUsage`) writes per-issue `byStage`, `totals`, and
`costAtCloseOut.usd` into the permanent per-issue record at close-out, derived
from `cost_events`. **This is the one rollup that SHOULD be durable** — it
captures the final per-issue total at the pricing-as-of moment, surviving DB
wipe. It is correctly a snapshot, not a live second-source. KEEP.

**Kill-list summary:** delete store B (`aggregator.ts` cache.json) and store C
(`cost-monitor.ts` cost-data.json + dead `recordCostSync`); collapse the seven
store-A GROUP BYs behind one resolver; drop the caveman rollup (dead column);
keep `closeOut.usage` as the durable per-issue snapshot.

---

## 4. Attribution keys — what ties a `cost_event` to its subjects

A cost event joins to its subjects through these columns (all in the NEED set):

| Subject | Key column(s) | How it's resolved at ingest |
| --- | --- | --- |
| **issue** | `issue_id` | `buildSessionIndex` → state.json `issueId`; else `inferIssueId(agentDir)` / `inferIssueFromPath(decodedPath)` regex (`(pan\|min\|aud\|krux\|cli)-\d+`). Falls back to `'UNKNOWN'`. |
| **agent** | `agent_id` | session UUID → agent-dir via `sessions.json` reverse index; else `'unattributed'`. |
| **conversation / session** | `session_id` | transcript filename UUID; also the reconciler offset key (`processed_sessions`). |
| **model** | `model` (+ `provider`) | transcript `message.model`; provider inferred by substring (`gpt`→openai, `gemini`→google, `kimi`/`minimax`→custom, else anthropic). |
| **project** | *derived from* `issue_id` | no project column — project is resolved from the issue prefix (`extractPrefixSync`) at read/WAL-routing time. |
| **pipeline stage** | `session_type` | state.json `role` or agent-dir regex. |

**Attribution quality (measured):** of 395,910 rows, **49,516 (12.5%) have
`issue_id='UNKNOWN'`** and **26,261 (6.6%) have `agent_id LIKE 'unattributed%'`**.
The regex-and-fallback attribution is lossy; the remodel's one writer should
attribute from the authoritative session→agent index, not path regex, and treat
UNKNOWN as a first-class bucket rather than silently mixing it into rollups.

---

## 5. Read-door scatter — the consolidation target (18 endpoints, 3 stores)

Cost reads are spread across **6 route modules / 18 endpoints**, hitting **3
different stores**. This is the surface one Cost resolver replaces.

### `routes/costs.ts` — 13 endpoints (store A SQLite + events.jsonl helpers)
| Endpoint | Backing |
| --- | --- |
| `GET /api/costs/summary` | events.jsonl read |
| `GET /api/costs/by-issue` | **store A** `getCostsByIssueFromDb` |
| `POST /api/costs/rebuild` | `rebuildCacheSync` (store B cache rebuild) |
| `POST /api/costs/deduplicate` | events.jsonl dedup |
| `GET /api/costs/stream` | tail events.jsonl |
| `GET /api/costs/trends` | **store A** `getDailyTrends` |
| `GET /api/costs/by-model` | **store A** `getModelRollup` |
| `GET /api/costs/issue/:id` | **store A** `getCostForIssueFromDb` |
| `GET /api/costs/by-agent` | **store A** `getAgentRollup` |
| `POST /api/costs/sync-wal` | WAL import |
| `POST /api/costs/reconcile` | reconciler (transcripts → store A) |
| `GET /api/costs/experiments` | **store A** `getCavemanExperimentData` → DEAD |
| `GET /api/costs/background` | **store A** `getBackgroundCostBySource` |

### Scattered (5 modules)
| Endpoint | Module:line | Backing | Note |
| --- | --- | --- | --- |
| `GET /api/agents/:id/cost` | `agents.ts:2305` | **re-parses `~/.claude/projects` JSONL live** | A **fourth** independent token-summing implementation with its own dedup — bypasses `cost_events` entirely. Collapse into the resolver. |
| `GET /api/issues/:id/costs` | `issues.ts:3920` | **store B** `getCostsForIssueSync` + live-agent resolver | Uses the redundant JSON cache, not SQLite. Repoint at resolver. |
| `GET /api/metrics/costs` | `metrics.ts:124` | **store C** `getCostSummary()` | Reads dead `cost-data.json` → empty. Rederive from resolver or delete. |
| `GET /api/specialists/:name/cost` | `specialists.ts:902` | **hardcoded `{cost:0,…}`** | **DEAD stub.** Returns zeros unconditionally. Delete. |
| `GET /api/discovered-sessions/cost` | `discovered-sessions.ts:358` | `discovered_sessions` table (different domain) | Conversation-cost, NOT `cost_events`. Out of scope but note the naming overlap. |

**Consolidation target:** one `CostResolver` over `cost_events` exposing
`{byIssue, byAgent, byModel, byDay, byStage, byBackgroundSource, issueDetail}`,
fed by one writer. Delete the `/api/agents/:id/cost` re-parser, the `/specialists`
stub, store B and store C, and repoint the issues/metrics endpoints at the
resolver.

---

## 6. PAN-1935 — the pi/kimi spend gap (precise mechanism)

The claim "pi/kimi spend isn't captured" is **half true and the nuance matters
for the fix.** Empirical provider distribution:

| provider | rows | USD | source breakdown |
| --- | --- | --- | --- |
| anthropic | 344,809 | $41,732 | live hook + reconciler |
| **custom** (kimi/MiniMax) | **50,973** | **$1,456** | 34,809 live-hook + 16,164 reconciler |
| openai | 128 | $17 | 126 live-hook + 2 |

So **kimi IS captured** (34,546 `kimi-for-coding` rows; 13,373 MiniMax-highspeed)
— **but only when the kimi agent runs under Claude Code via CLIProxy.** In that
mode the transcript lands in `~/.claude/projects/`, the live hook fires
(`PostToolUse`), and the model-name inference (`reconciler.ts:291-292`,
`record-cost-event.ts`) tags it `provider=custom`. Both ingest paths see it.

**The actual gap is harness-native pi and codex agents.** Both ingest paths are
hardcoded to `~/.claude/projects/`:
- **Live hook** is a Claude Code `PostToolUse` hook — it never fires for a pi or
  codex session (those harnesses don't run Claude Code's hook system).
- **Reconciler** scans `getClaudeProjectsDir()` = `~/.claude/projects/` only
  (`reconciler.ts:71,334`). It never looks at `~/.pi/agent/sessions/` or codex
  session dirs.

Meanwhile **the parsers already exist and already compute usage**:
`parsePiSessionSync` (`cost-parsers/pi-parser.ts`) and `parseCodexSessionSync`
(`cost-parsers/codex-parser.ts`). But they are wired **only to
`runtimes/pi.ts` / `runtimes/codex.ts` for live cost display** — their output
**never reaches `appendCostEventSync` or `insertCostEvents`** (verified: zero
cost-event writes in either runtime). So a pi or codex agent run on its native
harness produces **no `cost_events` row at all** — invisible to every rollup and
to `closeOut.usage`.

**What the Cost domain must fix:** extend the **one reconciler** to sweep the pi
and codex session directories using the **existing** pi/codex parsers, emitting
`CostEvent`s through the same `insertCostEvents` path (with `provider` set from
the parser's `provider`/`model`, not name-substring inference). This is exactly
the harness-aware **single writer** the epic wants — the parsers are done; only
the sweep + attribution wiring is missing.

---

## 7. Retention — 395k unbounded rows (1.4 GB DB)

**There is no DB retention today.** Findings:
- `pruneOldEventsSync(90)` (`retention.ts:28`) exists but is **never called** —
  only re-exported through `costs/index.ts`. No scheduler, no CLI verb, no deacon
  patrol invokes it.
- Even if called, it prunes **events.jsonl only** — there is **no
  `DELETE FROM cost_events` anywhere** in the codebase. The SQLite table grows
  unbounded.

**Growth curve (measured):**

| month | rows | USD |
| --- | --- | --- |
| 2026-02 | 56,726 | $7,784 |
| 2026-03 | 278,673 | $15,662 |
| 2026-04 | 49,892 | $3,188 |
| 2026-06 | 6,655 | $1,269 |

(2025-12 shows $15,276 over 2,439 rows — an **unexplained ~110× per-row cost
outlier**, likely a historical cost-calculation bug, not a dedup artifact; see §2.
It does not affect row-count growth.) The table is 395,910 rows / 1.4 GB and the
DB is the single biggest growth driver.

**Recommendation — bound the DB cache; keep durable totals in the record:**
1. **Per-issue closed work is already snapshotted** in `closeOut.usage`
   (records.ts). Once an issue is closed and its record written, its
   `cost_events` rows are **pure ephemera** — the durable total survives. Prune
   them aggressively.
2. **Rolling window for the live cache.** Keep ~90 days (or "all in-flight issues
   + last 90 days") of `cost_events`; `DELETE` older rows in a deacon patrol.
   Anything pruned is rebuildable from transcripts/events.jsonl/WAL and its
   per-issue total is preserved in the record.
3. **Keep events.jsonl + WALs as the unbounded archive** (they are the
   source-of-truth union and are cheap text). Apply `pruneOldEventsSync` to
   events.jsonl only if disk pressure demands it, and only after confirming the
   WALs/records cover the pruned span.
4. **Drop the 6 DEAD columns** (`tldr_*`, `caveman_variant`) and the redundant
   stores B/C — removes write amplification and shrinks each row.

Net retention posture: **the DB becomes a bounded live-window cache; the durable
per-issue answer lives in the permanent record; the unbounded archive is
text-file events.jsonl + git-tracked WALs.**

---

## Surprises

1. **The whole table is cache, but from a 3-file union — not one JSONL.** The
   reconciler and sync-wal write to SQLite without touching events.jsonl, and
   background-AI rows have no transcript. Rebuild = `reconcile(transcripts) ∪
   replay(events.jsonl) ∪ import(WALs)`. Any single-source rebuild silently drops
   rows.

2. **Four parallel cost stores, three of them redundant.** SQLite `cost_events`
   (store A) is the real one. `aggregator.ts` `cache.json` (store B, from
   events.jsonl) and `cost-monitor.ts` `cost-data.json` (store C) are separate
   rollup stores serving overlapping questions from different sources.
   `/api/agents/:id/cost` is a **fourth** ad-hoc re-parse of raw transcripts. One
   resolver replaces all four.

3. **`cost-monitor.ts` is dead.** `recordCostSync` has **zero callers**, so
   `cost-data.json` is never written, `/api/metrics/costs` returns empty, and the
   cost-limit circuit breaker `checkCostLimits` gates on never-incremented data —
   the daily-spend safety limit is effectively non-functional.

4. **Five of 20 columns are 0% populated.** All four `tldr_*` columns and
   `caveman_variant` are NULL in **all 395,910 rows** — droppable. (`id` is the PK;
   keep it, but it has no semantic value.) The DB has been carrying dead
   experiment/metric scaffolding at full row scale.

9. **The stored `cost` for 2025-12 is wrong.** 2,439 rows hold $15,276 — 35% of
   all dollars in 0.6% of rows, avg $6.26 vs ~$0.056 baseline, max exactly $50.00,
   all `claude-sonnet-4`. A likely legacy cost-calc/pricing bug. Tokens are intact;
   this is why the rebuild should recompute `cost` from tokens rather than trust
   stored USD (§2).

5. **kimi IS captured; the gap is native pi/codex.** 50,973 `custom`-provider
   rows ($1,456) prove kimi-via-CLIProxy flows through both ingest paths. PAN-1935
   is specifically about **harness-native pi and codex** sessions whose dirs the
   reconciler never scans — and the parsers to read them already exist, just
   unwired from ingestion.

6. **`request_id` — the dedup guarantee — is NULL on 66% of rows.** 260,109 /
   395,910 rows have no `request_id`, falling back to the fragile 60-second-window
   heuristic for dedup. The UNIQUE index protects only the 34% that have one. A
   rebuild leans heavily on the heuristic for the majority.

7. **`/api/specialists/:name/cost` is a hardcoded zero stub** — returns
   `{cost:0,…}` unconditionally. Pure dead endpoint.

8. **The durable per-issue total already exists** in `closeOut.usage`
   (`records.ts`). The DB never needs to be the long-term source of per-issue
   cost — which is exactly what makes aggressive DB retention safe.
