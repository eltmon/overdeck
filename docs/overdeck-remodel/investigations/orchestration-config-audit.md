# Overdeck Remodel — Orchestration (Control Plane) + Projects/Config Table Audit

**Goal:** radical complexity reduction on a fresh empty `overdeck.db`. Keep only
tables/fields the system genuinely **NEEDS**. For each table: classify
**SOURCE-OF-TRUTH** vs **CACHE** vs **DEAD**, with the discriminator being
*does a live code path read it for a decision (branch-read), and what rebuilds
it after a DB wipe* — not whether it merely exists. Matches the rigor of
[`review-state-audit.md`](review-state-audit.md).

**Method:** every table traced by `git grep` of its name + its DB-module accessors
across `src/` (non-test). Row counts and live schemas read from the running
`~/.overdeck/panopticon.db` via `node:sqlite`. The test for a KEEP is a
*branch-read* (an `if`/`filter`/comparison that changes behavior), exactly as in
the review-state audit.

## Glossary

- **SOURCE-OF-TRUTH** — nothing else can reconstruct this; losing it loses
  information. Must survive a DB wipe (live in a file/git/forge, or be
  explicitly accepted-to-reset on the big-bang cutover).
- **CACHE** — rebuildable from a source of truth (forge PR state, `projects.yaml`,
  the per-issue permanent record, or recomputed each tick). Safe to start empty
  on `overdeck.db`.
- **DEAD** — no live writer **and/or** no live branch-reader; abandoned. Delete
  the table, its DB module, and orphaned callers.
- **Branch-read vs display-read** — a branch-read feeds control flow; a
  display-read only serializes to the UI / activity feed. A table read *only* for
  display is a DROP candidate under "NEED, not nice-to-have."
- **Live-but-empty** — 0 rows right now, but a live write path populates it during
  normal operation (e.g. only while a merge is mid-flight). NEED ≠ non-empty.

## Headline numbers

- **16 tables in scope. Verdict: 6 DEAD (delete), 8 NEED, 2 route-elsewhere.**
- **Kill list (6 tables):** `issue_state`, `auto_merge`, `outbox`,
  `label_sync_audit`, plus the **orphaned main-DB** `api_cache` and `rate_limits`
  (the real ones live in a *separate* `cache.db`). All have zero live
  reader+writer pairs in `src/`.
- **Orchestration is NOT one domain and NOT three.** It is **two data domains**
  (Merge, Control/Settings) + Config is its own file-backed domain. Deacon and
  flywheel are *runtime subsystems that consume Control/Settings flags* — they
  have no distinct data store, so they are not separate data domains.
- **Two of the three domains already satisfy the one-resolver/one-writer
  principle today:** `app-settings.ts` (Control/Settings) and `merge-set.ts`
  (Merge) are each a single module wrapping their tables. Config's resolver is
  `loadProjectsConfigSync` over `projects.yaml` (no DB writer at all).
- **The honest tension:** `app_settings` is **SOURCE-OF-TRUTH, not cache** — a
  direct counterexample to "the DB is a disposable cache." Nothing rebuilds
  `deacon.globally_paused` / `flywheel.active_run_id`. It is operator/control
  state, durable, DB-resident, but **acceptable-to-reset** on the big-bang (fresh
  `overdeck.db` boots deacon unpaused with no active flywheel run).

---

## 1. The empty tables (0 rows) — DEAD vs live-but-empty

The major deletion opportunity. Each empty table grepped for both a live **write
path** and a live **branch-read**. Verdict is decisive per the evidence.

