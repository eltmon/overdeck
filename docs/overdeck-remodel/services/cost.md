# Overdeck — The Cost Domain (Effect API tier)

> **Status:** the Cost domain, built to the proof-of-shape established by
> [`issues.md`](issues.md). Grounded in a no-loss mapping of the real current
> cost surface (Part 1), then the Effect v4-beta services derived from that
> mapping (Part 2). Every service method traces to a Part-1 row; no column or
> endpoint is invented.
>
> **Operator goal — functional parity, NOT cache-purity.** Preserve every
> existing cost capability; drop only the redundant/wrong ways of doing it. The
> companion audit ([`../investigations/cost-audit.md`](../investigations/cost-audit.md))
> leads with "the whole table is pure cache / prove derivability"; this design
> does **not** inherit that headline. Derivability is a true property and is kept
> as a property (the locked schema already recomputes `cost` on rebuild), but the
> design driver here is parity, and parity forces fixing two things the collapse
> exposes as broken (see headline finding).
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `cost_events` table, 14 NEED cols), [`issues.md`](issues.md) (the
> keystone domain / template), and the evidence audit
> [`../investigations/cost-audit.md`](../investigations/cost-audit.md).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **`cost_events`** — the SQLite cache table
  ([`../overdeck-schema.ts`](../overdeck-schema.ts) lines 173-195). One row per
  deduplicated assistant API response: tokens + computed USD + attribution. 14
  NEED columns (the 4 `tldr_*` + `caveman_variant` columns dropped — 0/395,910
  populated, cost-audit §1).
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  domain's cache. Returns validated rollup entities. Replaces the **5 modules /
  18 endpoints** that read cost today.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  cache. Persists to the durable archive (events.jsonl + per-project WAL) first
  where applicable, then the cache, deduped on `request_id`. Replaces the **3
  write entry points + 2 maintenance sweeps** that ingest cost today.
- **Ingest** — turning a raw harness transcript / cost line into a `CostEvent`
  and recording it. The single writer verb `record(event)` owns the
  DB+events.jsonl+WAL fan-out.
- **Rollup** — a cross-`cost_events` aggregate (`GROUP BY issue / agent / model /
  day / stage / source`). **No materialized rollup table exists** — every rollup
  is computed-on-read (cost-audit §3). "Kill rollups" means *consolidate four
  parallel compute-on-read implementations into one resolver*, not delete stored
  truth.
- **Store** — one of the four parallel cost stores the audit found
  (cost-audit §3, surprise #2): **store A** = SQLite `cost_events` (the real one,
  kept); **store B** = `aggregator.ts` `cache.json` (redundant JSON rollup from
  events.jsonl, deleted); **store C** = `cost-monitor.ts` `cost-data.json` (dead
  rollup, deleted); the **ad-hoc re-parse** of raw transcripts in
  `/api/agents/:id/cost` (a fourth implementation, collapsed).
- **Durable per-issue total** — `closeOut.usage` in the git permanent record
  ([`src/lib/pan-dir/records.ts`](../../../src/lib/pan-dir/records.ts) lines
  116-128, `projectUsage`). The one cost rollup that **should** be durable — a
  per-issue snapshot at the pricing-as-of moment, surviving DB wipe. KEEP. It
  already reads from store A and repoints onto the resolver for free.
- **Breaker** — the cost-limit circuit breaker `checkCostLimits`
  ([`src/lib/cloister/cost-monitor.ts`](../../../src/lib/cloister/cost-monitor.ts)
  line 187), called from `Cloister.service`
  ([`src/lib/cloister/service.ts`](../../../src/lib/cloister/service.ts) line
  1589). It **emits `cost_alert` events — it does NOT hard-stop agents.** Today
  it gates on store C, which nothing writes, so it is **dead** — see headline.
- **Relocate** — a disposition: the current endpoint is **not lost and not
  Cost's to own**; it maps to a *sibling* domain (Conversations). Distinct from
  DELETE (genuinely dropped).
- **DEAD** — written never, or written but read by nothing live; a deliberate
  DELETE with its reason.

---

## ⚠️ Headline finding — parity forces fixing two writes the store-collapse exposes as broken

The cost-audit's headline ("the whole `cost_events` table is pure cache") is a
derivability claim. Under the operator's **parity** lens it is the wrong
headline, because the table being rebuildable is *not* the thing at risk —
**nothing about the live surface changes if you can or can't rebuild it.** The
parity-sharp finding is this:

> **Four cost stores, three redundant. Collapsing them to one resolver loses no
> stored truth — but parity forces fixing two writes the collapse exposes as
> already broken: (1) the cost-limit breaker gates on a store nothing writes, so
> it is silently non-functional; and (2) native pi/codex spend is never ingested
> at all (PAN-1935), so it is invisible to every rollup and to `closeOut.usage`.**

Both are *current functionality gaps that the redundant-store sprawl was hiding.*
A faithful parity remodel must carry them over **working**, not carry over the
broken state:

| Broken today | Why it's broken | Parity fix in this design |
|---|---|---|
| **Cost-limit breaker** (`checkCostLimits`, cost-monitor.ts:187) | Reads `costData` (store C, in-memory mirror of `cost-data.json`). The only writer of `costData` is `recordCostSync` (cost-monitor.ts:159), which has **ZERO callers** (verified across `src/` + `sync-sources/`). So `cost-data.json` is never incremented; the breaker always sees `$0`; `/api/metrics/costs` returns empty. | DELETE store C + `recordCostSync`. **Re-wire** `checkCostLimits` onto `CostResolver` totals (daily ← `byDay`, per-agent ← `byAgent`, per-issue ← `byIssue`; cost-audit §3 confirms these produce exactly the needed numbers). Preserve today's behavior: it still **emits `cost_alert`**, does not hard-stop. |
| **Native pi/codex spend** (PAN-1935) | Both ingest paths are hardcoded to `~/.claude/projects/`: the live hook is a Claude Code `PostToolUse` hook (never fires for pi/codex); the reconciler scans `getClaudeProjectsDir()` only (reconciler.ts:71,334). The parsers `parsePiSessionSync` / `parseCodexSessionSync` exist and compute usage, but are wired **only** to `runtimes/pi.ts:206` / `runtimes/codex.ts:457` for live display — their output never reaches `appendCostEventSync`/`insertCostEvents`. | Extend the **one** `CostWriter.reconcile()` to also sweep the pi and codex session dirs using the **existing** parsers, emitting `CostEvent`s through the same `record()` path (provider from the parser, not name-substring inference). The parsers are done; only the sweep + attribution wiring is missing. |

This is the most valuable finding under a parity charter: the remodel is not just
moving cost reads behind a door — it is the moment the two long-dead cost writes
get fixed, because the door makes their brokenness visible and gives them one
correct home.

