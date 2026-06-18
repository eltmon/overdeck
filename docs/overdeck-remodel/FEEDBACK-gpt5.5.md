# Executive Summary

The direction is sound: the current code really does have too many state axes, too many direct stores, and too much DB/state-file duplication. The "two doors per domain" model is the right cure for that class of drift.

The design is not yet safe to lock. The biggest risk is not migration compatibility; it is that the proposed "disposable cache" story is already false for several live surfaces. Conversations/favorites are explicitly DB truth, UAT generation history is currently DB truth, pending auto-merge cancellation metadata is DB truth, and Memory's checkpoint/FTS state is partly an operational cursor rather than a rebuildable projection.

The schema is better grounded than the earlier drafts, but it still drops live columns with branch/display value (`pending_auto_merges.cancelledAt/cancelledBy`, conversation lifecycle/fork columns, FTS/enrichment data) without a source-of-truth replacement. A fresh empty `overdeck.db` would lose behavior unless those facts are exported or deliberately reset with a named no-loss decision.

The API no-loss proof is incomplete. `services/issues.md` is useful for issue-state surfaces, but the live route/RPC tree has Flywheel/UAT, discovered sessions, terminal, editor/file, specialist, and resource surfaces that are not mapped remodel-wide.

Effect v4 conventions mostly match the installed package for `Context.Service`, `Schema.TaggedErrorClass`, `HttpApi*`, and RPC. The Drizzle part does not match the installed dependency set: `better-sqlite3` is installed, but `drizzle-orm` and `drizzle-kit` are not.

My strongest objection: the design sells the big-bang as "low risk" because the old DB is a backup, but several new domains either keep DB-as-truth or reset DB-only operational truth. That is not low risk until the export/rebuild contract is implemented and tested as a cutover gate.

# Prioritized Findings

## P0: `pending_auto_merges` drops cancellation evidence while preserving `cancelled` as a state

**Claim:** The Overdeck schema loses who cancelled an auto-merge and when.

**Evidence:** The live schema has `cancelledAt` and `cancelledBy` columns on `pending_auto_merges` (`src/lib/database/schema.ts:568-571`). The live DB API exposes those fields in the public type and row mapper (`src/lib/database/pending-auto-merges-db.ts:19-23`, `src/lib/database/pending-auto-merges-db.ts:46-49`, `src/lib/database/pending-auto-merges-db.ts:63-66`), and `cancelPending()` writes both fields when it changes status to `cancelled` (`src/lib/database/pending-auto-merges-db.ts:233-237`). Overdeck keeps the `cancelled` status but drops both fields (`docs/overdeck-remodel/overdeck-schema.ts:244-255`).

**Fix:** Add `cancelled_at` and `cancelled_by` to `pending_auto_merges`, or move cancellation actor/time into a durable git record/event that the Merge resolver can rebuild from. If the decision is to intentionally forget cancellation attribution at cutover, state that as a destructive reset and remove the no-loss claim for this surface.

## P0: UAT generation history is not rebuildable from the stated four homes

**Claim:** The design calls Merge "all cache", but live UAT generations are durable audit history in SQLite today.

**Evidence:** The current UAT storage says the table is a "Persistent chain" and "auditable history of what was bundled, which conflicts were resolved, and what was promoted" (`src/lib/database/uat-generations-db.ts:1-7`). The live schema stores `members`, `held_out`, and `resolutions` JSON on `uat_generations` (`src/lib/database/schema.ts:359-371`). The API lists all generations and collision-checks names from the DB (`src/lib/database/uat-generations-db.ts:154-186`). Overdeck normalizes the JSON into `uat_generation_members` and `uat_generation_resolutions` (`docs/overdeck-remodel/overdeck-schema.ts:264-306`), but its source-of-truth statement says Merge is "All CACHE" rebuilt from `projects.yaml` and forge PR state (`docs/overdeck-remodel/overdeck-schema.ts:195-200`). `projects.yaml` plus GitHub PR state cannot reconstruct held-out reasons, resolution file lists, stack timing, cleaned timing, or prior generated batch names.

**Fix:** Pick a durable home for UAT generations before cutover: likely a git record under `.pan/records` or `.pan/uat-generations`. Then rebuild the normalized Overdeck tables from that file. If old UAT history is intentionally discarded, say so and delete the "auditable history" behavior from the target surface.