| Table | Rows | Live writer? | Live branch-reader? | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| `merge_queue` | 0 | **YES** — `enqueueMerge`/`markMergeProcessing` at `workspaces.ts:4961,4973` (every merge passes through it) | **YES** — `getCurrentMerge` gate `workspaces.ts:4958`; `getAllActiveQueues`×4, `resetProcessingToQueued`×2 | **NEED · CACHE** | Per-project **sequential merge lock** (PAN-632). Empty at rest because nothing is mid-merge. Rebuildable (a serialization buffer; recompute from in-flight merge state on boot — `resetProcessingToQueued` already re-seeds it). |
| `pending_auto_merges` | 3 | **YES** — `scheduleAutoMergeWithResult` (flywheel.ts:339) | **YES** — `listDuePendingAutoMerges` (auto-merge-executor.ts:75) drives the cooldown executor | **NEED · CACHE** | Flywheel **merge-cooldown queue** (PAN-1486). The 3 rows are stale `failed` (PAN-1834/1821/1242). Recomputable each tick from pipeline state; the cooldown window is the only thing it buffers. |
| `git_operations` | 0 | **YES** — `appendGitOperationSync` from `merge-agent.ts:1015` (parses git output during merges) | **YES (one real branch)** — `workspaces.ts:6009` `listGitOperationsSync({operation:'push'}).filter(...)` → `recentPushWarning` concurrent-merge detection | **NEED · CACHE** | Persistent git event log (PAN-653). Mostly display (metrics ActivityPanel) but has one genuine branch-read for concurrent-merge warning. Pure log — start empty, append-only. |
| `flywheel_substrate_bugs` | 0 | **YES** — `upsert`/`markFixed` from `substrate-bug-poller.ts:233,278` (polls GitHub labels into the table) | **Display/telemetry only** — sole reader `flywheel-telemetry.ts:505 listInWindow` feeds the flywheel success-metrics report | **NEED-IF-metrics-are-NEED · CACHE** | A **mirror of GitHub-labeled substrate-bug issues** for flywheel reporting. No control branch. Under "NEED not nice-to-have," **DROP unless flywheel success metrics are a NEED**; if kept it is a pure CACHE of GitHub state. |
| `rate_limits` | 0 | **NO** (main DB) | **NO** (main DB) | **DEAD — DELETE from `schema.ts`** | The *real* `rate_limits` lives in a **separate `cache.db`** created by `cache-service.ts:91` with a **different schema** (`tracker`/`remaining`/`reset_at`). The `schema.ts:381` copy (`service`/`requests`/`window_start`) has **zero readers/writers** in `src/`. Orphan. |
| `api_cache` | 0 | **NO** (main DB) | **NO** (main DB) | **DEAD — DELETE from `schema.ts`** | Same story: real `api_cache` is in `cache.db` (`cache-service.ts:79`, schema `tracker`/`cache_key`/`data`). The `schema.ts:338` copy (`key`/`value`/`expires_at`) has **zero callers**. Orphan. |
| `outbox` | 0 | — | — | **DEAD — no table** | No `outbox` table exists in `schema.ts` at all. The only "outbox" in `src/` is the **frontend retry outbox** (`composerStore.ts`, `chat-types.ts`) — an in-memory client concept, unrelated. Nothing to delete server-side; the row-count line item is a phantom. |
| `auto_merge` | 0 | — | — | **DEAD — legacy DB artifact** | No `CREATE TABLE auto_merge` anywhere in `src/`. The only `auto_merge` in code is the **`review_status.auto_merge` column** (routing flag, see review-state-audit). The standalone `auto_merge` *table* is a leftover in the live DB with no schema source. Won't be recreated on `overdeck.db`; nothing to do beyond noting it. |
| `label_sync_audit` | 0 | — | — | **DEAD — legacy DB artifact** | **Zero references** anywhere in the repo (`git grep label_sync_audit` → nothing). No schema, no module, no caller. Legacy live-DB artifact; absent from `schema.ts` so it won't return on `overdeck.db`. |

**Empty-table net:** of the 8 "empty" line items, **4 are live-but-empty NEEDs**
(`merge_queue`, `pending_auto_merges`, `git_operations`, and `flywheel_substrate_bugs`
*if metrics are NEED*), and **4 are DEAD** (`api_cache` + `rate_limits` must be
**removed from `schema.ts`** or `overdeck.db` recreates the orphans; `outbox` +
`label_sync_audit` are already absent from `schema.ts`).

---

## 2. Merge engine — `merge_sets` / `merge_set_repos` / `pending_auto_merges`

Multi-repo merge coordination (PAN-632) + flywheel cooldown (PAN-1486). **NEED.**

| Table | Rows | Class | Why |
| --- | --- | --- | --- |
| `merge_sets` | 234 (7 draft, 227 reviewing) | **CACHE** | Per-issue merge coordination state. |
| `merge_set_repos` | 264 | **CACHE** | Per-repo gate progression within a merge set. |
| `pending_auto_merges` | 3 | **CACHE** | Cooldown scheduling buffer (above). |

**`merge_sets`/`merge_set_repos` rebuild story (airtight CACHE):**

