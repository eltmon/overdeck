# Overdeck Remodel — `overdeck-schema.ts` Verification Against Ground Truth

**Goal:** verify every table/column/PK/FK/type in
[`docs/overdeck-remodel/overdeck-schema.ts`](../overdeck-schema.ts) against BOTH
sources of truth — the live `src/lib/database/schema.ts` (real `CREATE TABLE`s)
and the per-domain NEED-set audits in this directory — to catch every table that
was drafted speculatively, the way the Merge-domain tables were (`uat_generations`
missing its real `name` PK, bogus `issue_id` FK).

**Method:** per table, cross-check columns / primary key / foreign keys / types
against (1) the live `CREATE TABLE` in `schema.ts` and (2) the corresponding
audit's NEED/DROP verdict. Per-field DROPs justified by an audit are NOT flagged.
Booleans-as-integer and timestamps-as-integer are intentional Drizzle conventions
and NOT flagged.

**Headline:** **3 tables with real errors, 1 table with a stated-rule FK
violation, 2 minor notes; all other tables verified OK.** The two headline
errors are the same class as the Merge `uat_generations` bug the operator already
caught — a table normalized/redrafted from memory that silently drops
load-bearing columns or mis-models cardinality.

---

## Per-table verdicts

### `issues` — OK (two folds to confirm, both defensible)
Synthesized from `review_status` (durable verdict columns) + `issue_state`.
- Columns trace: `stage` (replaces the 8 status axes per the schema header),
  `reviewOutcome`/`testOutcome`/`verificationOutcome` = the three LOAD-BEARING
  gates (gates-minimum.md §1–3 — verification is NOT redundant, it is the
  authoritative post-rebase gate), `blockers` (typed; replaces `blocker_reasons`
  + labels, review-state-audit.md:80), `prUrl`/`prNumber`/`prHeadSha` (all three
  KEEP, review-state-audit.md:64-66), `planRef`, `updatedAt`.
- **Fold 1 — `verdictCommit` collapses `reviewed_at_commit` + `last_verified_commit`.**
  The live schema keeps these as TWO separate freshness re-triggers: review
  re-opens when `HEAD !== reviewed_at_commit` (deacon.ts:3052/3078), verification
  re-runs when `HEAD !== last_verified_commit` (deacon.ts:2710). Because the
  authoritative verification re-run happens **post-rebase** (gates-minimum.md §3,
  `workspaces.ts:5531-5567`), the verification-pass commit and the review-pass
  commit are generally **different SHAs**. A single `verdictCommit` cannot
  represent both freshness gates independently — confirm one commit can carry both
  before finalizing, else split it back into two columns. **Flag to confirm, not a
  hard error.**
- **Fold 2 — `merge_status` dropped.** `merge_status` is KEEP/DURABLE in
  review-state-audit.md:52; its only durable branch-use is the terminal
  `=== 'merged'` "already merged" check (`mergeGateEligibility`, review-status.ts:149).
  That maps to a `stage` value. **Caveat:** the `Stage` literal union
  (ARCHITECTURE-CONVENTIONS.md:55) is
  `todo|planning|planned|working|in_review|testing|verifying|merging|verifying_on_main|closed|cancelled`
  — there is **no terminal `merged`**; the post-merge state is `verifying_on_main`.
  Justified fold **provided** the "already merged → skip" gate is rewritten to read
  `stage ∈ {verifying_on_main, closed}` instead of a dropped `merge_status`. Record
  as a fold, not a loss.

### `agents` — OK
All 21 overdeck columns match the 21-KEEP NEED set in agents-state-audit.md
(the 3 MERGEs — `stopped_by_pause`→`paused`, `supervisor_enabled`/`channels_enabled`
→`delivery_method` — are already folded). Dropped columns (`branch`, `phase`,
`work_type`, `last_activity`, `stopped_at`, the 4 failure-timestamp display fields,
the 9 `review_*`/`inspect_*` squatters, `flywheel_run_id`, `role_run_head`,
`cost_so_far`) are all audit-justified DROP/DERIVE/MOVE. `issueId` hard FK→issues.id
is sound (every agent has an issue). `sessionId` correctly a soft pointer (no FK).

