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
 *  - Booleans are integer({mode:'boolean'}); timestamps integer({mode:'timestamp'}).
 *  - This Drizzle schema IS the source for drizzle-kit migrations.
 */
import {
  sqliteTable, text, integer, real, primaryKey, index, uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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
  agentId: text("agent_id").notNull().references(() => agents.id),
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
  issueId: text("issue_id").references(() => issues.id),         // nullable (ad-hoc convos)
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

/* favorites — operator stars, the other half of the irreplaceable set. */
export const favorites = sqliteTable("favorites", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [primaryKey({ columns: [t.conversationId] })]);

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
 * archives. 14 NEED cols (5 zero-populated tldr_*/caveman dropped). `cost` is
 * recomputed from tokens on rebuild (stored USD has a legacy bug). The durable
 * per-issue TOTAL lives in the git record's closeOut, not here.
 */
export const costEvents = sqliteTable("cost_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp" }).notNull(),
  issueId: text("issue_id").references(() => issues.id),          // nullable (12.5% UNKNOWN today)
  agentId: text("agent_id").references(() => agents.id),          // nullable
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
]);

/* ───────────────────────────── MERGE ───────────────────────────────
 * All CACHE — structure rebuilds from projects.yaml, gate outcomes from forge
 * PR state; the durable record mirrors only artifactUrl. uat_generations lives
 * here (writer is the merge-train), NOT Issues.
 */
export const mergeSets = sqliteTable("merge_sets", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  artifactUrl: text("artifact_url"),                             // the one durable datum (mirrored to record)
  status: text("status"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("merge_sets_issue_idx").on(t.issueId)]);

export const mergeSetRepos = sqliteTable("merge_set_repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mergeSetId: text("merge_set_id").notNull().references(() => mergeSets.id),
  repo: text("repo").notNull(),
  prUrl: text("pr_url"),
  status: text("status"),
});

export const mergeQueue = sqliteTable("merge_queue", {              // sequential merge lock
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => issues.id),
  enqueuedAt: integer("enqueued_at", { mode: "timestamp" }).notNull(),
});

export const pendingAutoMerges = sqliteTable("pending_auto_merges", { // flywheel cooldown queue
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => issues.id),
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }),
});

export const uatGenerations = sqliteTable("uat_generations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issueId: text("issue_id").notNull().references(() => issues.id),
  artifactUrl: text("artifact_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("uat_issue_idx").on(t.issueId)]);

/* ──────────────────────── CONTROL / SETTINGS ───────────────────────
 * app_settings = deacon.*/flywheel.* runtime flags (source-of-truth-in-DB,
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
  claimOwner: text("claim_owner"),
  claimLeaseUntil: integer("claim_lease_until", { mode: "timestamp" }),
  claimToken: text("claim_token"),
  claimedAt: integer("claimed_at", { mode: "timestamp" }),
  midTurnCountInCurrentTurn: integer("mid_turn_count_in_current_turn").default(0),
  lastMidTurnAt: integer("last_mid_turn_at", { mode: "timestamp" }),
  projectId: text("project_id"),
  workspaceId: text("workspace_id"),
  issueId: text("issue_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

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

/* ────────────────────────────────────────────────────────────────────
 * DELETED (not modeled — were dead/orphan/duplicate):
 *   issue_state, api_cache, rate_limits, auto_merge, label_sync_audit, outbox,
 *   flywheel_substrate_bugs, status_history (→ derivable from events),
 *   git_operations, session_embeddings, discovered_session_* satellites,
 *   processed_sessions, and the duplicate CREATE TABLE agents block.
 * NOT in overdeck.db (live elsewhere): the sacred session files (disk),
 *   memory observation files (~/.panopticon/memory), cache.db, memory-search.db,
 *   cost events.jsonl archive, the git .pan/records.
 * ──────────────────────────────────────────────────────────────────── */
