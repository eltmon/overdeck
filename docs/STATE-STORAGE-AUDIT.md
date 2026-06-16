# State Storage Audit — review-status and the `~/.panopticon` surface

**Status:** Resolved by [PAN-1908](https://github.com/eltmon/panopticon-cli/issues/1908). Author: orchestrator conversation, 2026-06-14.
**Trigger:** investigation into why 11 issues showed BLOCKED in the Flywheel emit but not the
Command Deck tree. That investigation surfaced a misdiagnosed substrate bug ([PAN-1883](https://github.com/eltmon/panopticon-cli/issues/1883))
and a deeper question: how much `~/.panopticon` state is authoritative vs. vestigial,
and what should the storage model actually be.

> **Resolution note:** The authoritative-source questions raised here were settled by
> [PAN-1908](https://github.com/eltmon/panopticon-cli/issues/1908): agent runtime state now lives in the SQLite `agents` table in
> `~/.panopticon/panopticon.db`, durable per-issue records live in the git-backed infra repo
> under `.pan/` records, and tmux on the `panopticon` socket remains the liveness oracle. See
> [AGENT-STATE-PLANES.md](./AGENT-STATE-PLANES.md) for the current model. This audit is kept
> as historical context for the design rationale, but its Pass 2 action items are superseded.

## Confidence legend

- **[V]** Verified against code/DB/filesystem at audit time (file:line or query shown).
- **[H]** Hypothesis — plausible, not yet proven. Do not act on without confirming.
- **[P2]** Deferred to Pass 2 — needs a deep dive before any claim is load-bearing.

---

## 1. Ground truth (the incident, corrected)

The originating incident was **misdiagnosed**. The corrected facts:

- **[V] SQLite is the authoritative review-status store, not the JSON file.**
  `src/lib/review-status.ts:156` — `loadReviewStatuses()` reads `getAllReviewStatusesFromDb()`;
  `setReviewStatusSync()` upserts into the `review_status` table in
  `~/.panopticon/panopticon.db`. The default-path JSON file is never read or written by
  `review-status.ts`.
- **[V] `~/.panopticon/review-status.json` is vestigial.** No production module imports
  `review-status-json.ts` (the only writer of that file). It is written **only by tests**
  and CLI tooling. At audit time it held a single dead-end test fixture
  (`PAN-714-DEAD-END-TEST-…`, 336 bytes) — pure test scratch with zero production meaning.
- **[V] The 11 "stranded" issues were never stranded.** All 11 exist in `review_status`
  with current state (last written `2026-06-14T05:11Z`). They are blocked for **real,
  recorded reasons**, not a wipe:
  - 8 × `merge_conflict` blocker (PAN-1775, 1641, 1614, 1765, 1491, 1242, 1827, 1629)
  - 1 × `failing_checks` blocker (PAN-1498)
  - 2 × genuine `review=blocked` (PAN-1817, PAN-1696)
  - 1 × in-progress, `review=pending` (PAN-1845)
- **[V] SQLite already has durable backups.** `~/.panopticon/backups/` holds hourly
  timestamped snapshots (e.g. `2026-06-14T03-32-52Z`). So review-status durability via
  snapshot **already exists** — contradicting [PAN-1883](https://github.com/eltmon/panopticon-cli/issues/1883)'s "no backup, no reconstruct" premise.

**Consequence:** [PAN-1883](https://github.com/eltmon/panopticon-cli/issues/1883)'s central claim — *"review-status.json is the canonical store"* —
is false. The fix it proposes (back up / atomic-write / reconstruct the JSON file) hardens
a file the system does not use. The issue must be **re-scoped**, not implemented as written.

### Why the Flywheel showed BLOCKED but the Command Deck did not

- **[V]** The Flywheel "Active Pipeline" renders `~/.panopticon/flywheel/runs/RUN-34/latest.json`
  — a snapshot **hand-authored by the orchestrator agent**. It stamped `status:"blocked"`
  on each item. The agent's *reasoning* (review-status wiped) was wrong, but the *label*
  was directionally right: those issues really are blocked (by merge conflicts / failing
  checks).
- **[V]** The Command Deck tree derives from live resources + the real (SQLite-backed)
  status. It does not read the Flywheel emit. It shows the issues as in-review, not under a
  hand-stamped "blocked" flag.

So the discrepancy is: **agent-authored snapshot vs. live-derived view**, two independent
representations — exactly as first diagnosed. The error was the *second-pass* RCA that
attributed it to a JSON wipe.

---

## 2. The review-status storage reality

| Module | Backing store | Role | Imported by |
| --- | --- | --- | --- |
| `src/lib/review-status.ts` | `panopticon.db` `review_status` table | **Authoritative** (server/deacon path) | server, deacon, CLI |
| `src/lib/database/review-status-db.ts` | same table | SQLite primitives (upsert/delete/query) | review-status.ts |
| `src/lib/review-status-json.ts` | `~/.panopticon/review-status.json` | **Vestigial** JSON file ops | **tests + CLI only** — no production importer **[V]** |

**The test-pollution vector (separate bug, [PAN-1877](https://github.com/eltmon/panopticon-cli/issues/1877)):**
`tests/lib/cloister/deacon-ci-retry.test.ts` and `pan-344-auto-merge.test.ts` write the
**real** `~/.panopticon/review-status.json` (path built from `homedir()`), full-overwrite
it, and restore via a non-crash-safe `afterEach`. This corrupts the vestigial file but —
because production ignores that file — has **no production impact**. It does, however,
prove a class problem: **≥10 test files mutate real `~/.panopticon` paths** (see §5).

---

## 3. The `review_status` field inventory (40 columns), categorized

The single `review_status` table mixes two fundamentally different kinds of data. This is
the crux of the storage redesign. Columns verified via `PRAGMA table_info(review_status)`.

### 3a. DURABLE TRUTH — pipeline verdicts (belongs in the source of truth)

These answer "where is this issue in the pipeline" and are meaningful across machines/time.

| Column | Meaning |
| --- | --- |
| `issue_id` | key |
| `review_status` / `test_status` / `verification_status` / `inspect_status` / `merge_status` | gate verdicts |
| `ready_for_merge` | derived gate result |
| `review_notes` / `test_notes` / `verification_notes` / `inspect_notes` / `merge_notes` | verdict rationale |
| `blocker_reasons` | structured merge blockers (e.g. `merge_conflict`, `failing_checks`) |
| `pr_url` / `pr_number` / `pr_head_sha` | PR identity |
| `reviewed_at_commit` / `last_verified_commit` | commit anchors for staleness detection |
| `auto_merge` | per-issue merge-train routing |
| `updated_at` | last change |

### 3b. EPHEMERAL RUNTIME — deacon recovery bookkeeping (belongs in cache/scratch, never versioned)

These are this-machine patrol bookkeeping: counters, timers, in-flight markers. They churn
frequently and are largely meaningless on another machine. **Many are recovery scar tissue
— [H] candidates for deletion once storage is sane** (the "how much is band-aid" question).

| Column | Nature |
| --- | --- |
| `verification_cycle_count` / `verification_max_cycles` | retry budget |
| `auto_requeue_count` / `lifetime_auto_requeue_count` | requeue counters |
| `merge_retry_count` / `test_retry_count` / `review_retry_count` | retry counters |
| `recovery_started_at` / `review_spawned_at` / `conflict_resolution_dispatched_at` | patrol timers |
| `merge_step` | transient merge-progress marker |
| `stuck` / `stuck_at` / `stuck_reason` / `stuck_details` | machine-observed failure markers |
| `deacon_ignored` / `deacon_ignored_at` / `deacon_ignored_reason` | human override (durable-ish — **[P2]** classify) |
| `inspect_started_at` / `inspect_bead_id` | transient inspect markers |

Roughly **~20 durable / ~20 ephemeral.** The ephemeral half is precisely the set of fields
added over time (PAN-653 `stuck*`, PAN-699 `test_retry`, PAN-794 `review_retry`/`recovery_started`,
PAN-632 requeue) to patch recovery problems — the dumping-ground pattern.

---

## 4. Target architecture (per operator direction)

**Operator steer (2026-06-14):** review-status should live in a **JSON file in the repo**
as the **authoritative** source of truth; **SQLite should be ephemeral cache, not
authoritative.** This *inverts* today's design. It is coherent and well-suited to a simple,
individual-developer tool. Specifics:

### 4a. The model

- **Durable verdicts (§3a) → per-issue JSON committed to `.pan/`** — the source of truth.
  Versioned (git history = backup + reconstruct), diffable, `cat`-able, shareable across
  machines via normal push/pull. Reuses the existing `.pan/` auto-commit pipeline
  (`src/lib/pan-dir/auto-commit.ts`).
- **Ephemeral runtime (§3b) → SQLite only** — never committed. The deacon's working set.
- **SQLite = a rebuildable projection** of the JSON truth (for fast dashboard/merge-queue
  queries) plus the ephemeral scratch. On boot, if the cache is missing/stale, **rebuild it
  from the JSON files.** A cache wipe becomes a non-event; a JSON wipe is git-recoverable.

This is the "git-backed store + SQLite index" pattern — the same shape beads already uses
(git JSONL truth + derived index).

### 4b. Why per-issue files are required (not one JSON)

- **[V]** SQLite was *made* authoritative specifically to kill a TOCTOU race: the old
  **monolithic** JSON did full-file read-modify-write, so two concurrent issue updates
  raced (`review-status-db.ts:337` "Single-row upsert — atomic, no TOCTOU risk. SQLite
  remains authoritative").
- **Per-issue files dissolve that race** — issue A and issue B never touch the same file.
  This is what makes JSON-authoritative viable where monolithic-JSON-authoritative was not.
  Decision: **`.pan/review-status/<issue>.json`, one per issue** (sibling to specs/continues,
  NOT folded into `continue.json` — different lifecycle, different writer, different read
  hot-path).

### 4c. What this resolves (all at once)

- **Durability / reconstruct** — git history. ([PAN-1883](https://github.com/eltmon/panopticon-cli/issues/1883)'s real goal, for free.)
- **Cross-machine sharing & a cluster-ish status view** — git is the sync substrate. No
  event bus, no fan-out infra (explicitly out of scope).
- **Commit churn (the "why every 60s" concern)** — only durable verdicts commit, and those
  change rarely. The high-frequency counters stay SQLite-only and never hit git.
- **Test pollution** — tests point `.pan/` at a temp root; worst case clobbers one issue
  file, which git restores. The vestigial monolithic JSON file is deleted outright.

### 4d. Real tradeoffs / costs (honest)

- Inverting authority is non-trivial work: rewrite read/write paths in `review-status.ts` +
  `review-status-db.ts`, build the JSON→SQLite rebuild, keep sync-FS off the server hot path
  (async writes + the existing debounced committer).
- Two-tier consistency: JSON and SQLite can drift. Mitigation: **JSON always wins**; a
  boot-time reconciler rebuilds the cache; writes go JSON-first, then cache.
- `deacon_ignored*` is a human override that is arguably durable — **[P2]** decide its tier.

### 4e. Cleanup this implies ("never optimize what shouldn't exist")

- **Delete** the vestigial `~/.panopticon/review-status.json` path + `review-status-json.ts`.
- **Audit** the ~20 ephemeral columns — delete the recovery band-aids that a sane storage
  model makes unnecessary. **[P2]**

---

## 5. `~/.panopticon` surface inventory (first cut)

43 top-level entries. Classified by role; **[P2]** marks entries needing a deep dive before
any deletion. This is the "how much is hacked-in dumping ground" answer, pass 1.

### Authoritative / live stores
- **[V]** `panopticon.db` (+wal/shm) — the live unified SQLite store (1.2 GB, written
  continuously). Today authoritative for review-status, costs, health-events, app-settings, etc.
- **[V]** `config.yaml`, `projects.yaml` — live config (referenced throughout).
- **[V]** `backups/` — hourly DB snapshots.
- **[H]** `cache.db` (+wal/shm) — derived cache (14 MB, live). **[P2]** confirm what it caches.
- **[H]** `memory/` — agent/flywheel durable memory.

### Machine-local ephemeral runtime (must stay local — NOT in repo)
- **[V]** `agents/` (185 dirs, per-agent `state.json`) — agent runtime state.
- **[V]** `heartbeats/`, `sockets/`, `pids/`, `locks/`, `bridge-tokens/` — runtime markers/IPC.
- **[V]** `flywheel/` — orchestrator run-state snapshots (the `latest.json` emit).
- **[V]** `cloister.state`, `restart-status.json`, `supervisor-watchdog.json`, `supervisor.pid`,
  `pending-operations.json` — supervisor/lifecycle markers.
- **[P2]** `shadow-state/` — written `2026-06-13 23:25`, the **same mtime as the vestigial
  review-status.json** → suspected test-written. Investigate; possible second pollution victim.
- **[P2]** `swarms/`, `recovery/`, `handoffs/`, `registry/`, `briefing/`, `workspaces/`, `costs/`,
  `cost-data.json`, `tmux/` — classify durable-vs-ephemeral per store.

### Vestigial / dead (cleanup candidates)
- **[V]** `review-status.json` — vestigial test scratch (see §2).
- **[H]** `event-store.db` (0 bytes, **0 src refs**) — dead.
- **[H]** `state.db` (0 bytes, **0 src refs**) — dead.
- **[H]** `projection-cache.db.bak` (0 bytes) — dead backup artifact.
- **[P2]** `events.db` (0 bytes, 10 src refs), `dashboard.db` (0 bytes, 7 src refs) — empty
  files still referenced → confirm refs are dead/migration paths before removing.
- **[P2]** `cloister.db` (73 KB, stale since **Mar 20**, 2 src refs) — superseded by
  `panopticon.db` per `health-events-db.ts` migration comment. Confirm fully migrated.
- **[V]** `config.yaml.bak`, `.bak-1779724658`, `.bak-pre-flywheel-fix-…`, `.bak-pre-pan1059-…`
  — stale config backups, cruft.

### Synced content (outputs of `pan sync`, not state)
- **[V]** `skills/`, `rules/`, `context/`, `commands/`, `templates/`, `agent-definitions/`,
  `hooks/`, `bin/` — rendered/synced; rebuildable, not source of truth.

### Secrets / infra (machine-local)
- **[V]** `secrets/`, `certs/`, `github-app/`, `internal-token`, `cliproxy/`, `traefik/` — local infra.

### Local prefs / derived artifacts
- **[V]** `ui-theme.json`, `voice-settings.json`, `tts-voices.json` — local UI prefs.
- **[V]** `session-context.md`, `conversations-snapshot-*.md` — generated.
- **[H]** `tldr/` — TLDR caches/venvs (known disk hog, PAN-1674).
- **[P2]** `conversations/` (1501 entries), `archives/`, `artifacts/`, `docs/`, `general/` — classify.

---

## 6. Pass 2 — deep-dive plan

Each is a discrete, scoped investigation (read-only) producing a verified verdict:

1. **Ephemeral-field band-aid audit** — for each §3b column, trace its originating PAN +
   whether a sane storage model makes it removable. Output: keep/delete per field.
2. **Dead-DB reference audit** — `events.db`, `dashboard.db`, `cloister.db`: are the src
   references live or migration debris? Output: safe-to-delete list.
3. **`shadow-state/` pollution check** — is it another test-written real path?
4. **State-surface classification completion** — resolve every **[P2]** in §5.
5. **Test-isolation fix ([PAN-1877](https://github.com/eltmon/panopticon-cli/issues/1877))** — env-rootable `.pan`/`~/.panopticon` base path so no
   test writes a real store; audit the ≥10 offending files.

---

## 7. Issue impact

- **[PAN-1883](https://github.com/eltmon/panopticon-cli/issues/1883)** — re-scope. Its premise (JSON is canonical, no backup) is false.
  Replace with: *"Make per-issue review-status JSON the committed source of truth; demote
  SQLite to a rebuildable cache; split durable vs ephemeral fields; delete the vestigial
  JSON path."*
- **[PAN-1877](https://github.com/eltmon/panopticon-cli/issues/1877)** — keep as the test-isolation fix; it becomes trivial once the
  storage has an env-rootable base path (same seam).
- **Merge-conflict reality** — the 11 issues' actual blocker (`merge_conflict` /
  `failing_checks` vs main) connects to the red-main family ([PAN-1880](https://github.com/eltmon/panopticon-cli/issues/1880), [#1720](https://github.com/eltmon/panopticon-cli/issues/1720),
  [#1849](https://github.com/eltmon/panopticon-cli/issues/1849)). Out of scope for the storage redesign; tracked separately.
- **Out of scope (do not file):** any distributed-control-plane / event-bus / fan-out
  architecture. Git-as-sync is the ceiling.