### `health_events` — discrepancy (FK violates the schema's own stated rule)
Columns match the audit NEED set (observability-audit.md Q3): drops `previous_state`
(audit-justified — derivable from the adjacent ordered row). **BUT:**
- **`agentId` is `notNull()` + hard FK → `agents.id`.** Live `health_events.agent_id`
  is plain `TEXT NOT NULL` with **no FK** (schema.ts:290-298). `agents` is a
  disposable cache reconciled from tmux and prunable; `health_events` rows
  **outlive** their agent (the audit's oldest row is 3 months old; agents are
  long gone). With `PRAGMA foreign_keys=ON`, this hard FK (a) fails the insert if
  the agent row was already pruned, and (b) blocks pruning any agent that still
  has health rows. This **contradicts the schema header's own rule** ("hard FKs
  only where the referenced row is guaranteed to exist; soft pointers to
  cache-only rows are NOT FK-constrained"). **Fix: make `agentId` a soft pointer
  (plain TEXT, no FK), like `agents.session_id`.**

### `conversations` — OK
Matches the 14-field EXPORT (SOURCE-OF-TRUTH) set in
conversations-transcripts-audit.md:92-110 + conversation-backing-files.md §4.1:
`id, name, cwd, issueId, harness, model, effort, title, titleSource, createdAt,
archivedAt, handoffDocPath, handoffTargetConvId, clearedToConvId`. The dropped
CACHE/DEAD columns (`tmux_session`, `status`, `ended_at`, `last_attached_at`,
`session_file`, `title_seed`, `total_cost`, `total_tokens`, `fork_*`,
`delivery_method`, `spawn_error`) are all audit-justified. The critical
`claude_session_id` pointer is **not** dropped — it is relocated to
`conversation_files.locator` (correct; see below). Self-FK lineage edges
(`handoffTargetConvId`, `clearedToConvId` → conversations.id) are sound.
*Note:* overdeck `id` is `text` (operator-assigned) vs live autoincrement INTEGER —
this is the deliberate "key by portable name/id" change; lineage/favorites resolve
by this stable id rather than an autoincrement. Acceptable.