A secondary parity note, surfaced loudly so it is not silently dropped: the
**store-B per-issue-budget** feature (`setIssueBudgetSync`, the
`budget`/`budgetWarning` fields on the by-issue reads) lives ONLY in store B and
has **zero live callers** (`setIssueBudget` is only re-exported through
`costs/index.ts:40,50`). The fields are therefore *always* empty
(`budget: undefined`, `budgetWarning: false`, issues.ts:3953-3954). Deleting
store B drops a feature that never functioned — clean DELETE, no parity loss.
**This is NOT the `pan cost budget` CLI family** (`budgets.json` via
`createBudgetSync`/`getAllBudgetsSync`/etc., `lib/cost.ts:429-534`), which is a
separate, live store with a live caller and is **preserved** behind real Cost
doors — see §1B. Called out here so the store-B drop is a recorded decision, and
so the live CLI budget family is not swept up with it.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, ingest call-site, `pan` CLI verb, RPC
method) that **reads or writes `cost_events`** — rollups, ingest, maintenance —
with its new home. Disposition is one of four:

- **READ →** a `CostResolver` method.
- **WRITE →** a `CostWriter` verb (`record` / `reconcile` / `rebuild`).
- **RELOCATE →** a *sibling* domain (Conversations). Not lost, not Cost's to own.
- **DELETE →** deliberately dropped (redundant store, dead endpoint, or folded
  into another), with the reason.

Stores legend used in reasons: **A** = SQLite `cost_events` (kept) · **B** =
`aggregator.ts` `cache.json` (deleted) · **C** = `cost-monitor.ts`
`cost-data.json` (deleted) · **archive** = the durable union {Claude transcripts}
∪ {events.jsonl} ∪ {per-project WALs}.

## 1A. HTTP endpoints

### Reads (rollups over cost) → `CostResolver`