1. **Structure rebuilds from `projects.yaml`.** `buildMergeSetForIssueSync`
   (`merge-set.ts:62`) derives which repos, branches, and forge belong to an
   issue from `resolveProjectReposFromResolvedIssueSync` — i.e. from
   `projects.yaml`, not the DB. Single writer is `upsertMergeSet`
   (`merge-set-db.ts:15`), which deletes-and-reinserts repos atomically.
2. **Gate outcomes rebuild from forge + the durable record.** The per-repo
   `reviewStatus`/`testStatus`/`verificationStatus`/`mergeStatus` are the same
   verdicts the review pipeline owns (mirrored to the per-issue permanent record
   `pipeline` block — see review-state-audit). They are re-derivable from forge PR
   state.
3. **In-flight transients are acceptable-to-lose.** `rebaseStatus` mid-run,
   `mergeOrder`, `artifactId` are stamped *during* a merge run and are not
   durably mirrored. Confirmed: the durable mirror `records.ts:projectMerges`
   (132-137) persists **only `repo.artifactUrl`** — nothing else. So the DB is
   the *only* home for the live gate snapshot, but that snapshot is
   reconstructable from forge state and dies harmlessly with an in-flight merge.

**Verdict:** the whole merge engine is **CACHE**. On `overdeck.db` it starts
empty; the first merge through each issue rebuilds its merge set from
`projects.yaml` + forge. The durable answer (which PRs/artifacts merged) already
lives in the per-issue permanent record, not here.

**`merge-set.ts` is already the single resolver+writer** for this table family —
the remodel keeps it as the Merge domain's API surface.

---

## 3. Orchestration domain shape — ONE domain or several?

**Key call: Orchestration is TWO data domains, not one and not three.**

The discriminator: *does the candidate own a distinct store with its own
resolver/writer, or does it merely consume shared flags?*

| Candidate | Own data store? | Verdict |
| --- | --- | --- |
| **Merge-train** | YES — `merge_sets`/`merge_set_repos`/`pending_auto_merges`/`merge_queue`, resolver/writer = `merge-set.ts` + `merge-queue-db.ts` + `pending-auto-merges-db.ts` | **Separate domain: Merge** |
| **Deacon** (lifecycle watchdog) | NO — its persistence is the `deacon.globally_paused` flag in `app_settings` + per-issue `deacon_ignored` in `review_status` | Runtime **subsystem** consuming Control/Settings — not a data domain |
| **Flywheel** (orchestrator) | NO — its persistence is `flywheel.*` flags (`globally_paused`, `active_run_id`, `require_uat_before_merge`, `merge_train_enabled`, `auto_pickup_backlog`) in `app_settings` | Runtime **subsystem** consuming Control/Settings — not a data domain |

**Where deacon/flywheel runtime state actually lives:** entirely in
`app_settings` (global flags, 7 rows) and `review_status` per-issue control
columns (`deacon_ignored`, `auto_merge`). There is **no `deacon` table, no
`flywheel` table.** Their "state" is key/value control flags. This is why they
collapse into one **Control/Settings** domain rather than spawning two more.

### Recommended Orchestration domain shape

**Domain A — Merge.** Tables: `merge_sets`, `merge_set_repos`, `merge_queue`,
`pending_auto_merges`. All CACHE.
- **Resolver:** one read surface over the merge-set family (today: `merge-set.ts`
  `getMergeSetSync`/`getAllMergeSetsSync` + the two queue modules — consolidate to
  one Merge resolver).
- **Writer:** one write surface (`upsertMergeSet` + queue mutations behind it).
- `git_operations` is a sibling **append-only log** read by the merge flow; keep
  it adjacent to Merge (or in a thin shared "operations log") — it is not part of
  the merge *state* but is written by the merge agent.

**Domain B — Control/Settings.** Table: `app_settings` (global flags) **plus the
per-issue control squatters** the review-state audit routed here:
`review_status.deacon_ignored` and `review_status.auto_merge` (those are the
per-issue counterparts of the global `deacon.*`/`flywheel.*` flags — same
operator/policy class, NOT review verdicts).
- **Resolver/Writer:** `app-settings.ts` is *already* the single typed accessor
  (`getSetting`/`setSetting` + named helpers `isDeaconGloballyPaused`,
  `getFlywheelActiveRunId`, `isMergeTrainEnabled`, …). Keep it as-is; route the
  two per-issue control flags through the same domain API.
- **Class:** SOURCE-OF-TRUTH but **acceptable-to-reset** on cutover (see §6).

