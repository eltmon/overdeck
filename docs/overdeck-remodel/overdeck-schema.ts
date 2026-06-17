/**
 * overdeck.db — the locked cache schema (Drizzle + better-sqlite3, Node-safe).
 *
 * All domains audited and final. This Drizzle schema IS the locked DB schema.
 *
 * Principles:
 *  - This is a DISPOSABLE CACHE. It starts empty on a fresh overdeck.db and is
 *    rebuilt from the sources of truth (git .pan/records, GitHub, the sacred
 *    on-disk session/observation files, tmux). The ONE exception is
 *    `conversations` (+ `favorites`): irreplaceable DB-resident metadata,
 *    preserved across a wipe by the export (PAN-1937), not git.
 *  - Foreign keys are REAL and ENFORCED (PRAGMA foreign_keys=ON). Today's DB has
 *    zero. Hard FKs are used only where the referenced row is guaranteed to
 *    exist; "soft" pointers to cache-only rows (e.g. transcripts, rebuilt by a
 *    scan and allowed to lag) are plain columns, documented, NOT FK-constrained.
 *    Hard FKs on issues.id (agents, merge_*, issue_policy) are safe because
 *    rebuild materializes `issues` rows first.
 *  - Booleans are integer({mode:'boolean'}); timestamps integer({mode:'timestamp'}).
 *  - This Drizzle schema IS the source for drizzle-kit migrations.
 */
import {
  sqliteTable, text, integer, real, primaryKey, index, uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/* ───────────────────────────── ISSUES ─────────────────────────────
 * Mirror of the durable .pan/records pipeline block. The single `stage`
 * replaces 8 status axes; gate outcomes are the durable verdict.
 * Gates kept (from the gates audit): review + test + verification on the merge
 * path. Inspect is NOT a merge gate (opt-in WORK-phase only, lives per-bead).
 * GitHub CI/mergeable state and blocker-labels are read live from GitHub, not
 * stored as columns; their effect lands in `blockers`.
 */
export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),                                   // "PAN-1938"
  stage: text("stage").notNull(),                                // Stage literal union
  reviewOutcome: text("review_outcome"),                         // pending|passed|failed
  testOutcome: text("test_outcome"),                             // pending|passed|skipped|failed
  verificationOutcome: text("verification_outcome"),             // pending|passed|failed
  verdictCommit: text("verdict_commit"),                         // sha a passing verdict applies to
  blockers: text("blockers", { mode: "json" }).$type<Blocker[]>(), // typed; replaces blocker_reasons + labels
  planRef: text("plan_ref"),                                     // path to vBRIEF spec in git .pan/specs
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prHeadSha: text("pr_head_sha"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("issues_stage_idx").on(t.stage)]);

/* ───────────────────────────── AGENTS ─────────────────────────────
 * 18-field NEED set (was 44 + the deleted state.json plane). Identity is
 * record-authoritative for harness/model (the row is a mirror); liveness
 * reconciles from tmux. Cost / review-run / flywheel fields moved out.
 */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  role: text("role").notNull(),
  status: text("status").notNull(),                              // cache of the tmux oracle
  workspace: text("workspace").notNull(),
  sessionId: text("session_id"),                                 // soft pointer → transcripts.session_id
  harness: text("harness").notNull(),                            // mirror; git record authoritative
  model: text("model").notNull(),                                // mirror; git record authoritative
  hostOverride: text("host_override"),
  deliveryMethod: text("delivery_method"),                       // absorbs supervisor/channels booleans
  startedAt: integer("started_at", { mode: "timestamp" }),
  lastResumeAt: integer("last_resume_at", { mode: "timestamp" }),
  stoppedByUser: integer("stopped_by_user", { mode: "boolean" }),
  kickoffDelivered: integer("kickoff_delivered", { mode: "boolean" }),
  paused: integer("paused", { mode: "boolean" }),
  pausedReason: text("paused_reason"),
  troubled: integer("troubled", { mode: "boolean" }),
  consecutiveFailures: integer("consecutive_failures").default(0),
  firstFailureInRunAt: integer("first_failure_in_run_at", { mode: "timestamp" }),
  lastFailureNextRetryAt: integer("last_failure_next_retry_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("agents_issue_idx").on(t.issueId)]);

/* health_events — folded in from Observability as an Agent projection.
 * (previous_state dropped — derivable from the adjacent ordered row.) */
export const healthEvents = sqliteTable("health_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id"),                                     // soft pointer — no FK; rows outlive their prunable agent
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  state: text("state").notNull(),
  source: text("source"),
  metadata: text("metadata", { mode: "json" }),
}, (t) => [index("health_agent_ts_idx").on(t.agentId, t.timestamp)]);