The **18 cost read endpoints across 5 modules** (API-SURFACE §F). Each maps to a
resolver method; the 5 modules collapse to **one** `CostResolver`.

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/costs/summary` (`costs.ts:44`) | reads | **`CostResolver.summary(window, project?)`** | today / 7d / 30d windowed totals + per-model, with optional `?project=<PREFIX>` scope (costs.ts:48-86). Reads events.jsonl today; resolver reads store A. A distinct window-rollup — **not** `byDay`. |
| `GET /api/costs/by-issue` (`costs.ts:97`) | reads | **`CostResolver.byIssue()`** | All-issue rollup. Today **store A** `getCostsByIssueFromDb` (cost-events-db.ts:359). |
| `GET /api/costs/issue/:id` (`costs.ts:266`) | reads | **`CostResolver.issueDetail(id)`** | One issue's detail (models + stages). Today **store A** `getCostForIssueFromDb` (cost-events-db.ts:401). |
| `GET /api/costs/trends` (`costs.ts:224`) | reads | **`CostResolver.byDay(days, issue?)`** | Per-day trend. Today **store A** `getDailyTrends` (cost-events-db.ts:440). |
| `GET /api/costs/by-model` (`costs.ts:246`) | reads | **`CostResolver.byModel(issue?)`** | Per-model rollup. Today **store A** `getModelRollup` (cost-events-db.ts:478). |
| `GET /api/costs/by-agent` (`costs.ts:288`) | reads | **`CostResolver.byAgent(issue?)`** | Per-agent rollup. Today **store A** `getAgentRollup` (cost-events-db.ts:506). |
| `GET /api/costs/background` (`costs.ts:349`) | reads | **`CostResolver.byBackgroundSource(hours)`** | Background-AI spend per `source_file` (PAN-1589). Today **store A** `getBackgroundCostBySource` (cost-events-db.ts:227). |
| `GET /api/costs/stream` (`costs.ts:188`) | reads | **`CostResolver.recent(limit, since?)`** + RPC live sub | Recent events grouped by issue. Today tails events.jsonl; resolver reads store A. The **live** form maps to the RPC subscription (§1C), grounded in this endpoint — not invented. |
| `GET /api/costs/experiments` (`costs.ts:339`) | reads | **DELETE** | Caveman A/B (`getCavemanExperimentData`, cost-events-db.ts:580) GROUP BY `caveman_variant` — **0/395,910 rows populated**; column dropped from the locked schema; experiment (PAN-611) concluded. |
| `GET /api/agents/:id/cost` (`agents.ts:2302`) | reads | **`CostResolver.byAgent(issue?)`** (filter to one agent) | A **fourth** independent token-summing impl that re-parses `~/.claude/projects` JSONL live with its own dedup (agents.ts:2323-2356), bypassing `cost_events`. **Keep the path, swap the backing** to the resolver. The ad-hoc re-parser is deleted. |
| `GET /api/issues/:id/costs` (`issues.ts:3918`) | reads | **`CostResolver.issueDetail(id)`** (+ live-agent overlay) | Today reads **store B** `getCostsForIssueSync` (aggregator.ts:318). **Keep the path, repoint** at store A via the resolver. The `resolveIssueHeadlineCost` live-agent overlay (issues.ts:3929) is preserved at the controller. The `budget`/`budgetWarning` fields (issues.ts:3984-3985) become constant-empty — already are (dead feature). |
| `GET /api/metrics/costs` (`metrics.ts:124`) | reads | **`CostResolver.summary("day")` → `{dailyTotal, topAgents, topIssues}`** | Today reads **store C** `getCostSummary()` → empty (dead). **Keep the path, rederive** the same shape from the resolver (daily total + top-N agents/issues — `byDay` + `byAgent` + `byIssue` already produce exactly these, cost-audit §3). |
| `GET /api/specialists/:name/cost` (`specialists.ts:902`) | reads | **DELETE** | Hardcoded zero stub — returns `{cost:0,…}` unconditionally (specialists.ts:903). Pure dead endpoint. |
| `GET /api/discovered-sessions/cost` (`discovered-sessions.ts:358`) | reads | **RELOCATE → Conversations** | Conversation-cost over the `discovered_sessions` table — a different domain. Out of scope; noted only for the naming overlap (cost-audit §5). |

### Writes (ingest + maintenance) → `CostWriter`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/costs/reconcile` (`costs.ts:322`) | writes | **`CostWriter.reconcile()`** | Catch-up sweep of transcripts → store A (`reconcile`, reconciler.ts). **PAN-1935 lands here**: the sweep extends to pi + codex session dirs via the existing parsers (headline). |
| `POST /api/costs/sync-wal` (`costs.ts:308`) | writes | **`CostWriter.reconcile({ source: "wal" })`** | Imports per-project WALs → store A (`syncWalFromAllProjects`, sync-wal.ts). A reconcile variant — same ingest verb, different source. |
| `POST /api/costs/rebuild` (`costs.ts:140`) | writes | **`CostWriter.rebuild()`** | Full rebuild. Today migrates sessions + rebuilds **store B** cache (`migrateAllSessionsSync` + `rebuildCacheSync`). Under one store, rebuild = recompute store A from the archive union (recompute `cost` from tokens, per locked schema). |
| `POST /api/costs/deduplicate` (`costs.ts:170`) | writes | **DELETE** | `deduplicateEventsSync` manually de-dups events.jsonl. **Structural now:** the `UNIQUE(request_id) WHERE request_id IS NOT NULL` index (schema 194) + the 60s-window heuristic inside `record()` make dedup automatic on ingest. The manual endpoint is unnecessary — but **both dedup mechanisms are preserved in `record()`**, because `request_id` is NULL on 66% of rows (cost-audit surprise #6). |

### Ingest call-sites (the write fan-out behind the surface) → `CostWriter.record`

Not HTTP endpoints — the in-process functions that write `cost_events` today.
All collapse to **one** `record(event)` verb (cost-audit §1 "one writer").

| Current ingest site | New door | Reason |
|---|---|---|
| `appendCostEventSync` (`events.ts:102`) — live hook / background-AI / migration; fans out to DB + events.jsonl + WAL | **`CostWriter.record(event)`** | This IS the target fan-out. The single primitive that owns DB+events.jsonl+WAL + dedup. |
| `insertCostEvents` (batch) — reconciler (`reconciler.ts:405`) + sync-wal (`sync-wal.ts:65`), DB-only | **`CostWriter.record(event)`** (per event, via `reconcile`) | Today bypasses events.jsonl. Folds into `record()`; reconcile feeds it the same `CostEvent` shape. |
| `insertCostEvent` (single) — memory provider (`memory/providers/types.ts:119`) | **`CostWriter.record(event)`** | Same single-event path. |
| pi/codex live-cost parsers (`runtimes/pi.ts:206`, `runtimes/codex.ts:457`) — compute usage, **never persisted** | **`CostWriter.reconcile()` sweep → `record(event)`** | The PAN-1935 gap. Parsers exist; the sweep routes their output to `record()`. |

### Stores deleted outright (the redundancy kill-list, cost-audit §3)

| Store | Files / functions | Disposition | Reason |
|---|---|---|---|
| **Store B** — `aggregator.ts` `cache.json` | `loadCacheSync`/`saveCacheSync`/`syncCacheSync`/`rebuildCacheSync`/`getCostsForIssueSync`/`getCostsByIssueSync`/`setIssueBudgetSync` (aggregator.ts:70-349) | **DELETE** | A parallel per-issue rollup cache rebuilt from events.jsonl — a second answer to "what did this issue cost" from a different source than store A. `/api/issues/:id/costs` repoints at store A. The dead **store-B per-issue-budget** feature (zero `setIssueBudget` callers — the `setIssueBudgetSync` mechanism, NOT the live `pan cost budget` CLI family preserved in §1B) goes with it — no parity loss (headline). |
| **Store C** — `cost-monitor.ts` `cost-data.json` | `recordCostSync` (cost-monitor.ts:159, **zero callers**) + `getCostSummary` (321) + the `costData` map | **DELETE writer + store** | Never written → `/api/metrics/costs` empty + breaker dead. `checkCostLimits` **re-wires** onto the resolver (headline); `getCostSummary` shape rederived from `byDay`/`byAgent`/`byIssue`. |

## 1B. CLI verbs (`pan ...`)

**`pan cost` IS a live subcommand.** Verified: `createCostCommand()` is
registered via `program.addCommand(createCostCommand())`
([`src/cli/index.ts:1342`](../../../src/cli/index.ts)); the command is built in
[`src/cli/commands/cost.ts:103`](../../../src/cli/commands/cost.ts). It is a real
user surface and maps to Cost service members with **no loss**.

| Current verb (file:line) | r/w | New door | Reason / backing |
|---|---|---|---|
| `pan cost today` (`cost.ts:107`) | reads | **`CostResolver.summary("day")`** | `getDailySummarySync` — a windowed total + per-provider/per-model rollup (cost.ts:114). The resolver's `summary(window)` is exactly this window rollup. |
| `pan cost week` (`cost.ts:160`) | reads | **`CostResolver.summary("week")`** | `getWeeklySummarySync` — 7-day window total + per-provider + top issues (cost.ts:166). |
| `pan cost month` (`cost.ts:199`) | reads | **`CostResolver.summary("month")`** | `getMonthlySummarySync` — 30-day window total + per-model + top issues (cost.ts:205). |
| `pan cost report` (`cost.ts:246`) | reads | **`CostResolver.summary(window)` + report formatting** | `generateReportSync(start, end)` — a date-range report string (cost.ts:261). The resolver returns the numbers; the report string is formatted at the command (presentation stays in the CLI, not the door). |
| `pan cost issue <id>` (`cost.ts:269`) | reads | **`CostResolver.issueDetail(id)`** | `getCostForIssueFromDb(id)` (store A) with `readIssueCostsSync` fallback (cost.ts:276,284) — one issue's models/stages detail; the resolver's `issueDetail` already serves `GET /api/costs/issue/:id` (§1A). |
| `pan cost sync` (`cost.ts:447`) | writes | **`CostWriter.reconcile({ source: "wal" })`** | `runCostSync` → `syncWalFromAllProjects` (sync-wal.ts) — imports per-project WALs into store A. The same ingest verb as `POST /api/costs/sync-wal` (§1A), so it folds onto the same writer member. |
| `pan cost budget create <name>` (`cost.ts:318`) | writes | **`CostWriter.createBudget(spec)`** | `createBudgetSync` → `~/.panopticon/costs/budgets.json` (`lib/cost.ts:452`, `BUDGETS_FILE` cost.ts:429). A **live** store with a live caller (this CLI) — preserved, not deleted. |
| `pan cost budget list` (`cost.ts:348`) | reads | **`CostResolver.listBudgets()`** (+ `checkBudget` per row) | `getAllBudgetsSync` + `checkBudgetSync` (`lib/cost.ts:478,500`). |
| `pan cost budget check <id>` (`cost.ts:389`) | reads | **`CostResolver.checkBudget(id)`** | `checkBudgetSync(id)` — limit/spent/remaining/alert (`lib/cost.ts:500`). |
| `pan cost budget delete <id>` (`cost.ts:428`) | writes | **`CostWriter.deleteBudget(id)`** | `deleteBudgetSync(id)` (`lib/cost.ts:534`). |

**Budget home decision (functional parity).** The `pan cost budget *` family is
backed by `budgets.json` (`COSTS_DIR/budgets.json`, `lib/cost.ts:429`) via the
`createBudgetSync`/`getAllBudgetsSync`/`checkBudgetSync`/`deleteBudgetSync`
functions — a **distinct** store from the store-B `setIssueBudget` per-issue
rollup that §1A row "Store B" deletes. The CLI budget family has a live caller
(this command), so "zero live callers" does **not** apply to it. It is preserved
behind real Cost-domain doors: `CostResolver.listBudgets`/`checkBudget` (reads)
and `CostWriter.createBudget`/`deleteBudget` (writes), with `budgets.json` as the
budget store behind the writer. The deleted store-B `setIssueBudget` (§1A,
"Store B" row) is a separate, genuinely-dead per-issue-budget mechanism and is
unaffected by this preservation.

The cost-related scripts (`scripts/recover-costs.mjs`, `recover-costs-deep.mjs`,
`recover-costs-proportional.mjs`, `backfill-costs-pan1570.mts`) and the
token-spend-report skill remain **standalone one-off recovery/backfill tools** —
not `pan` verbs and out of scope for the domain doors; if ever promoted, the
natural home is `CostWriter.reconcile()` / `rebuild()`.

## 1C. RPC methods (`packages/contracts/src/rpc.ts`)

**`cost_events` has NO RPC method today.** Verified: the only cost RPCs are
`pan.getConversationCost` / `pan.getConversationCostByWorkspace`
(`rpc.ts:30-31`, impl `ws-rpc.ts:1064`), which aggregate the **`discovered_sessions`**
table — the **Conversations** domain, not `cost_events` (cost-audit §5).

| Current RPC method | r/w | New door | Reason |
|---|---|---|---|
| `pan.getConversationCost` (`rpc.ts:30`) | reads | **RELOCATE → Conversations** | Conversation-cost over `discovered_sessions`; sibling domain. |
| `pan.getConversationCostByWorkspace` (`rpc.ts:31`) | reads | **RELOCATE → Conversations** | Same. |
| *(none today for `cost_events`)* | — | **NEW `CostApi` RPC `cost.subscribe`** | The live cost stream the dashboard wants is served today by `GET /api/costs/stream` (HTTP tail). Maps to an RPC subscription fed by `CostWriter`'s `bus.emit` on `record()` — grounded in the existing stream endpoint (§1A), not invented. |

## 1D. Rollup of the collapse

| Surface | Current sites touching cost | New home |
|---|---|---|
| HTTP cost endpoints (cost-audit §5) | **18 across 6 modules** = **14 read + 4 write**. The 14 reads span **5 cost modules** {`costs`, `agents`, `issues`, `metrics`, `specialists`}; the 6th module `discovered-sessions` is the conversation domain (RELOCATE). | reads → **1 `CostResolver`**; writes → **`CostWriter`** |
| Cost **read** endpoints (the "5 read paths → 1") | **13 across the 5 cost modules** (`costs.ts` 9 reads + `/api/agents/:id/cost` + `/api/issues/:id/costs` + `/api/metrics/costs` + `/api/specialists/:name/cost`), **+1** `discovered-sessions` (6th module, conversation domain) = 14 total | **1 `CostResolver`** (9 event-cost methods; +2 budget reads from §1B = 11 total): of the 13 cost-module reads, **11 → methods** + **2 DELETE** (`experiments`, `specialists`); the +1 `discovered-sessions` → **RELOCATE** to Conversations (outside the 5) |
| Cost stores | **4** (A SQLite · B `cache.json` · C `cost-data.json` · ad-hoc re-parse) | **1** (store A behind the resolver); B + C + re-parser DELETE |
| HTTP ingest/maintenance endpoints | **4** (`reconcile`, `sync-wal`, `rebuild`, `deduplicate`) | **`CostWriter`** verbs `reconcile`/`rebuild`; `deduplicate` DELETE (structural) |
| Ingest call-sites (in-process) | **4** (`appendCostEventSync`, `insertCostEvents`, `insertCostEvent`, pi/codex parsers) | **1 `CostWriter.record(event)`** (with archive fan-out + dedup) |
| CLI verbs (`pan cost`) | **10** (`today`/`week`/`month`/`report`/`issue`/`sync` + `budget` create/list/check/delete) | reads → **`CostResolver`** (`summary`/`issueDetail`/`listBudgets`/`checkBudget`); writes → **`CostWriter`** (`reconcile`/`createBudget`/`deleteBudget`) — §1B |
| RPC methods over `cost_events` | **0** (the 2 existing are Conversations) | **1 new `cost.subscribe`** stream |

**DELETED outright** (5): `GET /api/costs/experiments` (caveman, 0/395,910),
`GET /api/specialists/:name/cost` (hardcoded zero stub), `POST /api/costs/deduplicate`
(dedup is structural), **store B** (`aggregator.ts` cache.json + the dead
store-B per-issue-budget feature `setIssueBudgetSync` — **not** the live
`pan cost budget` CLI family, §1B), **store C** (`cost-monitor.ts` cost-data.json
+ the zero-caller `recordCostSync`).

**Relocated, not lost** (the no-loss integrity column): conversation-cost
(`/api/discovered-sessions/cost`, `getConversationCost*`) → **Conversations**.

**Repointed, not dropped** (parity — keep the path, swap the backing): `GET
/api/agents/:id/cost`, `GET /api/issues/:id/costs`, `GET /api/metrics/costs` keep
their URLs; their handlers now read the one resolver instead of the four old
stores.

## 1E. What did NOT collapse cleanly — the genuine residue

After the collapse, the parity items that are *not* a pure read or a pure
`record()` and need an explicit decision:

1. **The breaker re-wire** (headline fix #1). `checkCostLimits` (cost-monitor.ts:187)
   is not a Cost door member — it is a **Cloister** consumer that reads cost
   totals. Its store (C) is deleted; it must be re-pointed at `CostResolver`
   (`byDay`/`byAgent`/`byIssue`). Recorded as a required cross-domain wiring
   change, preserving today's emit-only (non-blocking) behavior.
2. **The pi/codex reconcile sweep** (headline fix #2 / PAN-1935). The parsers are
   wired into `runtimes/pi.ts` / `runtimes/codex.ts` for **live display** —
   that wiring stays (live display is separate functionality). The **new** wiring
   is `CostWriter.reconcile()` calling the same parsers over the pi/codex session
   dirs to feed `record()`. Recorded as the one genuinely missing ingest path.
   **Archive semantics during reconcile** (an implementer would otherwise guess):
   today's reconciler writes the DB only and deliberately does **not** re-append
   to events.jsonl (cost-audit fact #1 — the transcript IS the durable backing for
   those rows, so a second copy in events.jsonl would be redundant). `record()`
   preserves that: when the event's durable source is a transcript/session file
   (`reconcile` path), the archive step is a **no-op** and the transcript is the
   backing; the events.jsonl/WAL append fires only for transcript-less events
   (live hook, background-AI) whose only durable home is the archive. Dedup
   (`request_id` UNIQUE) keeps the union idempotent either way.
3. **`closeOut.usage`** (the durable per-issue total, records.ts:116-128). NOT a
   Cost door member — it is a **permanent-record projection** that reads cost.
   Today it already reads store A (`getCostBreakdownByStageAndModel` +
   `getCostForIssueFromDb`); it repoints onto `CostResolver` for free. Kept as
   the one durable cost rollup (cost-audit §3). Recorded so the repoint is not
   missed.
4. **The `cost` recompute-on-rebuild** decision. `cost` is recomputed from tokens
   on `rebuild()` (locked schema lines 169-171; the stored 2025-12 USD has a
   legacy ~110× bug, cost-audit §2). Token columns are the durable truth; `cost`
   is derived. This is a `CostWriter.rebuild()` behavior, stated so the recompute
   is a recorded decision, not an accident.

**Deliberately NOT added** (parity, not gold-plating): no retention/prune verb —
`pruneOldEventsSync` (retention.ts:28) is **never called today** (cost-audit §7),
so DB retention is not current functionality. Noted as future work, not a door
member.

Everything else either reads through `CostResolver`, ingests through
`CostWriter.record`, relocates to Conversations, or is deleted with a reason.
Nothing real from the live surface is lost.

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md): `Context.Service`
(never `Effect.Service`), `effect/unstable/*` imports, Drizzle behind the `Db`
service, `Schema.Literals([...])` taking arrays, `Schema.TaggedErrorClass`,
source-first-then-cache writer ordering (§5). Every method below traces to a
Part-1 row. Columns are the locked `cost_events` 14-col set
([`../overdeck-schema.ts`](../overdeck-schema.ts) lines 173-195).

## 2.1 Entities & errors — `Schema`

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { and, eq, gte, sql } from "drizzle-orm"
import { costEvents } from "../overdeck-schema"            // the locked Drizzle table
import { Db, CostArchive, EventBus } from "./infra"        // Db = Drizzle handle; CostArchive = events.jsonl + WAL durable writer

// ── Branded ids (CONVENTIONS §2) ───────────────────────────────────────────
export const IssueId = Schema.String.pipe(Schema.brand("IssueId"))
export type  IssueId = typeof IssueId.Type
export const AgentId = Schema.String.pipe(Schema.brand("AgentId"))
export type  AgentId = typeof AgentId.Type

export const Provider = Schema.Literals(["anthropic", "openai", "google", "custom"])
export type Provider = typeof Provider.Type

// the one row the archive carries — maps 1:1 to the 14 NEED columns.
export const CostEvent = Schema.Struct({
  ts:          Schema.Date,
  issueId:     Schema.NullOr(IssueId),     // 12.5% UNKNOWN — first-class bucket, not silently mixed
  agentId:     Schema.NullOr(AgentId),
  sessionId:   Schema.NullOr(Schema.String),
  sessionType: Schema.NullOr(Schema.String), // pipeline stage (planning/implementation/review/…)
  provider:    Schema.NullOr(Provider),
  model:       Schema.NullOr(Schema.String),
  input:       Schema.Number,
  output:      Schema.Number,
  cacheRead:   Schema.Number,
  cacheWrite:  Schema.Number,
  cost:        Schema.Number,                // recomputed from tokens on rebuild
  requestId:   Schema.NullOr(Schema.String), // dedup key (NULL on ~66%)
  sourceFile:  Schema.NullOr(Schema.String), // provenance + rebuild-source discriminator
})
export type CostEvent = typeof CostEvent.Type

// ── Rollup success types (the resolver's return shapes) ────────────────────
const Tokens = Schema.Struct({
  input: Schema.Number, output: Schema.Number,
  cacheRead: Schema.Number, cacheWrite: Schema.Number,
})

export const Rollup = Schema.Struct({   // one bucket of any GROUP BY
  key:    Schema.String,                // issueId | agentId | model | YYYY-MM-DD | source_file | project prefix
  cost:   Schema.Number,
  tokens: Tokens,
})
export type Rollup = typeof Rollup.Type

export const Window = Schema.Literals(["day", "week", "month"])
export type Window = typeof Window.Type

export const WindowSummary = Schema.Struct({
  project: Schema.NullOr(Schema.String),
  window:  Window,
  totalCost:   Schema.Number,
  totalTokens: Schema.Number,
  entryCount:  Schema.Number,
  byModel:     Schema.Record(Schema.String, Schema.Number),
})
export type WindowSummary = typeof WindowSummary.Type

// per-issue detail: total + per-model + per-stage (issues.ts:3984 shape, parity)
export const IssueCost = Schema.Struct({
  issueId:    IssueId,
  totalCost:  Schema.Number,
  tokens:     Tokens,
  byModel:    Schema.Record(Schema.String, Rollup),
  byStage:    Schema.Record(Schema.String, Schema.Record(Schema.String, Tokens)),
})
export type IssueCost = typeof IssueCost.Type

// ── Budget entities — over the SEPARATE budgets.json store (not cost_events) ──
// Shape mirrors CostBudget in lib/cost.ts (the live store's record).
export const BudgetSpec = Schema.Struct({
  name:           Schema.String,
  type:           Schema.Literals(["daily","monthly","project","issue","feature"]),
  limit:          Schema.Number,
  currency:       Schema.String,           // "USD"
  alertThreshold: Schema.Number,           // 0..1
})
export type BudgetSpec = typeof BudgetSpec.Type

export const Budget = Schema.Struct({
  ...BudgetSpec.fields,
  id:      Schema.String,
  spent:   Schema.Number,
  enabled: Schema.Boolean,
})
export type Budget = typeof Budget.Type

export const BudgetStatus = Schema.Struct({
  budget:      Budget,
  percentUsed: Schema.Number,
  remaining:   Schema.Number,
  alert:       Schema.Boolean,
  exceeded:    Schema.Boolean,
})
export type BudgetStatus = typeof BudgetStatus.Type

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ─────────────────────
export class CostIngestError extends Schema.TaggedErrorClass<CostIngestError>()(
  "CostIngestError", { reason: Schema.String },
) {}
export class BudgetNotFound extends Schema.TaggedErrorClass<BudgetNotFound>()(
  "BudgetNotFound", { id: Schema.String },
) {}
```

## 2.2 `CostResolver` — the read door (`Context.Service`)

Eleven methods: nine per Part-1 §1A read row (the 5-module / 18-endpoint
collapse) plus two budget reads from the CLI parity (§1B). The nine event-cost
methods are computed-on-read `GROUP BY`s over store A — there is no materialized
rollup table (cost-audit §3). The two budget methods read the separate
`budgets.json` store (`lib/cost.ts:429`), not `cost_events`.

```ts
export class CostResolver extends Context.Service<CostResolver, {
  // GET /api/costs/summary — windowed totals + per-model, optional project scope
  readonly summary:   (window: Window, project?: string) => Effect.Effect<WindowSummary>
  // GET /api/costs/by-issue — all-issue rollup
  readonly byIssue:   () => Effect.Effect<ReadonlyArray<Rollup>>
  // GET /api/costs/issue/:id + /api/issues/:id/costs — one issue's detail
  readonly issueDetail: (id: IssueId) => Effect.Effect<IssueCost>
  // GET /api/costs/trends — per-day trend (optionally one issue)
  readonly byDay:     (days: number, issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>
  // GET /api/costs/by-model
  readonly byModel:   (issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>
  // GET /api/costs/by-agent + /api/agents/:id/cost
  readonly byAgent:   (issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>
  // GET /api/costs/background — per source_file, last N hours
  readonly byBackgroundSource: (hours: number) => Effect.Effect<ReadonlyArray<Rollup>>
  // "by project" dimension (task-required) — GROUP BY issue-id prefix (no project col)
  readonly byProject: () => Effect.Effect<ReadonlyArray<Rollup>>
  // GET /api/costs/stream — recent events (live form streams via cost.subscribe)
  readonly recent:    (limit: number, since?: Date) => Effect.Effect<ReadonlyArray<CostEvent>>
  // pan cost budget list — reads the budgets.json store (getAllBudgetsSync, lib/cost.ts:478)
  readonly listBudgets: () => Effect.Effect<ReadonlyArray<Budget>>
  // pan cost budget check <id> — limit/spent/remaining/alert (checkBudgetSync, lib/cost.ts:500)
  readonly checkBudget: (id: string) => Effect.Effect<BudgetStatus, BudgetNotFound>
}>()("overdeck/CostResolver") {}

export const CostResolverLayer = Layer.effect(CostResolver, Effect.gen(function* () {
  const { q } = yield* Db          // Drizzle handle — appears ONLY in resolver/writer Layer R

  const decodeEvent  = Schema.decodeUnknown(CostEvent)

  // example: byAgent — GROUP BY agent_id, optional issue filter (cost-events-db.ts:506)
  const byAgent = (issue?: IssueId) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      q.select({
        key:        costEvents.agentId,
        cost:       sql<number>`SUM(${costEvents.cost})`,
        input:      sql<number>`SUM(${costEvents.input})`,
        output:     sql<number>`SUM(${costEvents.output})`,
        cacheRead:  sql<number>`SUM(${costEvents.cacheRead})`,
        cacheWrite: sql<number>`SUM(${costEvents.cacheWrite})`,
      }).from(costEvents)
        .where(issue ? eq(costEvents.issueId, issue) : undefined)
        .groupBy(costEvents.agentId).all())
    return rows.map((r) => ({
      key: r.key ?? "unattributed",
      cost: r.cost,
      tokens: { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite },
    }))
  })

  // byIssue / byModel / byDay / byBackgroundSource / byProject follow the same
  // GROUP-BY shape (DATE(ts) for byDay; instr(issue_id,'-') prefix for byProject;
  // source_file for byBackgroundSource). issueDetail composes byModel(id) +
  // the stage breakdown (cost-events-db.ts:306 getCostBreakdownByStageAndModel).
  // summary windows the rows by ts and sums per-model (costs.ts:71-86 parity).

  const recent = (limit: number, since?: Date) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      q.select().from(costEvents)
        .where(since ? gte(costEvents.ts, since) : undefined)
        .orderBy(sql`${costEvents.ts} DESC`).limit(limit).all())
    return yield* Effect.forEach(rows, decodeEvent)
  })

  return CostResolver.of({
    summary, byIssue, issueDetail, byDay, byModel, byAgent,
    byBackgroundSource, byProject, recent, listBudgets, checkBudget,
  })
}))
```

> **Budget verbs read a second store.** `listBudgets`/`checkBudget` read
> `budgets.json` (`COSTS_DIR/budgets.json`, `lib/cost.ts:429`) via
> `getAllBudgetsSync`/`checkBudgetSync` — a small JSON file, not `cost_events`.
> It is modeled the same way Memory models `memory-search.db` as a second store
> behind one resolver: the budget store stays distinct, the read door is shared.
> The budget verbs take a **`BudgetStore`** handle in their Layer's `R` (alongside
> `Db`), à la `MemorySearch` — `Db` covers only `cost_events`. `Budget`/
> `BudgetStatus`/`BudgetSpec`/`BudgetNotFound` (§2.1) are the Schemas/errors over
> that store's shape (`CostBudget` in `lib/cost.ts`).

## 2.3 `CostWriter` — the write door (`Context.Service`)

Five verbs. Three over `cost_events`, derived from Part-1 §1A writes + ingest
call-sites: `record` (absorbs the 4 ingest sites), `reconcile` (the catch-up
sweep — **PAN-1935 lands here**), `rebuild` (full recompute). `deduplicate` is
**not** a verb — dedup is structural, applied inside `record()`. Two over the
`budgets.json` store, from the CLI parity (§1B): `createBudget`, `deleteBudget`.

```ts
export class CostWriter extends Context.Service<CostWriter, {
  // the ONLY ingest primitive — absorbs appendCostEventSync + insertCostEvent[s].
  // Owns archive fan-out (events.jsonl + WAL) AND dedup (request_id UNIQUE +
  // 60s-window heuristic for the 66% NULL).
  readonly record: (event: CostEvent) => Effect.Effect<void, CostIngestError>