## P0: Conversation metadata is still DB truth, but the export is a future dependency

**Claim:** The remodel has a DB-as-truth exception that is not implemented, yet the architecture still frames the DB as disposable.

**Evidence:** The proposed schema itself says `conversations` and `favorites` are "irreplaceable DB-resident metadata" and depend on export `PAN-1937`, "not yet built" (`docs/overdeck-remodel/overdeck-schema.ts:6-11`, `docs/overdeck-remodel/overdeck-schema.ts:88-93`). Live conversation rows contain fields that are not reconstructable from JSONL alone: `tmux_session`, `status`, `ended_at`, `last_attached_at`, `title_seed`, `fork_status`, `fork_error`, `delivery_method`, `spawn_error`, `fork_fallback_reason`, `fork_request`, and `fork_retry_count` (`src/lib/database/schema.ts:486-518`; mapped in `src/lib/database/conversations-db.ts:36-85`). Overdeck drops several of these and changes the primary key from live autoincrement integer to text (`docs/overdeck-remodel/overdeck-schema.ts:95-110`), while favorites point at conversation names rather than row ids (`docs/overdeck-remodel/overdeck-schema.ts:127-135`).

**Fix:** Make `PAN-1937` a blocking prerequisite with a test that exports/imports the full conversation/favorite contract, including fork recovery and lifecycle fields. If lifecycle fields are intended to reset at cutover, document each reset and verify the dashboard/CLI no longer branch on them.

## P0: Memory cannot be reduced to only `transcript_checkpoints` without preserving FTS/reset-marker rebuild semantics

**Claim:** The Memory domain is underspecified and would lose search/archive behavior.

**Evidence:** Overdeck says Memory's entire database footprint is `transcript_checkpoints` (`docs/overdeck-remodel/overdeck-schema.ts:360-380`). Live Memory also has per-project `memory_fts`, `reset_markers`, and `observation_index` tables in a separate FTS database (`src/lib/memory/fts-operations.ts:50-98`). Search filters against `reset_markers` to exclude archived/reset observations unless `includeArchived` is set (`src/lib/memory/search.ts:121-128`). Write-side indexing records observation byte offsets in `observation_index` (`src/lib/memory/observations.ts:120-185`). The checkpoint table is an operational dedup cursor and lease store (`src/lib/memory/checkpoints.ts:70-143`, `src/lib/memory/checkpoints.ts:146-212`), not a full search index.

**Fix:** Either explicitly keep Memory FTS/`observation_index`/`reset_markers` as separate disposable caches with a real rebuilder from observation JSONL/markdown, or add equivalent Overdeck tables. Also define cutover behavior for `last_offset` and active claims: resetting cursors to zero may be acceptable only if observation IDs are idempotently deduped during replay.

## P1: The no-loss audit is not remodel-wide

**Claim:** `services/issues.md` proves only the Issues slice, not the full API/CLI/RPC surface.

**Evidence:** The Issues service doc explicitly scopes Part 1 to surfaces that "read or write issue state" (`docs/overdeck-remodel/services/issues.md:92-113`). The live RPC contract includes conversation scan/search/enrich/embed, terminal streaming/control, workspace file reads, file-path existence checks, editor integration, and Flywheel status subscriptions (`packages/contracts/src/rpc.ts:22-70`). The live HTTP tree includes discovered-session stats/list/search/enrich/embed/config/test-connection (`src/dashboard/server/routes/discovered-sessions.ts:196-249`, `src/dashboard/server/routes/discovered-sessions.ts:301-367`, `src/dashboard/server/routes/discovered-sessions.ts:398-699`, `src/dashboard/server/routes/discovered-sessions.ts:704-780`), terminal create/delete (`src/dashboard/server/routes/terminals.ts:58-95`), Flywheel config/auto-merge/UAT endpoints (`src/dashboard/server/routes/flywheel.ts:542-695`, `src/dashboard/server/routes/flywheel.ts:697-884`, `src/dashboard/server/routes/flywheel.ts:886-970`), and many specialist lifecycle endpoints.

**Fix:** Add a remodel-wide API-surface matrix generated from `HttpRouter.add`, `WS_METHODS`, and `src/cli/index.ts`, with each entry mapped to a target controller/resolver/writer or an explicit delete/reset. Make this a no-loss gate before declaring the schema locked.