/* ───────────────────────────── CONVERSATIONS ──────────────────────
 * The one DB-as-truth exception: irreplaceable metadata, preserved by the
 * export (PAN-1937 — not yet built), NOT git. The row is pure metadata; the
 * POINTERS to the sacred on-disk session files live in `conversation_files`.
 * The writer touches only the DB and creates NEW session files — it never
 * mutates an existing backing file.
 */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),                         // operator/favorite key
  cwd: text("cwd").notNull(),                                    // pointer input (encodes the claude path)
  issueId: text("issue_id"),                                     // soft pointer — no FK; nullable. Conversations of closed/deleted/ad-hoc issues outlive the issue row.
  harness: text("harness"),                                      // resolver discriminator
  model: text("model"),
  effort: text("effort"),
  title: text("title"),                                          // manual title only
  titleSource: text("title_source"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // lineage edges (self-references) — handoff/clear create NEW conversations:
  handoffDocPath: text("handoff_doc_path"),                      // → ~/.panopticon/handoffs/ (not git)
  handoffTargetConvId: text("handoff_target_conv_id").references((): AnySQLiteColumn => conversations.id),
  clearedToConvId: text("cleared_to_conv_id").references((): AnySQLiteColumn => conversations.id),
}, (t) => [index("conversations_issue_idx").on(t.issueId)]);

/* conversation_files — the POINTERS to the sacred backing session files. A
 * conversation may span >1 file across harness switches; old files are always
 * preserved (read-only). The locator is harness-specific; the resolved path is
 * DERIVED (never stored). Part of the export (PAN-1937) — these pointers are
 * irreplaceable. The writer adds rows + creates new files; it NEVER mutates an
 * existing backing file. */
export const conversationFiles = sqliteTable("conversation_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  harness: text("harness").notNull(),                            // claude-code | pi | codex | kimi
  locator: text("locator").notNull(),                            // claude: session UUID · pi: agentId/sessions · codex: threadId
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("conv_files_conv_idx").on(t.conversationId)]);

/* favorites — operator stars, the other half of the irreplaceable set.
 * Polymorphic (live schema.ts:532-538): type='conversation'|'project', itemId =
 * conversation NAME (the name-keyed export contract) or project path. No FK —
 * itemId is a portable name/path, not a row id. UNIQUE(type,itemId) → composite PK. */
export const favorites = sqliteTable("favorites", {
  type: text("type").notNull(),                                  // 'conversation' | 'project'
  itemId: text("item_id").notNull(),                             // conversation name or project path
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.type, t.itemId] })]);

/* ────────────────────────── TRANSCRIPTS ────────────────────────────
 * Shared internal index over the sacred session files — 100% cache, rebuilt by
 * a STRICTLY READ-ONLY scan across claude/pi/codex file shapes. NOT a domain
 * (no resolver/pane). Referenced SOFTLY by conversation_files.locator and
 * agents.session_id (no FK — a rebuildable cache that may lag the pointer).
 * Remodel fix: convert conversation-compaction's in-place JSONL append
 * (conversation-compaction.ts:164) to the fork pattern so this layer never
 * writes a backing file.
 */
export const transcripts = sqliteTable("transcripts", {
  backingFilePath: text("backing_file_path").primaryKey(),       // the sacred file (read-only) — universal key
  sessionId: text("session_id"),                                 // claude session UUID (null for pi/codex)
  harness: text("harness"),
  workspacePath: text("workspace_path"),
  messageCount: integer("message_count"),
  models: text("models", { mode: "json" }),
  tokenInput: integer("token_input"),
  tokenOutput: integer("token_output"),
  firstTs: integer("first_ts", { mode: "timestamp" }),
  lastTs: integer("last_ts", { mode: "timestamp" }),
  panIssueId: text("pan_issue_id"),
  panAgentId: text("pan_agent_id"),
  fileMtime: integer("file_mtime", { mode: "timestamp" }),
  scannedAt: integer("scanned_at", { mode: "timestamp" }),
});
// transcripts_fts — FTS5 virtual table over transcripts; created via raw SQL
// migration (Drizzle does not model FTS5 natively). Optional; pure cache.