**`flywheel_substrate_bugs`** is a flywheel-*reporting* mirror, not control
state — keep it only if success metrics are NEED, and class it CACHE-of-GitHub.

---

## 4. Projects / Config — source of truth

| Surface | Rows | Source of truth? | Class |
| --- | --- | --- | --- |
| `projects.yaml` (`~/.overdeck/projects.yaml`) | n/a (file) | **YES** | **SOURCE-OF-TRUTH (file, not DB)** |
| `app_settings` | 7 | runtime control flags | **SOURCE-OF-TRUTH, acceptable-to-reset** |
| `api_cache` (main DB) | 0 | — | **DEAD** (real one in `cache.db`) |

**The Config source of truth is the `projects.yaml` FILE, full stop.**
`loadProjectsConfigSync` (`projects.ts:198`) is an mtime-cached parse of
`PROJECTS_CONFIG_FILE` (`projects.ts:18`). **No DB table backs project config** —
every `resolveProjectFromIssue*`, `getProjectPath`, repo resolution, test config,
and close-out config reads the YAML. The DB never stores project definitions.

**Config domain shape:**
- **Resolver:** `loadProjectsConfigSync` (already the single read door over the
  YAML).
- **Writer:** the file itself / `pan project` CLI editing the YAML. No DB writer.
- This domain is **trivially correct for the remodel** — it is already
  file-backed with one resolver and survives any DB wipe untouched.

**`app_settings` as Config-adjacent:** it is the *runtime* settings store
(deacon/flywheel toggles + `restart_announcer.last_announced_ts`). It is
genuinely DB-resident SOURCE-OF-TRUTH (nothing rebuilds it). It belongs to the
**Control/Settings** domain (§3 Domain B), not to project Config. Keep
`app-settings.ts` as its single accessor.

---

## 5. Overlaps — route, don't duplicate (not re-audited deeply)

| Table | Rows | Belongs to | Note |
| --- | --- | --- | --- |
| `status_history` | 1068 (merge 473, review 495, test 100) | **Transition / event-log domain** | A per-issue review/test/merge transition log, FK to `review_status`. Overlaps the `events` table (the push-first event store). Route to whichever domain owns the pipeline-transition log; do not duplicate it into Orchestration. CACHE/append-only history — rebuildable from `events`. |
| `uat_generations` | 51 (1 assembling, 5 promoted, 43 invalidated, 2 failed) | **Merge domain (this audit) — NOT Issues** | The task hint says "overlaps Issues," but the **writer is `uat-train.ts`** (the merge-train, i.e. *this* Orchestration/Merge domain), tracking assembled `uat/<codename>-<mmdd>` batch branches (PAN-1737). Decide by writer/branch-reader: it is merge-train state. Keep in the **Merge** domain; do **not** route to Issues. CACHE (append-only batch history; the source of truth for what merged is the per-issue record + forge). |
| `issue_state` | 3 | **DEAD** | See §1 — superseded by filesystem `shadow-state`. Not an Issues-domain overlap; just delete. |

---

## Surprises

1. **`api_cache` and `rate_limits` are doubly-defined, and the main-DB copies are
   pure orphans.** `cache-service.ts` opens a **separate database file**
   (`~/.overdeck/cache.db`, `CACHE_DB_PATH`) and creates its *own* `api_cache`
   and `rate_limits` with **different schemas**. The copies in the main
   `schema.ts` (different column shapes) have **zero readers/writers**. They must
   be **deleted from `schema.ts`** or `overdeck.db` will faithfully recreate two
   dead tables on day one. The live caching subsystem is untouched (it lives in
   `cache.db`, out of scope for `overdeck.db`).

2. **`issue_state` is a fully abandoned table.** Live schema is a `canonical_state`
   enum (`todo`/`in_progress`/`in_review`/`merged`/`closed_wontfix`) with a
   `pending_mutation` column — but there is **no `CREATE TABLE issue_state` and no
   reader/writer anywhere in `src/`.** Its 3 rows are stale (PAN-714/PAN-100/PAN-1190,
   last touched 2026-04/05, one with a `1970-01-01` epoch-zero `last_synced_at`).
   It was an early SQLite "shadow state" prototype, **superseded by the
   filesystem-based `shadow-state`** (`src/lib/shadow-state.ts`, JSON under
   `~/.overdeck/shadow-state/`). Pure DEAD weight.