## P1: The hard foreign keys assume rebuild ordering and issue coverage that the current design does not prove

**Claim:** Enforced FKs are good, but the current schema adds hard references to `issues` from several cache tables without a rebuild plan that guarantees all referenced issue rows exist first.

**Evidence:** Overdeck adds FKs from `agents.issue_id`, `conversations.issue_id`, `merge_sets.issue_id`, `merge_queue.issue_id`, `pending_auto_merges.issue_id`, `uat_generation_members.issue_id`, and `issue_policy.issue_id` to `issues.id` (`docs/overdeck-remodel/overdeck-schema.ts:53-75`, `docs/overdeck-remodel/overdeck-schema.ts:95-111`, `docs/overdeck-remodel/overdeck-schema.ts:202-260`, `docs/overdeck-remodel/overdeck-schema.ts:282-293`, `docs/overdeck-remodel/overdeck-schema.ts:319-323`). Live tables do not enforce those constraints; for example `agents.issue_id` is plain text (`src/lib/database/schema.ts:433-442`), `pending_auto_merges.issueId` is plain text (`src/lib/database/schema.ts:558-571`), and `conversations.issue_id` is optional text (`src/lib/database/schema.ts:486-518`). The design says GitHub owns issue/PR status and `.pan/records` owns pipeline facts, but it does not specify an FK-safe rebuild order or what happens for archived conversations, old agents, or UAT members whose issue is closed, deleted, or no longer returned by the tracker.

**Fix:** Write a rebuild algorithm that materializes placeholder/tombstone `issues` rows for every referenced issue id before loading dependent tables, or downgrade specific references to soft pointers where rows legitimately outlive tracker issue rows. Add a rebuild test with closed/deleted/ad-hoc issue ids.

## P1: Drizzle is not currently installed, and the import example is not verified in this repo

**Claim:** The Effect v4 parts are mostly grounded; the Drizzle claim is a dependency gap.

