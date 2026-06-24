# Overdeck DB ERD — Schema Review Notes

Companion to `docs/overdeck-db-erd.excalidraw`. Source of truth:
`drizzle/overdeck/0000_overdeck_init.sql` (cross-checked against
`src/lib/overdeck/*.ts` Drizzle definitions). Generated alongside
`docs/overdeck-db-erd.mmd` (Mermaid `erDiagram`, the reviewable intermediate).

## Rendered counts

| Thing | Count |
|---|---|
| Tables (boxes) | **30** |
| Columns | **338** |
| Indexes shown | **36** (5 unique, 3 partial) |
| Declared `FOREIGN KEY`/`REFERENCES` | **19** (17 drawn solid + 2 self-refs documented) |
| Logical `*_id` references (dashed) | **8** |
| Relationship arrows drawn | **25** |

Every `CREATE TABLE`, every column, every `REFERENCES`, and every
`CREATE INDEX` in the migration is represented in the diagram (verified by a
mechanical cross-check pass: 30/30 table titles, 0 column-count mismatches,
19/19 FK clauses, 36/36 indexes).

Notation inside each box: `PK`/`FK` marker, `name`, `TYPE`, then `NN`
(NOT NULL), `UQ` (inline unique), `AUTO` (autoincrement). Indexes listed under
a `────` rule as `UQ name (cols)` / `IX name (cols)` (`*` = partial / `WHERE`).

---

## Type inconsistencies found (the point of this review)

### 1. Timestamp storage is split into two camps — INTEGER (epoch) vs TEXT (ISO)

This is the headline issue. 60 timestamp-like columns, split **43 INTEGER**
vs **17 TEXT** with no consistent rule:

- **INTEGER (epoch seconds/ms)** — `agents.*` (started_at, stopped_at,
  paused_at, troubled_at, …, updated_at), `issues.updated_at`,
  `cost_events.ts`, `events.timestamp`, `health_events.timestamp`,
  `status_history.timestamp`, `conversation_files.created_at`,
  `merge_queue.queued_at/started_at`, `merge_sets.created_at/updated_at`,
  `pending_auto_merges.*`, `review_runs.*`, `review_run_agents.deadline_at`,
  `transcript_checkpoints.*`,
  `uat_generations.*`, `app_settings.updated_at`, `issue_policy.updated_at`,
  `favorites.created_at`, `transcripts.first_ts/last_ts/scanned_at`.
- **TEXT (ISO-8601 strings)** — **all** of `review_status.*_at`,
  `discovered_sessions.first_ts/last_ts/scanned_at/enriched_at`,
  `session_embeddings.created_at`, **all** of `flywheel_substrate_bugs.*_at`,
  and `conversations.ended_at` / `conversations.last_attached_at`.

Consequence: any cross-table time reasoning (e.g. "agent last activity vs
review status updated_at", or joining `transcripts` to `discovered_sessions`
on overlapping time windows) requires per-column parsing logic. A single
stored representation (one INTEGER epoch convention) would remove the whole
class of bugs.

### 2. `conversations` contradicts ITSELF within one table

- `created_at` `INTEGER NOT NULL`
- `archived_at` `INTEGER`
- `ended_at` `TEXT`  ←
- `last_attached_at` `TEXT`  ←

Two integer timestamps and two text timestamps in the same row. Highest-risk
table because the mismatch is intra-table, not inter-table.

### 3. `review_runs` (INTEGER) vs `review_status` (TEXT) — parallel fields, opposite types

These two tables describe the same review lifecycle and mirror three field
names exactly, yet store them with opposite types:

| Field | `review_runs` | `review_status` |
|---|---|---|
| `review_spawned_at` | INTEGER | TEXT |
| `conflict_resolution_dispatched_at` | INTEGER | TEXT |
| `recovery_started_at` | INTEGER | TEXT |
| `updated_at` | INTEGER NOT NULL | TEXT NOT NULL |

`review_status` is the only table where `updated_at` is TEXT. Likely a legacy
copy that was never aligned when `review_runs` was introduced.

### 4. `transcripts` (INTEGER) vs `discovered_sessions` (TEXT) — same column names, opposite types

Both index transcript files; four column names are identical with opposite
storage:

| Column | `transcripts` | `discovered_sessions` |
|---|---|---|
| `first_ts` | INTEGER | TEXT |
| `last_ts` | INTEGER | TEXT |
| `file_mtime` | INTEGER | TEXT |
| `scanned_at` | INTEGER | TEXT |

Anything that unions/compares these two tables (they overlap heavily in
purpose) will hit a type wall.

### 5. `*_ts` is INTEGER in two tables but TEXT in two others

- `cost_events.ts` INTEGER, `events.timestamp` INTEGER, …
- but `git_operations.ts` TEXT, `discovered_sessions.first_ts/last_ts` TEXT.

Same `ts` suffix, mixed types.

### 6. Boolean defaults expressed as `TRUE`/`FALSE` on INTEGER columns

- `merge_set_repos.required` `INTEGER DEFAULT true`
- `review_runs.stuck` `INTEGER DEFAULT false`