### `conversation_files` — OK (new table; traces to the audit)
New normalization of the per-harness backing-file pointer
(conversation-backing-files.md §1, §5.1: "a conversation may back to more than one
file type"). `(conversationId FK→conversations.id, harness, locator)` with the
locator being claude session UUID / pi agentId / codex threadId — traces exactly to
the per-harness pointer map (conversation-backing-files.md §2). Sound.

### `favorites` — discrepancy (drops half the table; re-keys against audit guidance)
Live `favorites` is **polymorphic**: `type TEXT NOT NULL -- 'conversation' or
'project'`, `item_id` = conversation **name** or **project path**, `UNIQUE(type,
item_id)` (schema.ts:532-538). Overdeck `favorites` is conversation-only:
`(conversationId FK→conversations.id PK)`.
- **Drops `type='project'` favorites entirely.** The current `FavoriteType` in
  code is narrowed to `'conversation'` (conversations-db.ts:824), so project
  favorites may not be actively written today — but the live table, its `UNIQUE(type,
  item_id)` key, and the schema comment all still model the polymorphic set, and
  `favorites` is named an **irreplaceable preserve set** (conversations-transcripts
  -audit.md:112). Dropping a documented half of an irreplaceable table is exactly
  the Merge-class error. **Confirm project-favorites are truly dead before
  collapsing; if not, keep `type` + `item_id`.**
- **Re-keys by `conversationId` (id-FK), but the audit says export favorites by
  conversation `name`** (conversations-transcripts-audit.md:112-113,
  conversation-backing-files.md:232 — "id is autoincrement and not portable"). With
  overdeck's `text` conversation id this is less acute, but the audit's explicit
  contract is **name-keyed**; verify the export still resolves favorites by `name`.

### `transcripts` — OK (100% cache; three notes, all acceptable-to-lose)
Renamed/reshaped from live `discovered_sessions` (conversations-transcripts-audit.md
§2a: 100% CACHE). PK changed to `backingFilePath` (the file path; live used
autoincrement `id` with `jsonl_path` UNIQUE) — reasonable for a path-keyed index.
Three audit-justified reductions, called out explicitly:
- **`harness` is ADDED** (not a `discovered_sessions` column). Defensible under the
  multi-harness transcript model (claude/pi/codex) — flagged as added/derived from
  parser dispatch, not invented-without-basis.
- **`file_size` dropped, `fileMtime` kept.** The scan's incremental change-detection
  key is **`(file_size, file_mtime)`** (conversations-transcripts-audit.md:166-169).
  mtime-only **weakens** change detection (a same-mtime size change is missed).
  Minor; note it.
- **`tools_used`/`files_touched`, the three satellite tables
  (`discovered_session_tags`/`_tools`/`_files`), `sessions_fts`, and
  `session_embeddings` are all gone.** These back archived-conversation array
  filtering + session search — pure CACHE (audit §2b-2d). Acceptable-to-lose
  capability; FTS/embeddings rebuild from enrichment text. OK as a cache reduction.

### `cost_events` — discrepancy (dropped the `request_id` UNIQUE dedup index) + FK note
Columns are exactly the 14-column NEED set + `id` PK (cost-audit.md:86-89):
`ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read,
cache_write, cost, request_id, session_id, source_file`. The 5 dropped columns
(4 `tldr_*` + `caveman_variant`) are 0%-populated DEAD (audit-confirmed). Making
`issueId`/`agentId` **nullable FKs** instead of the live `'UNKNOWN'`/`'unattributed'`
NOT-NULL string sentinels is a defensible design change the audit endorses
(cost-audit.md:253 "treat UNKNOWN as a first-class bucket").
- **ERROR — the `request_id` partial UNIQUE index is silently dropped.** Live
  schema.ts:197-198 has
  `CREATE UNIQUE INDEX idx_cost_request_id ON cost_events(request_id) WHERE request_id IS NOT NULL`.
  Overdeck's index list is only `cost_issue_idx` + `cost_ts_idx` — the partial
  UNIQUE is gone. cost-audit.md:77,152 calls this "the **entire idempotency
  guarantee** for re-import — without it, reconciler re-runs would double-count,"
  and the rebuild recipe leans on "`request_id` UNIQUE makes the union idempotent."
  This is a load-bearing constraint dropped without justification — exactly the
  Merge-class failure mode. **Fix: restore the partial UNIQUE index on
  `request_id`.**
- **FK note (same class as `health_events`):** `agentId` → `agents.id` as a hard
  FK against a prunable cache means cost rows that outlive their agent either fail
  to insert or block agent pruning. The schema's own rule wants this to be a **soft
  pointer**. `issueId`→issues.id is safer (issues are longer-lived) but cost rows
  for closed/purged issues have the same risk. Prefer soft pointers for both, or
  guarantee agents/issues are never pruned ahead of their cost rows.

### `merge_sets` — OK
Matches live `merge_sets` exactly (schema.ts:587-595); PK `issueId`
(one set per issue) FK→issues.id sound. All CACHE (orchestration-config-audit.md §2).

### `merge_set_repos` — OK
Matches live `merge_set_repos` (schema.ts:600-617) field-for-field: all gate-status
columns, `mergeOrder`, `required`, `forge`, branches, artifact fields present.
FK `issueId`→`mergeSets.issueId` matches the live `FOREIGN KEY (issue_id)
REFERENCES merge_sets(issue_id)`. Sound.

### `merge_queue` — OK
Matches live `merge_queue` (schema.ts:544-552). `issueId` UNIQUE FK→issues.id
matches live `issue_id TEXT NOT NULL UNIQUE`. The sequential merge lock; CACHE.

### `pending_auto_merges` — discrepancy (dropped the active-issue UNIQUE guard); column drops OK
Live has 14 cols (schema.ts:558-572); overdeck keeps 11. Column drops are all
justified:
- `prNumber` — DROP justified, derivable from `prUrl` (schema comment; no
  independent durable use).
- `cancelledAt`/`cancelledBy` — DROP justified: grep found only the **write** path
  (flywheel.ts:370/386-387); **no branch-read** consumes them, and the table is a
  transient CACHE cooldown buffer (orchestration-config-audit.md §2, all rows are
  stale `failed`). Display-only on a disposable buffer → safe to drop.
- **Index discrepancy — the "one active auto-merge per issue" UNIQUE guard is
  dropped.** Live schema.ts:574-575 has
  `CREATE UNIQUE INDEX idx_pending_auto_merges_active_issue ON pending_auto_merges(issueId) WHERE status IN ('pending','merging')`.
  Overdeck has only the non-unique `pending_auto_merges_issue_idx`. This partial
  UNIQUE prevents scheduling two concurrent auto-merges for the same issue; same
  category as the `cost_events` drop, lower stakes (transient buffer). **Confirm
  whether the single-active-merge guard was meant to survive; if so, restore the
  partial UNIQUE.**
FK `issueId`→issues.id sound.

### `uat_generations` — OK
Matches live `uat_generations` (schema.ts:359-372) for the kept columns; PK is the
batch `name` (correct — this is the table whose Merge-domain sibling the operator
already fixed). The `members`/`held_out`/`resolutions` JSON arrays are intentionally
removed here and normalized into `uat_generation_members` (next). The generation
row itself is OK.

### `uat_generation_members` — **ERROR (Merge-class: lossy normalization + cardinality mismatch)**
This is the headline error. Overdeck models the batch contents as
`(uatName, issueId, role ∈ {member,held_out}, resolution: json)` with composite PK
`(uatName, issueId)`. The live source (uat-generations-db.ts:38-64) shows the three
arrays carry **distinct, load-bearing structure that this table drops or mis-models**:

1. **`members` (`UatGenerationMember`) loses `branch`, `headSha`, `mergeOrder`, `pr`,
   `prUrl`.** Only `issueId` survives as a member. **`mergeOrder` (1-based merge
   position) is load-bearing** for assembly order; `headSha` is the staleness key.
   All dropped with no audit justification — these are real NEED columns.
2. **`heldOut` (`UatGenerationHeldOut`) loses `branch`, `headSha`, and `reason`.**
   The held-out **reason** (human-readable exclusion explanation) is the whole point
   of recording a held-out issue; it is dropped (only `role='held_out'` survives).
3. **`resolutions` (`UatGenerationResolution`) is mis-modeled — cardinality mismatch.**
   A resolution is `{ issueIds: string[], files: string[], commitSha }` — it spans
   **multiple issues** and carries `files[]` + `commitSha`. Modeling it as a per-
   `(uatName, issueId)` JSON `resolution` column **cannot represent** a resolution
   that references issues other than the row's own `issueId`, and would duplicate or
   lose `files`/`commitSha`. A resolution is a `(uat, set-of-issues)` entity, not a
   `(uat, single-issue)` attribute.

**Fix:** this normalization needs (a) the member attributes `branch`, `headSha`,
`mergeOrder`, `pr`, `prUrl` as real columns; (b) the held-out `reason` (+ branch/
headSha); and (c) a **separate** `uat_resolutions` table keyed by `(uatName,
resolutionId)` with a `files` JSON / `commitSha` and a child join for its
many `issueIds` — not a per-member JSON blob.

### `app_settings` — OK
Matches live `app_settings` (schema.ts:349-353): `key` PK, `value`, `updatedAt`.
SOURCE-OF-TRUTH-acceptable-to-reset (orchestration-config-audit.md §4). Overdeck
types `value` as nullable JSON; live is `NOT NULL TEXT`. Minor: live setter never
writes null (app-settings.ts), so nullable is harmless; JSON-mode is a reasonable
convention change. OK.

### `issue_policy` — OK (new split-out table; traces to the audit)
Splits the two operator/policy control flags out of `review_status`:
`deaconIgnored` + `autoMerge`, both marked KEEP-but-NEITHER-verdict in
review-state-audit.md:77,87 ("belong with per-issue runtime control / merge-train
config, not the review verdict"). PK `issueId`→issues.id sound. Correctly drops the
display-only `deacon_ignored_at`/`deacon_ignored_reason` (review-state-audit.md:78-79
DROP). Matches orchestration-config-audit.md §3 Domain B placement. OK.

### `transcript_checkpoints` — **ERROR (Merge-class: invented columns + dropped load-bearing columns)**
Headline error #2. Overdeck has
`sessionId, transcriptPath, lastOffset, claimOwner, claimLeaseUntil, claimToken,
claimedAt, midTurnCountInCurrentTurn, lastMidTurnAt, projectId, workspaceId,
issueId, updatedAt`.

The live lease model (verified directly in `src/lib/memory/checkpoints.ts:64-272`)
is `claim_owner, claim_from, claim_to, claim_expires_at`. memory-audit.md:131-134
marks **all four KEEP** with genuine branch-reads:
- `claim_from` / `claim_to` — the leased byte range; `releaseTranscriptRange`
  releases `WHERE claim_from = ? AND claim_to = ?` (checkpoints.ts:225-226).
- `claim_expires_at` — the 60s lease-steal predicate `WHERE (claim_owner IS NULL OR
  claim_expires_at < @now)` (checkpoints.ts:104) and the already-claimed freshness
  check (checkpoints.ts:132).

Overdeck **invented three columns that do not exist anywhere in the code**
(`claimLeaseUntil`, `claimToken`, `claimedAt` — zero references in
`src/lib/memory/`) and **dropped two load-bearing NEED columns** (`claim_from`,
`claim_to`) plus replaced `claim_expires_at` with the invented `claimLeaseUntil`.
Without `claim_from`/`claim_to` the release WHERE clause cannot identify the range;
`claimToken`/`claimedAt` have no reader.

**Fix:** restore the live lease columns — `claimOwner, claimFrom, claimTo,
claimExpiresAt` — and delete the invented `claimToken`/`claimedAt`/`claimLeaseUntil`.
(Note: memory-audit.md headline says "3 DROP" but its own column table marks only
`last_observation_at` as DROP; the two rate-limit timestamps `mid_turn_count_in_
current_turn`/`last_mid_turn_at` are KEEP — overdeck correctly keeps those two and
correctly drops `last_observation_at`.)

### `events` — OK
Matches live `events` (schema.ts:411-416) exactly: `sequence, type, timestamp,
payload`. All 4 NEED (observability-audit.md Q1). Disposable pub/sub cache. OK.

---

## Scope flag (not a per-table discrepancy)

The `review_*` cluster (`review_run_id`, `review_synthesis_agent_id`,
`review_output_path`, `review_deadline_at`, `review_monitor_signaled`,
`review_retry_attempt`, `review_sub_role`), plus `flywheel_run_id` and
`role_run_head`, are **MOVE→Orchestration** per agents-state-audit.md. There is **no
Orchestration / review-run table in `overdeck-schema.ts`.** The deacon's review
monitor branch-reads all of these during a live review run (review-state-audit.md
Table 2). **Confirm they land in an Orchestration store outside this schema file,
else the review-monitor gates lose their home.** Likewise the EPHEMERAL REVIEW-RUN
recovery counters from `review_status` (`auto_requeue_count`, `merge_retry_count`,
`test_retry_count`, `review_retry_count`, `recovery_started_at`, `stuck`/
`stuck_reason`, `review_spawned_at`, `conflict_resolution_dispatched_at`,
`verification_cycle_count`) are KEEP-but-EPHEMERAL and have no home in the `issues`
table (correct — they are not durable verdict) but need an Orchestration home.
