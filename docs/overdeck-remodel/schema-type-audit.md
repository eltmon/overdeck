# Overdeck Database — Schema Type Audit

> Read-only audit of all 30 tables in `drizzle/overdeck/0000_overdeck_init.sql` cross-referenced
> against the Drizzle defs + read/write code in `src/lib/overdeck/*.ts` and
> `src/dashboard/server/event-store.ts`. Drives the schema-type decisions for the
> PAN-1960 cutover (esp. WI-2's events DDL) and broader overdeck cleanup.

## TL;DR

- **P0 (silent corruption, LIVE):** `agents.*_at`, `issues.updated_at`, and `health_events.timestamp`
  are written as epoch **seconds** by the Drizzle resolver (`mode:'timestamp'`) **and** as epoch
  **milliseconds** by the raw-SQL path — into the *same* integer columns. Cross-reads decode to
  **Jan 1970** or **year ~57000**. No `STRICT` tables, so the bad value is stored silently.
- **P1 (schema lies / runtime divergence):** `events.timestamp`, `status_history.timestamp`
  — migration declares `integer`, the live writer stores
  TEXT. Root cause: **three disagreeing CREATE-TABLE sources** (the migration, the Drizzle
  `sqliteTable` defs, and inline `CREATE TABLE IF NOT EXISTS` in lib files).
- **Clean — no action:** IDs / foreign keys (Category 2), money/tokens (Category 5).
- **Single highest-leverage fix:** standardize **all** timestamps on `integer` epoch-**milliseconds**
  (`mode:'timestamp_ms'`), collapse the three CREATE-TABLE sources to the migration alone, and delete
  the `conversations.ts:803` heuristic decoder. Millis is what every JS write site already produces
  (`Date.now()`, `Date.parse()`, `getTime()`), so the conversion churn is near-zero.

## Glossary

- **Drizzle `mode:'timestamp'`** (`node_modules/drizzle-orm/sqlite-core/columns/integer.cjs:97-109`):
  writes `Math.floor(date.getTime()/1000)` = **epoch SECONDS**; reads `new Date(value*1000)`.
  `mode:'timestamp_ms'` = millis; **not used anywhere currently**.
- **Drizzle `mode:'boolean'`** (`integer.cjs:127-132`): writes `1/0`, reads `Number(value)===1`.
- **No STRICT tables** (`grep -c STRICT 0000_overdeck_init.sql` = 0): SQLite uses type *affinity*, not
  enforced types — an ISO string written to an `integer` column is silently stored as text, and a
  Drizzle reader doing `new Date("2026-..." * 1000)` yields `Invalid Date`.

## The spine: two writer families

| Family | Mechanism | Integer-timestamp unit | Tables |
| --- | --- | --- | --- |
| **Drizzle-managed** | `db.q.insert(...).values({ x: new Date() })` | **epoch SECONDS** (`mode:'timestamp'`) | issues, agents (resolver path), conversations (created/archived), cost_events, merge_sets, merge_queue, pending_auto_merges, uat_generations, transcripts (first/last_ts), app_settings, events (infra.ts EventBusLive) |
| **Legacy raw-SQL** | inline `CREATE TABLE IF NOT EXISTS`, "to match the old panopticon.db" | **TEXT ISO-8601** | discovered_sessions, session_embeddings, git_operations, flywheel_substrate_bugs, events (event-store.ts — the live writer) |
| **Legacy raw-SQL, millis** | raw SQL writing `Date.now()`/`getTime()` into `integer` columns | **epoch MILLISECONDS** | agents (agent-state-sync path), health_events, transcripts (file_mtime/scanned_at) |

Three columns are written by two families at once into the same physical column — those are the P0 corruption bugs.

## Category 1 — Timestamps (highest priority)

### 1A. Active dual-writer COLLISIONS (P0 — must fix)

| Column(s) | Migration DDL | Writer A (seconds) | Writer B (millis) | Symptom |
| --- | --- | --- | --- | --- |
| `agents.started_at, updated_at, last_resume_at, stopped_at, paused_at, troubled_at, last_activity, first_failure_in_run_at, last_failure_next_retry_at, review_deadline_at` | `integer` (`0000:12-40`) | Drizzle resolver `agents.ts:283-489` `new Date()` | raw `agent-state-sync.ts:161-205` `Date.now()`/`Date.parse()` | Drizzle→`isoFromMillis` reads as **Jan 1970**; raw→Drizzle reads as **year ~57000**. Both readers live. |
| `issues.updated_at` | `integer` (`0000:163`) | Drizzle `issues.ts:278-318` | raw `agent-state-sync.ts:218`, `review-status-sync.ts:141-142` (`INSERT OR IGNORE`) | Same split on the `issues` PK table. |
| `health_events.timestamp` | `integer NOT NULL` (`0000:135`); Drizzle `agents.ts:46` `mode:'timestamp'` (seconds) | (Drizzle def) | raw `health-events.ts:48,66` `getTime()`/`toMs()` (file comment line 10: "overdeck stores timestamps as INTEGER milliseconds") | Drizzle reader → year ~57000. |

Liveness: `agent-state-sync.ts` is called from `agents.ts:1078,1117`, `services/agent-projection.ts:111-112`, `read-model.ts:152`; the Drizzle resolver is the `AgentsResolverLive` mutation layer. Both paths are live.

### 1B. Migration-vs-runtime mismatches (P1)

| Column | Migration | Drizzle def | Live writer | Reality |
| --- | --- | --- | --- | --- |
| `events.timestamp` | `integer NOT NULL` (`0000:120`) | `infra.ts:30` `mode:'timestamp'` (seconds) | `event-store.ts:286,289` `new Date().toISOString()` (inline DDL `event-store.ts:140,167` = `timestamp TEXT NOT NULL`) | Live writer stores **TEXT**; migration+Drizzle are an unwired target. (This is the known events mismatch — WI-2.) |
| `status_history.timestamp` | `integer NOT NULL` (`0000:328`) | (none) | `review-status-sync.ts:248` writes `string`, reads `string` | integer column written/read as ISO TEXT. |
### 1C. Intra-table convention splits

- `conversations`: `created_at`/`archived_at` integer-seconds, but `ended_at`/`last_attached_at` are **TEXT** (`conversations.ts:47-48`).
- `transcripts`: `first_ts`/`last_ts` seconds (`mode:'timestamp'`), `file_mtime`/`scanned_at` plain integer **millis** (`conversations.ts:84-85`).

### 1D. Self-consistent timestamp tables

- `cost_events` — fully consistent on **epoch SECONDS** (Drizzle `cost.ts:41` AND raw `cost-sync.ts:50` `Math.floor(getTime()/1000)`). The one table both families agree on.
- `transcript_checkpoints` — consistent on **epoch SECONDS** (`toSecs()`/`toIso(unixSecs)`). NB `claim_from/claim_to/last_offset` are byte/line **offsets**, correctly plain integer.
- Legacy TEXT-ISO tables (internally consistent, just TEXT): `discovered_sessions`, `session_embeddings.created_at`, `git_operations`, `flywheel_substrate_bugs`.

### Bandaid smell

`conversations.ts:803-816` `toIso()` heuristically guesses seconds-vs-millis at read time (`value < 10_000_000_000 ? value*1000 : value`). It exists because the storage unit is non-deterministic — violates the repo "No Bandaids" rule; delete once timestamps are standardized.

### Recommendation — Category 1

**Adopt `integer` epoch-MILLISECONDS (`mode:'timestamp_ms'`) for all 30 tables.** Every JS write site already produces millis; `timestamp_ms` matches with zero conversion, eliminates the `÷1000`/`×1000` churn and the `conversations.ts:803` heuristic, and preserves sub-second precision (seconds truncates it). Conform list:
1. Stop the 1A collisions: make the raw path and the Drizzle resolver use the same unit on `agents.*_at`; drop the `Date.now()` raw writes to `issues.updated_at` (`agent-state-sync.ts:218`, `review-status-sync.ts:141-142`); reconcile `health_events.timestamp`. Under a millis standard, change Drizzle defs → `timestamp_ms`; the raw-millis writers are then already correct.
2. Convert TEXT-ISO timestamp columns → integer millis: `events.timestamp`, `status_history.timestamp`, `conversations.ended_at`/`last_attached_at`, `flywheel_substrate_bugs.*_at`, `git_operations`, `discovered_sessions.*_ts`/`enriched_at`/`scanned_at`/`file_mtime`, `session_embeddings.created_at`.
3. Convert seconds writers → millis: `cost_events` (`cost.ts:41` def → `timestamp_ms`, `cost-sync.ts:50` drop `/1000`), `transcript_checkpoints`, all other `mode:'timestamp'` → `timestamp_ms`.
4. Delete the `conversations.ts:803` heuristic decoder.

## Category 2 — IDs / Foreign Keys — CLEAN

Every PK and `*_id` is `text` (natural IDs) or `integer AUTOINCREMENT` (append-only surrogate keys); every FK references a matching-type PK. No change required.

## Category 3 — Booleans

Storage is uniformly integer 0/1, but the *typing/DEFAULT* drifts: some use Drizzle `mode:'boolean'`, others plain `integer` read via `Boolean(...)`; DEFAULTs are declared `true`/`false`/`0` inconsistently (e.g. `review_runs.stuck DEFAULT false` vs `review_status.stuck DEFAULT 0`). **Recommendation:** all boolean columns → `integer(..., { mode:'boolean' }).default(false)`. Add `agents.stopped_by_pause` to the Drizzle def (currently missing). Low severity.

## Category 4 — JSON / Structured Text

All JSON in `text` columns (correct for SQLite). Two access paths coexist (Drizzle `mode:'json'` vs manual `JSON.parse/stringify`); `events.payload` uses both. **Recommendation:** standardize to Drizzle `mode:'json'` where a table def exists; no column-type changes. Low severity.

## Category 5 — Money / Cost / Tokens — CLEAN

Money/cost → `real` uniformly; tokens/counts → `integer` uniformly. No change required.

## Category 6 — Other

1. The `agents.ts` Drizzle def covers only ~22 of ~40 migration columns (a partial mirror); the raw `agent-state-sync.ts` is the only full-column path. Maintenance trap.
2. **Three CREATE-TABLE sources** for the same DB (migration / Drizzle defs / inline `CREATE TABLE IF NOT EXISTS` in `event-store.ts`, `discovered-sessions.ts`, `git-activity.ts`, `flywheel-substrate-bugs.ts`, `memory.ts`). The inline DDL disagrees with the migration on types — whichever runs first wins per table → non-deterministic schema. **Root cause of 1B.**
3. Nullability drift on equivalent pipeline-status columns (`merge_set_repos` `NOT NULL DEFAULT 'pending'` vs nullable `review_status.*_status`).

**Recommendation:** make the migration the single CREATE-TABLE source of truth — delete the inline `CREATE TABLE`/`DROP+CREATE` DDL from the lib files; complete (or generate) the `agents.ts` Drizzle def to cover all columns. Structurally prevents 1B from recurring.

## Severity summary

| Severity | Finding |
| --- | --- |
| **P0 — silent corruption, live** | 1A: `agents.*_at`, `issues.updated_at`, `health_events.timestamp` written seconds (Drizzle) and millis (raw) into the same columns. |
| **P1 — schema lies / divergence** | 1B: `events.timestamp`, `status_history.timestamp`. 6.2: three disagreeing CREATE-TABLE sources. |
| **P2 — drift, no data loss** | 1C/1D splits, Category 3 boolean DEFAULTs, Category 4 dual JSON paths, 6.1/6.3. |
| **Clean** | Category 2 (IDs/FKs), Category 5 (money/tokens). |