/* ───────────────────────────── COST ────────────────────────────────
 * Pure cache, rebuilt from a union of sacred transcripts + ~/.panopticon cost
 * archives. 14 NEED cols (5 zero-populated tldr_ / caveman dropped). `cost` is
 * recomputed from tokens on rebuild (stored USD has a legacy bug). The durable
 * per-issue TOTAL lives in the git record's closeOut, not here.
 */
export const costEvents = sqliteTable("cost_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp" }).notNull(),
  issueId: text("issue_id"),                                     // soft pointer — no FK; nullable (12.5% UNKNOWN; rows outlive purged issues)
  agentId: text("agent_id"),                                     // soft pointer — no FK; nullable (rows outlive prunable agents)
  sessionId: text("session_id"),
  sessionType: text("session_type"),
  provider: text("provider"),
  model: text("model"),
  input: integer("input"),
  output: integer("output"),
  cacheRead: integer("cache_read"),
  cacheWrite: integer("cache_write"),
  cost: real("cost"),
  requestId: text("request_id"),                                 // dedup key (NULL on ~66% — best-effort)
  sourceFile: text("source_file"),
}, (t) => [
  index("cost_issue_idx").on(t.issueId),
  index("cost_ts_idx").on(t.ts),
  // the entire idempotency guarantee for re-import — without it reconciler
  // re-runs double-count (cost-audit.md; live schema.ts:197-198).
  uniqueIndex("cost_request_id_idx").on(t.requestId).where(sql`request_id IS NOT NULL`),
]);

/* ───────────────────────────── MERGE ───────────────────────────────
 * Mostly CACHE — merge_sets / merge_set_repos / merge_queue / pending_auto_merges
 * rebuild structure from projects.yaml and gate outcomes from forge PR state.
 * The uat_generations / _members / _resolutions tables are the EXCEPTION: they
 * are PERSISTED, auditable pipeline history (an append-only record of what each
 * UAT batch bundled, held out, and resolved) — kept, NOT re-derived from
 * projects.yaml. The merge-train (uat-train.ts) owns all of these, NOT Issues.
 * Columns verified against the live schema; the UAT members/held-out JSON arrays
 * are normalized into uat_generation_members and the cardinality-distinct
 * resolutions into uat_generation_resolutions (the "use FKs properly" fix).
 */
export const mergeSets = sqliteTable("merge_sets", {
  issueId: text("issue_id").primaryKey().references(() => issues.id),  // one merge set per issue
  projectKey: text("project_key").notNull(),
  projectPath: text("project_path").notNull(),
  workspaceType: text("workspace_type").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("merge_sets_project_idx").on(t.projectKey, t.updatedAt)]);

/* one row per repo in a (polyrepo) merge set; per-repo gate statuses + order. */
export const mergeSetRepos = sqliteTable("merge_set_repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => mergeSets.issueId),
  repoKey: text("repo_key").notNull(),
  repoPath: text("repo_path").notNull(),
  forge: text("forge").notNull(),
  sourceBranch: text("source_branch").notNull(),
  targetBranch: text("target_branch").notNull(),
  artifactUrl: text("artifact_url"),
  artifactId: text("artifact_id"),
  reviewStatus: text("review_status").notNull().default("pending"),
  testStatus: text("test_status").notNull().default("pending"),
  rebaseStatus: text("rebase_status").notNull().default("pending"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  mergeStatus: text("merge_status").notNull().default("pending"),
  mergeOrder: integer("merge_order").notNull().default(0),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
}, (t) => [index("merge_set_repos_issue_idx").on(t.issueId)]);

/* the sequential merge lock (one in-flight merge per project). */
export const mergeQueue = sqliteTable("merge_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectKey: text("project_key").notNull(),
  issueId: text("issue_id").notNull().unique().references(() => issues.id),
  position: integer("position").notNull(),
  status: text("status").notNull().default("queued"),
  queuedAt: integer("queued_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }),
}, (t) => [index("merge_queue_project_idx").on(t.projectKey, t.position)]);

/* the flywheel cooldown queue (scheduled auto-merges). */
export const pendingAutoMerges = sqliteTable("pending_auto_merges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => issues.id),
  prUrl: text("pr_url").notNull(),                                  // pr_number derives from this
  projectKey: text("project_key").notNull(),
  forge: text("forge").notNull().default("github"),
  status: text("status").notNull(),                                // pending|merging|blocked|failed|merged|cancelled
  scheduledMergeAt: integer("scheduled_merge_at", { mode: "timestamp" }).notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  mergedAt: integer("merged_at", { mode: "timestamp" }),
  failureReason: text("failure_reason"),
  cancelledAt: integer("cancelled_at", { mode: "timestamp" }),     // live schema.ts:570 — cooldown-window cancellation
  cancelledBy: text("cancelled_by"),                               // live schema.ts:571
}, (t) => [
  index("pending_auto_merges_issue_idx").on(t.issueId),
  // one active auto-merge per issue — prevents scheduling two concurrent merges
  // for the same issue (live schema.ts:574-575).
  uniqueIndex("pending_auto_merges_active_issue_idx").on(t.issueId).where(sql`status IN ('pending','merging')`),
]);