SQLite stores these as 1/0, so it works, but the literal is surprising next to
the many sibling columns that use `DEFAULT 0` / `DEFAULT 1`
(e.g. `agents.paused`, `review_status.stuck`, `review_status.ready_for_merge`).
Pick one convention.

---

## ID / PK type notes (mostly consistent — recorded for completeness)

Two key styles, both valid, and the FK types **do** match their targets:

- **Natural TEXT primary keys**: `agents.id`, `conversations.id`, `issues.id`,
  `issue_policy.issue_id`, `merge_sets.issue_id`, `review_runs.run_id`,
  `review_status.issue_id`, `transcripts.backing_file_path`,
  `transcript_checkpoints.session_id`, `uat_generations.name`,
  `flywheel_substrate_bugs.issue_id`, `app_settings.key`.
- **Surrogate INTEGER AUTOINCREMENT**: `conversation_files`,
  `cost_events`, `events`, `health_events`, `merge_queue`, `merge_set_repos`,
  `pending_auto_merges`, `review_run_agents`, `status_history`,
  `uat_generation_resolutions`, `discovered_sessions`, `git_operations`.
- **Composite primary keys**: `favorites (type, item_id)`,
  `discovered_session_tags (session_id, tag)`,
  `discovered_session_tools (session_id, tool)`,
  `discovered_session_files (session_id, file_path)`,
  `session_embeddings (session_id, model)`,
  `uat_generation_members (uat_name, issue_id)`.

FK/target type matches were verified consistent — e.g.
`discovered_session_*.session_id` is INTEGER and matches
`discovered_sessions.id` INTEGER; `conversation_files.conversation_id` TEXT
matches `conversations.id` TEXT; `merge_set_repos.issue_id` TEXT matches
`merge_sets.issue_id` TEXT. No mismatched id-pair found.

---

## Index notes

- **5 unique indexes**: `conversations_name_unique (name)`,
  `cost_request_id_idx (request_id) WHERE request_id IS NOT NULL`,
  `merge_queue_issue_id_unique (issue_id)`,
  `pending_auto_merges_active_issue_idx (issue_id) WHERE status IN ('pending','merging')`,
  `status_history_unique_idx (issue_id, type, status, timestamp)`.
- **Inline unique constraint**: `discovered_sessions.jsonl_path TEXT NOT NULL UNIQUE`.
- **3 partial indexes** (two of them are the unique ones above, plus
  `idx_discovered_session_id WHERE session_id IS NOT NULL`).
- **`transcripts` has no secondary indexes at all** (only its
  `backing_file_path` PK). If it's ever queried by `session_id`, `pan_issue_id`,
  or `pan_agent_id`, it will table-scan — worth confirming that's intended.
- **`review_status` has only one index** (`updated_at`) despite being the
  widest table (37 columns) and the lookup target by `issue_id` (its PK, so
  covered). Fine, but noted.

---

## Relationships documented but not drawn (to keep the diagram readable)

- **Self-references on `conversations`** (declared FKs, not drawn as loops):
  `handoff_target_conv_id → conversations.id`,
  `cleared_to_conv_id → conversations.id`.
- **Logical `*_id → agents.id` references not drawn** (would cross half the
  canvas; listed here for completeness): `health_events.agent_id`,
  `cost_events.agent_id`, `review_run_agents.agent_id`,
  `agents.review_synthesis_agent_id` (self), `agents.review_run_id → review_runs.run_id`
  (this one **is** drawn, dashed).
- **JSON-in-TEXT columns** (consistent pattern, not a bug, recorded so it
  isn't mistaken for one): `events.payload`, `health_events.metadata`,
  `issues.blockers`, `review_status.inspect_notes/verification_notes/…`,
  `discovered_sessions.tools_used/files_touched/tags/models_used`,
  `uat_generation_resolutions.issue_ids/files`,
  `agents.role_run_head` / `agents.fork_request`-style fields. These are JSON
  payloads serialized into TEXT by design.

---

## Methodology

1. Parsed `drizzle/overdeck/0000_overdeck_init.sql` (CREATE TABLE bodies,
   column-level + table-level constraints, inline `REFERENCES`, all indexes).
2. Emitted `docs/overdeck-db-erd.mmd` (Mermaid `erDiagram`) as the accurate,
   reviewable intermediate.
3. Emitted `docs/overdeck-db-erd.excalidraw` in the same idiom as the existing
   `docs/overdeck-db-erd.excalidraw` (rounded domain-colored rectangle +
   title text + monospaced columns text per table), extended to render the
   TYPE / PK / FK / NN / index markers required for this review.
4. Cross-check pass: every `CREATE TABLE`, column, `REFERENCES`, and
   `CREATE INDEX` confirmed present (0 mismatches).
5. Loaded into the local canvas at `http://localhost:3000` via
   `POST /api/elements/sync` and verified the render (0 overlaps,
   0 text-truncation risks, 0 vertical overflow).

Regenerate with: `python3 scripts/gen-overdeck-erd.py`
(re-writes `docs/overdeck-db-erd.{excalidraw,mmd}`).