**Evidence:** `package.json` pins `effect@4.0.0-beta.73` (`package.json:37-42`, `package.json:131`) and has `@effect/platform-node` installed (`package.json:112-115`). `Context.Service` exists in the installed Effect package (`node_modules/effect/dist/Context.d.ts:129-153`), and the RPC/HTTP API modules exist under `effect/dist/unstable/rpc` and `effect/dist/unstable/httpapi`. `better-sqlite3` is present in `node_modules`, but `node_modules/drizzle-orm` and `node_modules/drizzle-kit` are absent, and neither package appears in `package.json`. Yet the Overdeck schema imports `drizzle-orm/sqlite-core` and `drizzle-orm` (`docs/overdeck-remodel/overdeck-schema.ts:19-23`), and the conventions claim Drizzle plus `better-sqlite3` are already installed (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:100-104`).

**Fix:** Add `drizzle-orm` and `drizzle-kit` to the planned dependency diff and compile a tiny smoke test importing `sqliteTable`, `.references()`, partial `uniqueIndex(...).where(sql\`...\`)`, and the better-sqlite3 driver under Node 22.

## P1: The two-door enforcement is a convention until backed by lint/module boundaries

**Claim:** Effect dependency types can prevent a handler from using `Db` only if the handler module cannot import or provide `Db` directly.

**Evidence:** The convention says controllers never receive `Db`, so direct DB access is a compile error (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:22-27`, `docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:168-174`). Current code shows route modules freely import DB helpers today; for example `routes/conversations.ts` imports many conversation DB functions directly (`src/dashboard/server/routes/conversations.ts:51-86`), and `ws-rpc.ts` imports `getConversationByName` directly (`src/dashboard/server/ws-rpc.ts:17`). Nothing in TypeScript prevents a future controller from importing `DbLive` or a Drizzle table unless the repo adds an architectural lint rule.

**Fix:** Define package/module boundaries: only `src/overdeck/domains/*/{resolver,writer}.ts` may import `Db`, Drizzle tables, or source-store writers. Add an ESLint or `rg`-based CI check before migration starts, and include route/RPC/CLI directories in the denylist.

## P1: Sacred-file read-only is known false in current code and needs a hard cutover gate

**Claim:** The design correctly identifies a read-only violation, but it is not just a note; it blocks the Transcript model.

**Evidence:** Overdeck says transcript backing files are sacred and "STRICTLY READ-ONLY" (`docs/overdeck-remodel/overdeck-schema.ts:137-144`). The live compaction service appends Overdeck-authored compact entries directly to the existing session file (`src/dashboard/server/services/conversation-compaction.ts:1-2`, `src/dashboard/server/services/conversation-compaction.ts:164`). The backing-file investigation calls this the one in-place mutation that must be addressed (`docs/overdeck-remodel/investigations/conversation-backing-files.md:163-170`, `docs/overdeck-remodel/investigations/conversation-backing-files.md:205`).

**Fix:** Treat the compaction rewrite as a P0 cutover prerequisite: convert it to the fork/new-file pattern, then add a test or static check that no production code appends to or rewrites existing transcript files except harness-owned creation/append paths.

## P1: Review-run state keyed only by `issueId` loses convoy shape

**Claim:** `review_runs` collapses per-agent/per-sub-role runtime into a single row per issue.

**Evidence:** Overdeck says a convoy has multiple per-agent sub-role reviewers, but the row "holds only the current cycle's values" and is keyed by `issueId` (`docs/overdeck-remodel/overdeck-schema.ts:326-358`). Live agent columns include `review_sub_role`, `review_run_id`, `review_synthesis_agent_id`, `review_output_path`, `review_deadline_at`, `review_monitor_signaled`, and `review_retry_attempt` on each agent row (`src/lib/database/schema.ts:466-472`). The agents audit says these fields drive per-reviewer routing, report lookup, timeout, dedup, and retry (`docs/overdeck-remodel/investigations/agents-state-audit.md:98-104`). A single `reviewSubRole` and `reviewOutputPath` per issue cannot represent four concurrent reviewer lanes plus a synthesis agent.

**Fix:** Model review runs as `review_runs(run_id, issue_id, ...)` plus `review_run_agents(run_id, agent_id, sub_role, output_path, deadline_at, monitor_signaled, retry_attempt, ...)`, or keep these fields on Agents until Orchestration has a proper per-lane table.

## P2: `README.md` still contradicts the settled Drizzle decision

**Claim:** The docs disagree on the cache stack.

**Evidence:** `README.md` still says the locked principle is "Effect all the way down" with "`@effect/sql` cache" (`docs/overdeck-remodel/README.md:21-24`). `END-STATE.md` says the settled decision is Drizzle plus `better-sqlite3`, deliberately not `@effect/sql` (`docs/overdeck-remodel/END-STATE.md:131-136`). The conventions doc says the same Drizzle decision (`docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md:100-104`).

**Fix:** Update `README.md` so the top-level framing no longer advertises `@effect/sql`.

## P2: Status-history deletion needs an explicit replacement for operator history

**Claim:** Dropping `status_history` may be fine, but "derivable from events" is not proven.

**Evidence:** Live `status_history` stores `issue_id`, status type, status, timestamp, and notes with a unique dedup index (`src/lib/database/schema.ts:270-283`). Overdeck lists it as deleted and says it is derivable from events (`docs/overdeck-remodel/overdeck-schema.ts:397-404`). The EventBus table is explicitly disposable pub/sub transport (`docs/overdeck-remodel/overdeck-schema.ts:382-392`), so it is not a durable audit source by itself.

**Fix:** Either declare status history non-durable and delete any operator surface that depends on it, or write stage/gate transitions into `.pan/records` history so `status_history` can be rebuilt from a real home.

# What's Good / Keep

- Keep the central thesis: one resolver and one writer per domain is the right structural answer to the current drift. The codebase has many direct DB imports in routes today, so moving those behind services is load-bearing.
- Keep the source-first, cache-second writer ordering. The docs correctly avoid claiming git/GitHub plus SQLite atomicity; ordering plus checked cache writes is the achievable guarantee.
- Keep the decision to make tmux the liveness oracle. Current agent status is already reconciled from tmux, and treating stored status as cache matches the live system.
- Keep the `hold()` correction in the Issues service. Moving paused/troubled/deacon-ignored/auto-merge out of Issues preserves the domain boundary instead of making Issues a flag sink.
- Keep hard FKs where the referenced row is guaranteed and rebuild order is explicit. They will catch drift that the current schema permits.
- Keep Transcripts as a shared service rather than a domain, but only after the compaction append is removed and all transcript writes are either harness-owned new-file creation or explicit conversation-file creation.