/* an assembled UAT batch branch `uat/<codename>-<mmdd>` — the batch NAME is the
 * identity (PK). */
export const uatGenerations = sqliteTable("uat_generations", {
  name: text("name").primaryKey(),                                 // "uat/<codename>-<mmdd>"
  worktreePath: text("worktree_path").notNull(),
  projectRoot: text("project_root").notNull(),
  baseSha: text("base_sha").notNull(),
  status: text("status").notNull().default("assembling"),
  stackStartedAt: integer("stack_started_at", { mode: "timestamp" }),
  cleanedAt: integer("cleaned_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("uat_status_idx").on(t.status)]);

/* the issues in a batch — replaces the members/held_out JSON arrays with real
 * columns. Member attrs trace to UatGenerationMember + UatGenerationHeldOut
 * (uat-generations-db.ts:34-56). `role` discriminates member vs held_out: member
 * rows carry title/branch/headSha/mergeOrder/pr/prUrl; held_out rows carry reason
 * (+ optional branch/headSha). `resolutions` is a SEPARATE entity (spans multiple
 * issues) → uatGenerationResolutions below. */
export const uatGenerationMembers = sqliteTable("uat_generation_members", {
  uatName: text("uat_name").notNull().references(() => uatGenerations.name),
  issueId: text("issue_id").notNull().references(() => issues.id),
  role: text("role").notNull().default("member"),                  // member | held_out
  title: text("title"),                                            // member only (not derivable; held_out lacks it)
  branch: text("branch"),                                          // member: required · held_out: optional
  headSha: text("head_sha"),                                       // staleness key (member: required · held_out: optional)
  mergeOrder: integer("merge_order"),                              // member only — 1-based merge position
  pr: integer("pr"),                                               // member only — optional PR number
  prUrl: text("pr_url"),                                           // member only — optional
  reason: text("reason"),                                          // held_out only — human-readable exclusion reason
}, (t) => [primaryKey({ columns: [t.uatName, t.issueId] })]);

/* cross-feature conflicts resolved on the batch branch (UatGenerationResolution,
 * uat-generations-db.ts:58-64). A resolution spans MULTIPLE issues, so it is its
 * own entity keyed by an autoincrement id (not a per-member attribute). The
 * member being merged + the already-merged members it collided with live in the
 * issueIds JSON array. */
export const uatGenerationResolutions = sqliteTable("uat_generation_resolutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uatName: text("uat_name").notNull().references(() => uatGenerations.name),
  issueIds: text("issue_ids", { mode: "json" }).notNull(),         // the colliding issues (>1)
  files: text("files", { mode: "json" }).notNull(),                // resolved files
  commitSha: text("commit_sha").notNull(),                         // the resolution commit
}, (t) => [index("uat_resolutions_uat_idx").on(t.uatName)]);

/* ──────────────────────── CONTROL / SETTINGS ───────────────────────
 * app_settings = deacon.* / flywheel.* runtime flags (source-of-truth-in-DB,
 * reset at cutover). issue_policy = the per-issue squatters evicted from
 * review_status.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const issuePolicy = sqliteTable("issue_policy", {
  issueId: text("issue_id").primaryKey().references(() => issues.id),
  deaconIgnored: integer("deacon_ignored", { mode: "boolean" }),
  autoMerge: integer("auto_merge", { mode: "boolean" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/* ─────────────────────────── ORCHESTRATION ─────────────────────────
 * EPHEMERAL REVIEW-RUN RUNTIME — pure cache, no durable value. The home for
 * the columns the review monitor / deacon recovery loop branch-reads during a
 * LIVE review cycle but which are NOT part of the durable verdict (that lives
 * in `issues`). Rebuilds on each cycle.
 *
 * A review is a CONVOY of 4 concurrent sub-role lanes
 * (security/correctness/performance/requirements, review-monitor.ts:22) plus a
 * synthesis agent. A single issue-keyed row CANNOT represent 4 lanes, so this
 * splits into two tables:
 *   - review_runs — one row per run, holding the issue-level recovery counters
 *     (from live `review_status`, schema.ts:224/231/232/249/251/238/239/245/247/253)
 *     and the single per-run synthesis pointer (live agents:468).
 *   - review_run_agents — one row PER reviewer lane, holding the per-agent
 *     review-run pointers (from live `agents`, schema.ts:466/467/469/470/471/472).
 */
export const reviewRuns = sqliteTable("review_runs", {
  runId: text("run_id").primaryKey(),                            // agents.review_run_id — the convoy's run id
  issueId: text("issue_id").notNull().references(() => issues.id),
  reviewSynthesisAgentId: text("review_synthesis_agent_id"),     // agents.review_synthesis_agent_id (468) — one synthesis per convoy; soft pointer, no FK (agents are prunable)
  // ephemeral recovery counters (live review_status)
  verificationCycleCount: integer("verification_cycle_count").default(0), // review_status:224
  autoRequeueCount: integer("auto_requeue_count").default(0),    // review_status:231
  mergeRetryCount: integer("merge_retry_count").default(0),      // review_status:232
  testRetryCount: integer("test_retry_count").default(0),        // review_status:249
  reviewRetryCount: integer("review_retry_count").default(0),    // review_status:251
  stuck: integer("stuck", { mode: "boolean" }).notNull().default(false), // review_status:238
  stuckReason: text("stuck_reason"),                             // review_status:239
  reviewSpawnedAt: integer("review_spawned_at", { mode: "timestamp" }), // review_status:245
  conflictResolutionDispatchedAt: integer("conflict_resolution_dispatched_at", { mode: "timestamp" }), // review_status:247
  recoveryStartedAt: integer("recovery_started_at", { mode: "timestamp" }), // review_status:253
}, (t) => [index("review_runs_issue_idx").on(t.issueId)]);

/* one row PER reviewer lane in a convoy — the per-agent review-run pointers
 * (live agents:466/469/470/471/472). agentId is a soft pointer (no FK — agents
 * are prunable). sub_role is one of the 4 convoy lanes (review-monitor.ts:22). */
export const reviewRunAgents = sqliteTable("review_run_agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => reviewRuns.runId),
  agentId: text("agent_id"),                                     // soft pointer → agents.id; no FK (rows outlive prunable agents)
  subRole: text("sub_role"),                                     // agents.review_sub_role (466) — security|correctness|performance|requirements
  outputPath: text("output_path"),                              // agents.review_output_path (469)
  deadlineAt: integer("deadline_at", { mode: "timestamp" }),    // agents.review_deadline_at (470)
  monitorSignaled: text("monitor_signaled"),                    // agents.review_monitor_signaled (471) — TEXT in live, not a flag
  retryAttempt: integer("retry_attempt"),                       // agents.review_retry_attempt (472)
}, (t) => [index("review_run_agents_run_idx").on(t.runId)]);

/* ───────────────────────────── MEMORY ──────────────────────────────
 * Memory's real records are FILES on disk (~/.panopticon/memory/...). Its only
 * panopticon.db table is this pure-cache dedup cursor + claim-lease. 11 NEED
 * cols (last_observation_at dropped — zero reads). Keys on the raw sessionId
 * string (no FK — deliberate independence).
 */
export const transcriptCheckpoints = sqliteTable("transcript_checkpoints", {
  sessionId: text("session_id").primaryKey(),
  transcriptPath: text("transcript_path").notNull(),
  lastOffset: integer("last_offset").notNull().default(0),       // dedup cursor
  claimOwner: text("claim_owner"),                               // lease holder (checkpoints.ts:104,132)
  claimFrom: integer("claim_from"),                              // leased byte range start (checkpoints.ts:225)
  claimTo: integer("claim_to"),                                  // leased byte range end (checkpoints.ts:226)
  claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }), // 60s lease-steal predicate (checkpoints.ts:104)
  midTurnCountInCurrentTurn: integer("mid_turn_count_in_current_turn").default(0),
  lastMidTurnAt: integer("last_mid_turn_at", { mode: "timestamp" }),
  projectId: text("project_id"),
  workspaceId: text("workspace_id"),
  issueId: text("issue_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/* ─────────────────────── MEMORY SEARCH STORE ───────────────────────
 * NOT in overdeck.db. This is a SEPARATE, per-project search database at
 * resolveMemoryRoot(projectId)/memory-search.db (paths.ts:64-65) — one per
 * project, not the single shared overdeck.db. Modeled here only to document the
 * Memory search domain end-to-end; it cannot FK into overdeck tables (different
 * DB) and is NOT counted in the overdeck.db table total.
 *
 * The store has three objects (fts-operations.ts:50-98):
 *   - memory_fts — an FTS5 VIRTUAL table over the on-disk observation files.
 *     Drizzle does not model FTS5; it is created via raw SQL (like
 *     transcripts_fts above) and is not declared here.
 *   - reset_markers — modeled below. Drives search filtering: search.ts:121-128
 *     excludes any observation older than the newest matching reset marker, so
 *     a reset hides prior memories without deleting them.
 *   - observation_index — modeled below. Maps each indexed observation id to its
 *     backing JSONL file + byte offset, so the FTS index can be rebuilt.
 *
 * REQUIRED PIECE (functional parity): an FTS rebuilder that reconstructs
 * memory_fts (and observation_index) from the on-disk observation JSONL files.
 * Without it, search functionality is lost after a reset/wipe of memory-search.db
 * — the observations still exist on disk but become unsearchable. This rebuilder
 * is the missing piece and must exist.
 */
export const resetMarkers = sqliteTable("reset_markers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),                                // project|workspace|issue|session (search.ts:124-127)
  scopeId: text("scope_id").notNull(),
  fromTimestamp: integer("from_timestamp", { mode: "timestamp" }).notNull(), // cutoff: observations at/before this are hidden
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("reset_markers_scope_idx").on(t.scope, t.scopeId, t.fromTimestamp), // live idx_reset_markers_scope
  index("reset_markers_created_at_idx").on(t.createdAt),         // live idx_reset_markers_created_at
]);

export const observationIndex = sqliteTable("observation_index", {
  id: text("id").primaryKey(),                                   // observation id
  observationPathJsonl: text("observation_path_jsonl").notNull(), // backing JSONL file
  byteOffset: integer("byte_offset").notNull(),                  // offset within that file
}, (t) => [
  // live idx_observation_index_path_offset (fts-operations.ts:96-97)
  index("observation_index_path_offset_idx").on(t.observationPathJsonl, t.byteOffset),
]);

/* ───────────────────────── OBSERVABILITY ───────────────────────────
 * Not a domain — a thin EventBus (disposable pub/sub transport). Tiered
 * retention by type (periodic, not startup-only).
 */
export const events = sqliteTable("events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  payload: text("payload", { mode: "json" }),
}, (t) => [index("events_type_ts_idx").on(t.type, t.timestamp)]);