  // catch-up sweep. source "claude" (default) | "pi" | "codex" | "wal".
  // PAN-1935: "pi"/"codex" sweep the native session dirs via the EXISTING
  // parsePiSessionSync / parseCodexSessionSync, feeding record().
  readonly reconcile: (opts?: { source?: "claude" | "pi" | "codex" | "wal" }) =>
    Effect.Effect<{ imported: number }, CostIngestError>

  // full rebuild of store A from the archive union; recomputes `cost` from
  // tokens (stored USD has a legacy bug — locked schema 169-171).
  readonly rebuild: () => Effect.Effect<{ events: number }, CostIngestError>

  // pan cost budget create <name> — writes budgets.json (createBudgetSync, lib/cost.ts:452)
  readonly createBudget: (spec: BudgetSpec) => Effect.Effect<Budget, CostIngestError>
  // pan cost budget delete <id> — removes from budgets.json (deleteBudgetSync, lib/cost.ts:534)
  readonly deleteBudget: (id: string) => Effect.Effect<void, BudgetNotFound>
}>()("overdeck/CostWriter") {}

export const CostWriterLayer = Layer.effect(CostWriter, Effect.gen(function* () {
  const { q }   = yield* Db          // Drizzle handle (cost_events only)
  const archive = yield* CostArchive // events.jsonl + per-project WAL — the durable backing
  const bus     = yield* EventBus

  // dedup: skip if request_id already present; else 60s-window heuristic on
  // (issueId, model, ts±60s) for the 66% of rows with no request_id.
  const isDuplicate = (e: CostEvent): boolean => /* … */ false

  const record = (event: CostEvent) => Effect.gen(function* () {
    if (isDuplicate(event)) return

    // 1. DURABLE ARCHIVE FIRST — events.jsonl + WAL carry the computed USD
    //    verbatim (CONVENTIONS §5 ordering). Background-AI / live-hook rows have
    //    no transcript, so the archive is their only durable source. For
    //    transcript-backed reconcile rows the transcript IS the backing, so this
    //    is a no-op (cost-audit fact #1; see §1E.2) — never a redundant 2nd copy.
    yield* archive.append(event)   // archive decides no-op vs append by event source

    // 2. THEN the cache — synchronous, failure-checked (never fire-and-forget).
    //    UNIQUE(request_id) makes the INSERT idempotent on re-import.
    yield* Effect.sync(() =>
      q.insert(costEvents).values({
        ts: event.ts, issueId: event.issueId, agentId: event.agentId,
        sessionId: event.sessionId, sessionType: event.sessionType,
        provider: event.provider, model: event.model,
        input: event.input, output: event.output,
        cacheRead: event.cacheRead, cacheWrite: event.cacheWrite,
        cost: event.cost, requestId: event.requestId, sourceFile: event.sourceFile,
      }).onConflictDoNothing().run())

    // 3. ANNOUNCE — cost.subscribe + /api/costs/stream feed from this.
    yield* bus.emit({ type: "cost.recorded", payload: { issueId: event.issueId, cost: event.cost } })
  })

  // reconcile: for each transcript/session new to the archive, parse → record().
  // claude → ~/.claude/projects (reconciler.ts); pi/codex → native dirs via the
  // existing parsers (the PAN-1935 wiring); wal → per-project WAL import.
  const reconcile = (opts?: { source?: "claude" | "pi" | "codex" | "wal" }) =>
    Effect.gen(function* () { /* sweep dirs, record() each new event */ return { imported: 0 } })

  // rebuild: reconcile(claude) ∪ replay(events.jsonl) ∪ import(WALs), recompute
  // cost from tokens. Idempotent via request_id UNIQUE.
  const rebuild = () => Effect.gen(function* () { /* … */ return { events: 0 } })

  return CostWriter.of({ record, reconcile, rebuild })
}))
```

> **Why `CostWriter`'s `R` is clean.** Its dependencies are `Db` (the
> `cost_events` table only), `CostArchive` (events.jsonl + WAL), and `EventBus`.
> It never receives `agents`, `issues`, or `issue_policy` — so it physically
> cannot write a sibling domain's cache. The breaker that *consumes* cost totals
> lives in Cloister and reads `CostResolver`; it never reaches into `CostWriter`.

## 2.4 `CostApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the two
services; the handler's `R` is `CostResolver | CostWriter`, never `Db`
(CONVENTIONS §7 door enforcement). Endpoints trace to the Part-1 collapse and
**preserve the existing URLs** (parity) — including the three repointed scattered
paths.

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const CostApi = HttpApiGroup.make("costs")
  // ── reads (the 18-endpoint collapse) ──
  .add(HttpApiEndpoint.get("summary", "/costs/summary", {
    urlParams: Schema.Struct({ window: Schema.optional(Window), project: Schema.optional(Schema.String) }),
    success:   WindowSummary,
  }))
  .add(HttpApiEndpoint.get("byIssue", "/costs/by-issue", { success: Schema.Array(Rollup) }))
  .add(HttpApiEndpoint.get("issueDetail", "/costs/issue/:id", {
    params: Schema.Struct({ id: IssueId }), success: IssueCost,
  }))
  .add(HttpApiEndpoint.get("byDay", "/costs/trends", {
    urlParams: Schema.Struct({ days: Schema.optional(Schema.NumberFromString), issueId: Schema.optional(IssueId) }),
    success: Schema.Array(Rollup),
  }))
  .add(HttpApiEndpoint.get("byModel", "/costs/by-model", {
    urlParams: Schema.Struct({ issueId: Schema.optional(IssueId) }), success: Schema.Array(Rollup),
  }))
  .add(HttpApiEndpoint.get("byAgent", "/costs/by-agent", {
    urlParams: Schema.Struct({ issueId: Schema.optional(IssueId) }), success: Schema.Array(Rollup),
  }))
  .add(HttpApiEndpoint.get("byBackgroundSource", "/costs/background", {
    urlParams: Schema.Struct({ hours: Schema.optional(Schema.NumberFromString) }), success: Schema.Array(Rollup),
  }))
  // NEW affordance — grounded in summary?project= (the only project surface
  // today is a query param); promotes the task-required "by project" dimension
  // to its own endpoint. The sole net-new URL; everything else preserves a path.
  .add(HttpApiEndpoint.get("byProject", "/costs/by-project", { success: Schema.Array(Rollup) }))
  .add(HttpApiEndpoint.get("recent", "/costs/stream", {
    urlParams: Schema.Struct({ limit: Schema.optional(Schema.NumberFromString), since: Schema.optional(Schema.String) }),
    success: Schema.Array(CostEvent),
  }))
  // ── writes (ingest + maintenance) ──
  .add(HttpApiEndpoint.post("reconcile", "/costs/reconcile", {
    payload: Schema.Struct({ source: Schema.optional(Schema.Literals(["claude", "pi", "codex", "wal"])) }),
    success: Schema.Struct({ imported: Schema.Number }), error: CostIngestError,
  }))
  .add(HttpApiEndpoint.post("rebuild", "/costs/rebuild", {
    success: Schema.Struct({ events: Schema.Number }), error: CostIngestError,
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(CostApi) /* .add(IssuesApi) … */

// handlers: pure delegation. R = CostResolver | CostWriter — never Db.
export const CostApiLive = HttpApiBuilder.group(OverdeckApi, "costs", (h) =>
  h.handle("summary",            ({ urlParams }) => CostResolver.summary(urlParams.window ?? "day", urlParams.project))
   .handle("byIssue",            ()              => CostResolver.byIssue())
   .handle("issueDetail",        ({ path })      => CostResolver.issueDetail(path.id))
   .handle("byDay",              ({ urlParams }) => CostResolver.byDay(urlParams.days ?? 30, urlParams.issueId))
   .handle("byModel",            ({ urlParams }) => CostResolver.byModel(urlParams.issueId))
   .handle("byAgent",            ({ urlParams }) => CostResolver.byAgent(urlParams.issueId))
   .handle("byBackgroundSource", ({ urlParams }) => CostResolver.byBackgroundSource(urlParams.hours ?? 24))
   .handle("byProject",          ()              => CostResolver.byProject())
   .handle("recent",             ({ urlParams }) => CostResolver.recent(urlParams.limit ?? 50, urlParams.since ? new Date(urlParams.since) : undefined))
   .handle("reconcile",          ({ payload })   => CostWriter.reconcile(payload))
   .handle("rebuild",            ()              => CostWriter.rebuild()))
```

**The three repointed scattered paths keep their URLs**, served by a sibling
controller delegating to `CostResolver`: `/api/agents/:id/cost` (AgentsApi →
`CostResolver.byAgent`, filtered), `/api/issues/:id/costs` (IssuesApi →
`CostResolver.issueDetail` + the live-agent overlay), `/api/metrics/costs`
(MetricsApi → `CostResolver.summary("day")` shaped to `{dailyTotal, topAgents,
topIssues}`). Cross-domain reuse of the one resolver — no second cost door.

The dashboard's live RPC surface (CONVENTIONS §8) adds `cost.subscribe`, fed by
`CostWriter`'s `bus.emit` on `record()` — the live form of `/api/costs/stream`.
HTTP and RPC reuse the **same** resolver/writer, so they cannot diverge.

## 2.5 Cross-domain consumers (not Cost doors, but cost-dependent)

Two consumers read cost but are NOT Cost service members — recorded so their
repoint is not missed (Part-1 §1E):

```ts
// Cloister breaker (headline fix #1) — re-pointed off dead store C onto the
// resolver. Emits cost_alert; does NOT hard-stop (today's behavior preserved).
const checkCostLimits = (agentId: AgentId, issueId: IssueId | undefined) =>
  Effect.gen(function* () {
    const resolver = yield* CostResolver
    const daily    = yield* resolver.byDay(1)               // daily total
    const perAgent = yield* resolver.byAgent()              // per-agent
    const perIssue = issueId ? yield* resolver.byIssue() : []
    // …compare to cost_limits config, emit cost_alert events…
  })

// records.ts closeOut.usage (the durable per-issue total) — already reads store A;
// repoints onto resolver.issueDetail(id) + the stage breakdown. KEEP as durable.
```

## 2.6 Layer wiring

```ts
const CostDomainLayer = Layer.mergeAll(
  CostResolverLayer,
  CostWriterLayer,
).pipe(
  Layer.provide(DbLive),          // the ONLY place the cost_events handle is provided
  Layer.provide(CostArchiveLive), // events.jsonl + WAL durable writer
  Layer.provide(EventBusLive),
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(CostApiLive),
  Layer.provide(CostDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge**, not a runtime failure
(CONVENTIONS §6). Because `CostApiLive`'s handler `R` resolves to `CostResolver |
CostWriter` and neither leaks `Db`, no controller can read or write the cache
directly.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `CostResolver.summary` | §1A `GET /api/costs/summary`; §1A `GET /api/metrics/costs` (reshaped) |
| `CostResolver.byIssue` | §1A `GET /api/costs/by-issue` |
| `CostResolver.issueDetail` | §1A `GET /api/costs/issue/:id`; §1A `GET /api/issues/:id/costs` (repointed) |
| `CostResolver.byDay` | §1A `GET /api/costs/trends`; consumed by the breaker (§1E.1) |
| `CostResolver.byModel` | §1A `GET /api/costs/by-model` |
| `CostResolver.byAgent` | §1A `GET /api/costs/by-agent`; §1A `GET /api/agents/:id/cost` (repointed); breaker (§1E.1) |
| `CostResolver.byBackgroundSource` | §1A `GET /api/costs/background` |
| `CostResolver.byProject` | §1A `GET /api/costs/summary?project=` (the project dimension) |
| `CostResolver.recent` | §1A `GET /api/costs/stream`; §1C `cost.subscribe` |
| `CostResolver.listBudgets` | §1B `pan cost budget list` (reads `budgets.json`) |
| `CostResolver.checkBudget` | §1B `pan cost budget check <id>` (reads `budgets.json`) |
| `CostWriter.record` | §1A ingest call-sites: `appendCostEventSync` (events.ts:102), `insertCostEvents` (reconciler.ts:405, sync-wal.ts:65), `insertCostEvent` (memory provider) |
| `CostWriter.reconcile` | §1A `POST /api/costs/reconcile`, `POST /api/costs/sync-wal`; §1B `pan cost sync`; §1E.2 the pi/codex sweep (PAN-1935) |
| `CostWriter.rebuild` | §1A `POST /api/costs/rebuild` |
| `CostWriter.createBudget` | §1B `pan cost budget create <name>` (writes `budgets.json`) |
| `CostWriter.deleteBudget` | §1B `pan cost budget delete <id>` (writes `budgets.json`) |
| `CostApi` endpoints | one-to-one with the resolver/writer members above |
| relocated / deleted | §1D rollup — `experiments`/`specialists cost`/`deduplicate`/store-B `setIssueBudget`/store C/conversation-cost map to no Cost member by design |

The event-cost methods read/write only the locked `cost_events` table; the four
budget verbs read/write the separate `budgets.json` store (a second store behind
the same doors, §2.2). No endpoint is invented; nothing real from the current
surface is lost — including the live `pan cost budget` CLI family.

## Collapse counts (the headline numbers)

The arithmetic, all derivable from the Part 1 tables: **18 cost-touching HTTP
endpoints across 6 modules = 14 read + 4 write** (matches cost-audit §5).

- **14 read endpoints → 1 `CostResolver`** (9 event-cost methods; the CLI adds 2
  budget reads, §1B, for 11 total). Of the 14: **11 → methods**, **2 DELETE**
  (`experiments`, `specialists/:name/cost`), **1 RELOCATE**
  (`discovered-sessions` → Conversations).
  - The task's **"5 read paths → 1"** = the 5 *cost* modules {`costs`, `agents`,
    `issues`, `metrics`, `specialists`} → the one resolver. `discovered-sessions`
    is the 6th module (conversation domain), correctly **outside** the 5.
- **4 write endpoints → `CostWriter`**: `reconcile`, `rebuild` (verbs);
  `sync-wal` folds into `reconcile`; `deduplicate` DELETE (structural).
- **4 in-process ingest call-sites → 1 `CostWriter.record`**.
- **4 cost stores → 1** (store A; B + C + the ad-hoc re-parser deleted). The
  live `budgets.json` budget store is a **5th** store, preserved behind
  `CostWriter`/`CostResolver` budget verbs (§1B) — not part of the collapse-to-A.
- **10 cost CLI verbs** (`pan cost today/week/month/report/issue/sync` +
  `budget create/list/check/delete`) → `CostResolver`/`CostWriter` members (§1B);
  **0 cost RPC methods today → 1 new `cost.subscribe`**.
- **5 DELETED**: `experiments`, `specialists/:name/cost`, `deduplicate`, store B
  (+ dead store-B per-issue `setIssueBudget` — **not** the live CLI budget
  family), store C (+ dead `recordCostSync`).
- **2 dead writes fixed for parity**: the cost-limit breaker (re-wired onto the
  resolver) and native pi/codex ingest (PAN-1935 — routed into `reconcile`).