3. **Orchestration's two real domains are already at the target shape.**
   `app-settings.ts` (one typed accessor over `app_settings`) and `merge-set.ts`
   (one resolver+writer over `merge_sets`/`merge_set_repos`) each already embody
   "one resolver, one writer." The remodel mostly *names* and *consolidates*
   these rather than rebuilding them — the queue modules (`merge-queue-db.ts`,
   `pending-auto-merges-db.ts`) fold under the Merge resolver.

4. **The "merge state" durable answer is just artifact URLs.** The per-issue
   permanent record mirrors **only `repo.artifactUrl`** from a merge set
   (`records.ts:135-137`). Every other merge-set field (per-repo gate statuses,
   `mergeOrder`, `artifactId`, `rebaseStatus`) is run-transient — which is exactly
   why `merge_sets` classes cleanly as CACHE: the only thing worth keeping already
   lives in the durable record, and even that is recoverable from the forge.

5. **`app_settings` breaks the "DB is a disposable cache" framing — honestly.**
   Nothing rebuilds `deacon.globally_paused` or `flywheel.active_run_id`. They are
   genuine SOURCE-OF-TRUTH, DB-resident. The remodel's reconciliation is to treat
   them as **operator/control state that is acceptable-to-reset** at the big-bang:
   a fresh `overdeck.db` boots with deacon unpaused and no active flywheel run.
   `restart_announcer.last_announced_ts` is trivially resettable; the deacon/flywheel
   toggles are the real decision — and the safe default (unpaused, no run) is the
   right cutover posture. **This must be a conscious cutover decision, not a silent
   data loss.**

6. **`pending_auto_merges` is holding only failures.** All 3 rows are `failed`
   (post-rebase lint failure, work-agent-stopped, push-timeout). The active path
   re-derives the schedule each tick, so these stale failure rows are inert — and
   confirm the table is a transient buffer, not a record. Fresh-start is harmless.

7. **`flywheel_substrate_bugs` is a GitHub mirror with no control branch.** It is
   written by a poller that mirrors GitHub-labeled substrate-bug issues, and read
   *only* by the flywheel telemetry report. No `if` anywhere branches on it. Under
   "NEED, not nice-to-have," it is a DROP candidate unless flywheel success metrics
   are themselves a NEED — and even then it is a CACHE of GitHub, rebuildable by
   re-polling.

---

## Final classification table

| Table | Rows | Domain | Verdict | Class |
| --- | --- | --- | --- | --- |
| `merge_sets` | 234 | Merge | KEEP | CACHE |
| `merge_set_repos` | 264 | Merge | KEEP | CACHE |
| `merge_queue` | 0 | Merge | KEEP (live-but-empty) | CACHE |
| `pending_auto_merges` | 3 | Merge | KEEP (live-but-empty) | CACHE |
| `uat_generations` | 51 | Merge | KEEP (route to Merge, not Issues) | CACHE |
| `git_operations` | 0 | Merge-adjacent (op log) | KEEP (live-but-empty, 1 branch-read) | CACHE |
| `app_settings` | 7 | Control/Settings | KEEP | SOURCE-OF-TRUTH (acceptable-to-reset) |
| `flywheel_substrate_bugs` | 0 | Flywheel reporting | KEEP-IF-metrics-NEED | CACHE (of GitHub) |
| `status_history` | 1068 | Transition/event log (route away) | route, don't duplicate | CACHE |
| `issue_state` | 3 | — | **DELETE** | DEAD |
| `api_cache` (main DB) | 0 | — | **DELETE from schema.ts** | DEAD (orphan; real one in cache.db) |
| `rate_limits` (main DB) | 0 | — | **DELETE from schema.ts** | DEAD (orphan; real one in cache.db) |
| `auto_merge` (table) | 0 | — | **DELETE** (legacy DB artifact; no schema source) | DEAD |
| `outbox` | 0 | — | **N/A** (no server table; frontend concept) | DEAD/phantom |
| `label_sync_audit` | 0 | — | **DELETE** (legacy DB artifact; no schema source) | DEAD |

> Squatters noted but owned by sibling audits (not re-audited here): the
> review-run cluster (`review_run_id`, `review_synthesis_agent_id`, …),
> `flywheel_run_id`, `role_run_head` → `agents-state-audit.md`;
> `deacon_ignored` + `auto_merge` review-status columns → `review-state-audit.md`
> (routed into Control/Settings here for domain placement).