/* status_history — KEPT cache table. Pipeline transition history for operator
 * visibility (the review/test/merge status timeline). NOT safely derivable from
 * `events` (different granularity + the dedup contract below), so it is kept,
 * not deleted. Matches live schema.ts:272-287. The live FK targets
 * review_status(issue_id) (schema.ts:279); review_status is dissolved in
 * overdeck, so the hard FK is re-pointed to issues.id (rebuild materializes
 * issues first). The unique index drives INSERT OR IGNORE dedup in
 * upsertReviewStatus (schema.ts:286-287). */
export const statusHistory = sqliteTable("status_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => issues.id), // live FK targets review_status; re-pointed to issues
  statusType: text("type").notNull(),                            // 'review' | 'test' | 'merge'
  status: text("status").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  notes: text("notes"),
}, (t) => [
  index("status_history_issue_idx").on(t.issueId, t.timestamp),  // live idx_status_history_issue
  // INSERT OR IGNORE dedup key (live idx_status_history_unique, schema.ts:286-287)
  uniqueIndex("status_history_unique_idx").on(t.issueId, t.statusType, t.status, t.timestamp),
]);

/* ────────────────────────────────────────────────────────────────────
 * DELETED (not modeled — were dead/orphan/duplicate):
 *   issue_state, api_cache, rate_limits, auto_merge, label_sync_audit, outbox,
 *   flywheel_substrate_bugs, git_operations, session_embeddings,
 *   discovered_session_* satellites, processed_sessions, and the duplicate
 *   CREATE TABLE agents block.
 * NOT in overdeck.db (live elsewhere): the sacred session files (disk),
 *   memory observation files (~/.panopticon/memory), cache.db, the cost
 *   events.jsonl archive, the git .pan/records. memory-search.db is also a
 *   separate per-project DB (not overdeck.db); its reset_markers /
 *   observation_index tables are MODELED above (MEMORY SEARCH STORE section)
 *   for documentation but are NOT counted in the overdeck.db table total.
 * ──────────────────────────────────────────────────────────────────── */
