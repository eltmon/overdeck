/**
 * Runtime infrastructure for the canonical overdeck.db cache.
 * Schema top-ups tolerate idempotency errors, log unexpected failures without
 * blocking boot, and getOverdeckDatabaseSync follows them with a report-only
 * schema audit that warns about drift without mutating the database.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { Context, Effect, Layer, Queue, Stream } from 'effect';
import { asc, gt, sql } from 'drizzle-orm';
import { drizzle, type RemoteCallback, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
  openDatabase,
  type SqliteDatabase,
  type SqliteRow,
  type SqliteScalar,
} from '../database/driver.js';
import {
  getIssueRecordPath,
  readIssueRecordSync,
  type PanIssueRecord,
} from '../pan-dir/record.js';
import { updateIssueRecord } from '../pan-dir/record-update.js';
import type { ProjectConfig } from '../projects.js';
import { packageRoot, getOverdeckHome } from '../paths.js';
import { sessionExists as tmuxSessionExists, killSession as tmuxKillSession, getAgentSessions } from '../tmux.js';
import { getOverdeckDatabasePath, OVERDECK_MIGRATION_PATH } from './paths.js';
import {
  auditOverdeckSchemaSync,
  type SchemaTopUpExpectations,
} from './schema-audit.js';

export const OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS: SchemaTopUpExpectations = {
  columns: [
    { table: 'discovered_sessions', column: 'harness' },
    { table: 'flywheel_substrate_bugs', column: 'affected_criteria' },
    { table: 'review_status', column: 'release_status' },
    { table: 'review_status', column: 'release_notes' },
    { table: 'review_status', column: 'uat_status' },
    { table: 'review_status', column: 'uat_notes' },
    { table: 'review_status', column: 'retired_at' },
    { table: 'review_status', column: 'inspect_owner_session' },
    { table: 'review_status', column: 'strike_ready_head' },
    { table: 'review_status', column: 'strike_ready_at' },
    { table: 'review_status', column: 'strike_landing_state' },
    { table: 'review_status', column: 'strike_recovery_count' },
    { table: 'review_status', column: 'strike_transport_retry_count' },
    { table: 'review_status', column: 'strike_next_attempt_at' },
    { table: 'review_status', column: 'strike_landing_attempts' },
    { table: 'review_status', column: 'conflicts_since' },
    { table: 'agents', column: 'yielded_by_scheduler' },
    { table: 'agents', column: 'review_context_manifest_path' },
    { table: 'agents', column: 'yielded_at' },
    { table: 'agents', column: 'last_yield_resume_at' },
    { table: 'agents', column: 'started_by' },
    { table: 'agents', column: 'branch' },
    { table: 'uat_generation_repos', column: 'target_branch' },
    { table: 'uat_generation_repos', column: 'merge_sha' },
    { table: 'uat_generation_resolutions', column: 'kind' },
    { table: 'uat_generation_resolutions', column: 'note' },
    // PAN-3092: listed explicitly so the drift audit reports the table's
    // absence if the runtime top-up ever fails on an existing database.
    { table: 'event_idempotency', column: 'key' },
    // PAN-1990: sentinels for the four brand-new tables (SchemaTopUpExpectations
    // has no dedicated "tables" list).
    { table: 'projects', column: 'id' },
    { table: 'workspaces', column: 'id' },
    { table: 'project_targets', column: 'project_id' },
    { table: 'pinned_docs', column: 'id' },
    { table: 'conversations', column: 'workspace_id' },
    { table: 'agents', column: 'workspace_id' },
    // PAN-1577: explicit project assignment override for moving a conversation
    // between projects without relying on cwd-derived grouping.
    { table: 'conversations', column: 'project_key' },
    // PAN-3331: the quick-action band's per-workspace run command.
    { table: 'workspaces', column: 'run_command' },
  ],
  indexes: [
    'cost_session_id_idx',
    'idx_cost_agent_id',
    'idx_cost_issue_upper',
    'release_sets_project_idx',
    'release_set_components_issue_component_idx',
    'release_set_components_issue_order_idx',
    'uat_generation_repos_uat_order_idx',
    'uat_generation_member_repos_uat_idx',
    'uat_generations_uncleaned_terminal_idx',
    'projects_primary_path_idx',
    'idx_workspace_project',
    'idx_workspace_kind',
    'idx_workspace_last_accessed',
    'idx_project_targets_one_primary',
    'idx_pinned_docs_scope',
  ],
};

export const overdeckEvents = sqliteTable('events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown | null>(),
});

const overdeckSchema = {
  events: overdeckEvents,
};

export type OverdeckDrizzleDatabase = SqliteRemoteDatabase<typeof overdeckSchema>;

export interface DbServiceShape {
  readonly q: OverdeckDrizzleDatabase;
  readonly path: string;
}

export class Db extends Context.Service<Db, DbServiceShape>()('overdeck/Db') {}

let overdeckDbSync: { path: string; db: SqliteDatabase } | null = null;
let overdeckReadOnlyDbSync: { path: string; db: SqliteDatabase } | null = null;

function runOverdeckMigrationSync(db: SqliteDatabase): void {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agents'`)
    .get();
  if (row) return;

  const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

/**
 * Run one idempotent schema top-up without hiding unexpected SQLite failures.
 * Only duplicate DDL is silent; missing tables and other failures are logged so
 * schema drift remains observable without blocking later top-ups or startup.
 */
export function runSchemaTopUp(db: SqliteDatabase, statement: string): void {
  try {
    db.exec(statement);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate column name|already exists/i.test(message)) return;
    console.error(`[schema] top-up failed: ${statement}\n${message}`);
  }
}

/**
 * Idempotent schema top-ups for databases created before a field/index existed
 * in the init migration. The init migration only runs on a fresh database.
 * PAN-2220: the conversation ledger-cost query joins cost_events on session_id;
 * without this index SQLite builds an automatic index on every query (~76ms → 7ms).
 */
function ensureRuntimeIndexesSync(db: SqliteDatabase): void {
  runSchemaTopUp(db, 'ALTER TABLE `discovered_sessions` ADD COLUMN `harness` text');
  runSchemaTopUp(db, "UPDATE `discovered_sessions` SET `harness` = 'claude-code' WHERE `harness` IS NULL");
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `release_status` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `release_notes` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `uat_status` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `uat_notes` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `retired_at` integer');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `inspect_owner_session` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_ready_head` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_ready_at` integer');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_landing_state` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_recovery_count` integer DEFAULT 0');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_transport_retry_count` integer');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_next_attempt_at` integer');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `strike_landing_attempts` text');
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `review_cycle_history` text');
  // PAN-3154: main-head SHA/paths that first made this branch conflict.
  runSchemaTopUp(db, 'ALTER TABLE `review_status` ADD COLUMN `conflicts_since` text');
  ensureReleaseSetTablesSync(db);
  ensureUatGenerationRepoTablesSync(db);
  // PAN-1491: existing overdeck.db files created before substrate-bug weights need
  // the new `affected_criteria` column added idempotently.
  runSchemaTopUp(db, 'ALTER TABLE `flywheel_substrate_bugs` ADD COLUMN `affected_criteria` text');
  // PAN-3092: at-most-once event append. Existing overdeck.db files predate the
  // table, and the init migration only runs on a fresh database — without this
  // top-up every append-once call fails while preparing its claim statement.
  runSchemaTopUp(db, 'CREATE TABLE IF NOT EXISTS `event_idempotency` (`key` text PRIMARY KEY NOT NULL, `sequence` integer NOT NULL, `created_at` integer NOT NULL)');
  runSchemaTopUp(db, 'CREATE INDEX IF NOT EXISTS `cost_session_id_idx` ON `cost_events` (`session_id`)');
  runSchemaTopUp(db, 'CREATE INDEX IF NOT EXISTS `idx_cost_agent_id` ON `cost_events` (`agent_id`, `ts`)');
  runSchemaTopUp(db, 'CREATE INDEX IF NOT EXISTS `idx_cost_issue_upper` ON `cost_events` (UPPER(`issue_id`))');
  runSchemaTopUp(db, 'CREATE TABLE IF NOT EXISTS `cost_reconcile_file_state` (`path` text PRIMARY KEY NOT NULL, `mtime_ms` integer NOT NULL, `size` integer NOT NULL, `verdict` text NOT NULL)');
  // PAN-2507: preemptive-scheduler yield attribution on agents. The init
  // migration only runs on a fresh DB, so existing overdeck.db files need these
  // columns added idempotently here.
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `yielded_by_scheduler` integer');
  // Existing databases need the run context manifest for missing-reviewer recovery.
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `review_context_manifest_path` text');
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `yielded_at` integer');
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `last_yield_resume_at` integer');
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `started_by` text');
  // PAN-3362: the init migration's `agents` table never carried `branch`, so it
  // was silently dropped on every DB round-trip (fixture and real agents alike).
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `branch` text');
  ensureWorkspaceTablesSync(db);
  // PAN-1577: explicit project assignment override for moving a conversation
  // between projects without relying on cwd-derived grouping.
  runSchemaTopUp(db, 'ALTER TABLE `conversations` ADD COLUMN `project_key` text');
}

/**
 * Idempotent schema top-up for first-class projects/workspaces (PAN-1990).
 * A fresh overdeck.db predates these tables — the init migration only runs on
 * a brand-new database, so existing files need them added here.
 */
function ensureWorkspaceTablesSync(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`projects\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`name\` text NOT NULL,
      \`primary_path\` text NOT NULL,
      \`created_at\` integer NOT NULL,
      \`last_accessed_at\` integer NOT NULL,
      \`is_system\` integer DEFAULT 0 NOT NULL
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS `projects_primary_path_idx` ON `projects` (`primary_path`)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS \`workspaces\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`project_id\` text NOT NULL,
      \`kind\` text NOT NULL,
      \`name\` text NOT NULL,
      \`path\` text NOT NULL,
      \`branch_name\` text,
      \`parent_branch\` text,
      \`parent_branch_guessed\` integer DEFAULT 0 NOT NULL,
      \`is_git_repository\` integer DEFAULT 1 NOT NULL,
      \`issue_id\` text,
      \`layout_config\` text,
      \`run_command\` text,
      \`is_favorite\` integer DEFAULT 0,
      \`is_archived\` integer DEFAULT 0,
      \`title\` text,
      \`created_at\` integer NOT NULL,
      \`last_accessed_at\` integer NOT NULL,
      CHECK (\`kind\` IN ('main','issue','scratch')),
      FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE cascade
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS `idx_workspace_project` ON `workspaces` (`project_id`)');
  db.exec('CREATE INDEX IF NOT EXISTS `idx_workspace_kind` ON `workspaces` (`kind`)');
  db.exec('CREATE INDEX IF NOT EXISTS `idx_workspace_last_accessed` ON `workspaces` (`last_accessed_at`)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS \`project_targets\` (
      \`project_id\` text NOT NULL,
      \`path\` text NOT NULL,
      \`is_primary\` integer DEFAULT 0 NOT NULL,
      \`created_at\` integer NOT NULL,
      \`last_used_at\` integer NOT NULL,
      PRIMARY KEY(\`project_id\`, \`path\`),
      FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE cascade
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_targets_one_primary` ON `project_targets` (`project_id`) WHERE `is_primary` = 1');

  db.exec(`
    CREATE TABLE IF NOT EXISTS \`pinned_docs\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`scope\` text NOT NULL,
      \`scope_id\` text NOT NULL,
      \`doc_path\` text NOT NULL,
      \`created_at\` integer NOT NULL,
      CHECK (\`scope\` IN ('workspace','project')),
      UNIQUE(\`scope\`, \`scope_id\`, \`doc_path\`)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS `idx_pinned_docs_scope` ON `pinned_docs` (`scope`, `scope_id`)');

  runSchemaTopUp(db, 'ALTER TABLE `conversations` ADD COLUMN `workspace_id` text');
  runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `workspace_id` text');
  // PAN-3331: the quick-action band's per-workspace run command. Its own column
  // rather than a key inside layout_config, which react-resizable-panels owns
  // and rewrites wholesale on every panel drag.
  runSchemaTopUp(db, 'ALTER TABLE `workspaces` ADD COLUMN `run_command` text');
}

/**
 * Idempotent schema top-up for release set tables (PAN-399). Existing overdeck.db
 * files created before the release-set feature need these tables added without
 * requiring a full migration reset.
 */
function ensureReleaseSetTablesSync(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`release_sets\` (
      \`issue_id\` text PRIMARY KEY NOT NULL,
      \`project_key\` text NOT NULL,
      \`project_path\` text NOT NULL,
      \`workspace_type\` text NOT NULL,
      \`status\` text DEFAULT 'pending' NOT NULL,
      \`created_at\` integer NOT NULL,
      \`updated_at\` integer NOT NULL,
      FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\`(\`id\`) ON UPDATE no action ON DELETE no action
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS \`release_sets_project_idx\` ON \`release_sets\` (\`project_key\`,\`updated_at\`)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`release_set_components\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`issue_id\` text NOT NULL,
      \`component_key\` text NOT NULL,
      \`provider\` text,
      \`trigger\` text NOT NULL,
      \`release_order\` integer DEFAULT 0 NOT NULL,
      \`required\` integer DEFAULT true NOT NULL,
      \`status\` text DEFAULT 'pending' NOT NULL,
      \`health_status\` text,
      \`version_status\` text,
      \`smoke_status\` text,
      \`rollback_status\` text,
      \`notes\` text,
      FOREIGN KEY (\`issue_id\`) REFERENCES \`release_sets\`(\`issue_id\`) ON UPDATE no action ON DELETE cascade
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS \`release_set_components_issue_component_idx\` ON \`release_set_components\` (\`issue_id\`,\`component_key\`)');
  db.exec('CREATE INDEX IF NOT EXISTS \`release_set_components_issue_order_idx\` ON \`release_set_components\` (\`issue_id\`,\`release_order\`,\`component_key\`)');
}

/**
 * Idempotent schema top-up for per-repo UAT generation tables (PAN-3093).
 * A polyrepo generation spans N member repos, so its per-repo branch, base SHA,
 * worktree, and publish state cannot live in the single-valued `uat_generations`
 * columns. Existing overdeck.db files predate these tables and need them added
 * without a migration reset — same shape as ensureReleaseSetTablesSync above.
 */
function ensureUatGenerationRepoTablesSync(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`uat_generation_repos\` (
      \`uat_name\` text NOT NULL,
      \`repo_key\` text NOT NULL,
      \`repo_path\` text NOT NULL,
      \`branch\` text NOT NULL,
      \`base_sha\` text NOT NULL,
      \`target_branch\` text DEFAULT 'main' NOT NULL,
      \`worktree_path\` text NOT NULL,
      \`merge_order\` integer DEFAULT 0 NOT NULL,
      \`promoted_at\` integer,
      \`merge_sha\` text,
      PRIMARY KEY(\`uat_name\`, \`repo_key\`),
      FOREIGN KEY (\`uat_name\`) REFERENCES \`uat_generations\`(\`name\`) ON UPDATE no action ON DELETE no action
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS \`uat_generation_repos_uat_order_idx\` ON \`uat_generation_repos\` (\`uat_name\`,\`merge_order\`)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`uat_generation_member_repos\` (
      \`uat_name\` text NOT NULL,
      \`issue_id\` text NOT NULL,
      \`repo_key\` text NOT NULL,
      \`branch\` text NOT NULL,
      \`head_sha\` text NOT NULL,
      \`merge_order_in_repo\` integer DEFAULT 0 NOT NULL,
      PRIMARY KEY(\`uat_name\`, \`issue_id\`, \`repo_key\`),
      FOREIGN KEY (\`uat_name\`) REFERENCES \`uat_generations\`(\`name\`) ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\`(\`id\`) ON UPDATE no action ON DELETE no action
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS \`uat_generation_member_repos_uat_idx\` ON \`uat_generation_member_repos\` (\`uat_name\`,\`issue_id\`)');
  // Partial index for the idle reconciler's uncleaned-terminal existence check,
  // which runs once a minute per enabled project. Through runSchemaTopUp, not a
  // bare exec: indexing a table that a partially-built database has not created
  // yet must warn and continue, never abort the remaining top-ups.
  runSchemaTopUp(db, "CREATE INDEX IF NOT EXISTS \`uat_generations_uncleaned_terminal_idx\` ON \`uat_generations\` (\`project_root\`,\`status\`) WHERE \`cleaned_at\` IS NULL");
  // Columns added after the tables shipped: a db created by the first PAN-3093
  // build has the tables but not these.
  runSchemaTopUp(db, "ALTER TABLE `uat_generation_repos` ADD COLUMN `target_branch` text DEFAULT 'main' NOT NULL");
  runSchemaTopUp(db, 'ALTER TABLE `uat_generation_repos` ADD COLUMN `merge_sha` text');
  // PAN-3166: assembly-time resolutions are no longer conflict-only — the union
  // lint also renumbers colliding Flyway migrations. Nullable, so rows written
  // before this read back as conflict resolutions.
  runSchemaTopUp(db, 'ALTER TABLE `uat_generation_resolutions` ADD COLUMN `kind` text');
  runSchemaTopUp(db, 'ALTER TABLE `uat_generation_resolutions` ADD COLUMN `note` text');
}

function warnSchemaDriftSync(db: SqliteDatabase): void {
  try {
    const report = auditOverdeckSchemaSync(db, OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS);
    for (const table of report.missingTables) {
      console.warn(`[schema-audit] missing table: ${table}`);
    }
    for (const index of report.missingIndexes) {
      console.warn(`[schema-audit] missing index: ${index}`);
    }
    for (const { table, column } of report.missingColumns) {
      console.warn(`[schema-audit] missing column: ${table}.${column}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[schema-audit] audit failed: ${message}`);
  }
}

export function getOverdeckDatabaseSync(
  dbPath = getOverdeckDatabasePath(),
  options: { readOnly?: boolean } = {},
): SqliteDatabase {
  // Fresh/test homes still need the writable path to create the cache. A real
  // read-only CLI invocation always targets an existing dashboard-owned DB.
  if (
    options.readOnly
    && overdeckDbSync?.path !== dbPath
    && existsSync(dbPath)
    && existsSync(OVERDECK_MIGRATION_PATH)
  ) {
    return getOverdeckDatabaseReadOnlySync(dbPath);
  }
  if (overdeckDbSync?.path === dbPath) {
    return overdeckDbSync.db;
  }

  if (overdeckDbSync) {
    overdeckDbSync.db.close();
    overdeckDbSync = null;
  }

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = openDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  runOverdeckMigrationSync(db);
  ensureRuntimeIndexesSync(db);
  warnSchemaDriftSync(db);
  overdeckDbSync = { path: dbPath, db };
  return db;
}

function getOverdeckDatabaseReadOnlySync(dbPath: string): SqliteDatabase {
  if (overdeckReadOnlyDbSync?.path === dbPath) return overdeckReadOnlyDbSync.db;

  overdeckReadOnlyDbSync?.db.close();
  const db = openDatabase(dbPath, { readOnly: true });
  db.pragma('foreign_keys = ON');
  const report = auditOverdeckSchemaSync(db, OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS);
  const missing = [
    ...report.missingTables.map((table) => `table ${table}`),
    ...report.missingIndexes.map((index) => `index ${index}`),
    ...report.missingColumns.map(({ table, column }) => `column ${table}.${column}`),
  ];
  if (missing.length > 0) {
    db.close();
    throw new Error(`overdeck.db schema is incompatible; writable dashboard startup must update: ${missing.join(', ')}`);
  }
  overdeckReadOnlyDbSync = { path: dbPath, db };
  return db;
}

export function closeOverdeckDatabaseSync(): void {
  overdeckDbSync?.db.close();
  overdeckDbSync = null;
  overdeckReadOnlyDbSync?.db.close();
  overdeckReadOnlyDbSync = null;
}

function rowValues(row: SqliteRow | undefined): SqliteScalar[] {
  return row ? Object.values(row) : [];
}

function createDrizzleNodeSqliteDatabase(raw: SqliteDatabase): OverdeckDrizzleDatabase {
  const callback: RemoteCallback = async (sql, params, method) => {
    const statement = raw.prepare(sql);

    if (method === 'run') {
      statement.run(params);
      return { rows: [] };
    }

    if (method === 'get') {
      return { rows: rowValues(statement.get(params)) };
    }

    return { rows: statement.all(params).map((row) => rowValues(row)) };
  };

  return drizzle(callback, { schema: overdeckSchema });
}

export function makeDbLive(dbPath = getOverdeckDatabasePath()): Layer.Layer<Db> {
  return Layer.effect(
    Db,
    Effect.acquireRelease(
      Effect.sync(() => {
        const raw = openDatabase(dbPath);
        raw.exec('PRAGMA foreign_keys = ON');
        return raw;
      }),
      (raw) => Effect.sync(() => raw.close()),
    ).pipe(
      Effect.map((raw) =>
        Db.of({
          q: createDrizzleNodeSqliteDatabase(raw),
          path: dbPath,
        }),
      ),
    ),
  );
}

export const DbLive = makeDbLive();

export interface OverdeckEventInput {
  readonly type: string;
  readonly payload?: unknown;
  readonly timestamp?: Date | number;
}

export interface StoredOverdeckEvent {
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: Date;
  readonly payload: unknown;
}

export interface EventBusServiceShape {
  readonly emit: (event: OverdeckEventInput) => Effect.Effect<number>;
  readonly readFrom: (fromSequence: number) => Effect.Effect<ReadonlyArray<StoredOverdeckEvent>>;
  readonly getLatestSequence: Effect.Effect<number>;
  readonly stream: Stream.Stream<StoredOverdeckEvent>;
}

export class EventBus extends Context.Service<EventBus, EventBusServiceShape>()('overdeck/EventBus') {}

function eventTimestampMillis(timestamp: OverdeckEventInput['timestamp']): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  return timestamp ?? Date.now();
}

function parsePayload(payload: string | null | undefined): unknown {
  if (payload == null) {
    return null;
  }
  return JSON.parse(payload);
}

function readEventRow(row: {
  sequence: number;
  type: string;
  timestamp: number;
  payload?: string | null;
}): StoredOverdeckEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    timestamp: new Date(row.timestamp),
    payload: parsePayload(row.payload),
  };
}

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const db = yield* Db;
    const queue = yield* Queue.unbounded<StoredOverdeckEvent>();

    return EventBus.of({
      emit: (event) =>
        Effect.promise(async () => {
          const timestamp = eventTimestampMillis(event.timestamp);
          const payload = event.payload ?? null;
          const [inserted] = await db.q.insert(overdeckEvents).values({
            type: event.type,
            timestamp: new Date(timestamp),
            payload,
          }).returning({
            sequence: overdeckEvents.sequence,
            type: overdeckEvents.type,
            timestamp: overdeckEvents.timestamp,
            payload: overdeckEvents.payload,
          });
          if (!inserted) {
            throw new Error(`Failed to insert overdeck event ${event.type}.`);
          }
          const stored = readEventRow({
            sequence: inserted.sequence,
            type: inserted.type,
            timestamp: inserted.timestamp.getTime(),
            payload: JSON.stringify(inserted.payload ?? null),
          });
          Effect.runSync(Queue.offer(queue, stored));
          return stored.sequence;
        }),
      readFrom: (fromSequence) =>
        Effect.promise(async () =>
          (await db.q
            .select()
            .from(overdeckEvents)
            .where(gt(overdeckEvents.sequence, fromSequence))
            .orderBy(asc(overdeckEvents.sequence)))
            .map((row) => readEventRow({
              sequence: row.sequence,
              type: row.type,
              timestamp: row.timestamp.getTime(),
              payload: JSON.stringify(row.payload ?? null),
            })),
        ),
      getLatestSequence: Effect.promise(async () => {
        const [row] = await db.q
          .select({ sequence: sql<number>`COALESCE(MAX(${overdeckEvents.sequence}), 0)` })
          .from(overdeckEvents);
        return Number(row?.sequence ?? 0);
      }),
      stream: Stream.fromQueue(queue),
    });
  }),
);

export interface RecordsServiceShape {
  readonly writeIssue: (project: ProjectConfig, issueId: string, record: PanIssueRecord) => Effect.Effect<string>;
  readonly readIssue: (project: ProjectConfig, issueId: string) => Effect.Effect<PanIssueRecord | null>;
  readonly readSpec: (planRef: string) => Effect.Effect<unknown>;
  readonly writeAgentIdentity: (issueId: string, opts: { harness: string; model: string }) => Effect.Effect<void>;
}

export class Records extends Context.Service<Records, RecordsServiceShape>()('overdeck/Records') {}

export const RecordsLive = Layer.succeed(
  Records,
  Records.of({
    writeIssue: (project, issueId, record) => Effect.promise(async () => {
      await updateIssueRecord(project, issueId, () => record);
      return getIssueRecordPath(project, issueId);
    }),
    readIssue: (project, issueId) => Effect.sync(() => readIssueRecordSync(project, issueId)),
    readSpec: (planRef) =>
      Effect.sync(() => {
        const path = isAbsolute(planRef) ? planRef : join(packageRoot, planRef);
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
      }),
    writeAgentIdentity: (_issueId, _opts) => Effect.void,
  }),
);

export interface TmuxServiceShape {
  readonly sessionExists: (sessionName: string) => Effect.Effect<boolean>;
  readonly killSession: (sessionName: string) => Effect.Effect<void>;
  readonly readRuntimeJson: (agentId: string) => Effect.Effect<unknown>;
  /** Returns session names of all active agent-* tmux sessions. Never fails — returns [] on error. */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<string>>;
}

export class Tmux extends Context.Service<Tmux, TmuxServiceShape>()('overdeck/Tmux') {}

export const TmuxLive = Layer.succeed(
  Tmux,
  Tmux.of({
    sessionExists: (name) =>
      tmuxSessionExists(name).pipe(Effect.catch(() => Effect.succeed(false))),
    killSession: (name) =>
      tmuxKillSession(name).pipe(Effect.catch(() => Effect.void)),
    readRuntimeJson: (agentId) =>
      Effect.promise(async () => {
        try {
          const path = join(getOverdeckHome(), 'agents', agentId, 'runtime.json');
          const text = await readFile(path, 'utf8');
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      }),
    listSessions: () =>
      getAgentSessions().pipe(
        Effect.map((sessions) => sessions.map((s) => s.name)),
        Effect.catch(() => Effect.succeed([] as readonly string[])),
      ),
  }),
);

export interface ForgeServiceShape {
  readonly merge: (input: unknown) => Effect.Effect<unknown>;
  readonly approve: (input: unknown) => Effect.Effect<unknown>;
}

export class Forge extends Context.Service<Forge, ForgeServiceShape>()('overdeck/Forge') {}

export interface ProjectsServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectConfig>>;
  readonly get: (projectId: string) => Effect.Effect<ProjectConfig | null>;
  readonly resolveIssue: (issueId: string) => Effect.Effect<ProjectConfig | null>;
}

export class Projects extends Context.Service<Projects, ProjectsServiceShape>()('overdeck/Projects') {}

export interface CostArchiveServiceShape {
  readonly append: (event: unknown) => Effect.Effect<void>;
}

export class CostArchive extends Context.Service<CostArchive, CostArchiveServiceShape>()('overdeck/CostArchive') {}

function costArchivePath(): string {
  return join(getOverdeckHome(), 'costs', 'events.jsonl');
}

function archiveKey(event: { requestId?: unknown; sourceFile?: unknown; source?: unknown }): string | null {
  if (typeof event.requestId === 'string' && event.requestId.length > 0) return `request:${event.requestId}`;
  const source = typeof event.sourceFile === 'string'
    ? event.sourceFile
    : typeof event.source === 'string'
      ? event.source
      : null;
  return source ? `source:${source}` : null;
}

function toCostArchiveEvent(event: Record<string, unknown>): Record<string, unknown> {
  const ts = event.ts instanceof Date
    ? event.ts.toISOString()
    : typeof event.ts === 'string'
      ? event.ts
      : new Date().toISOString();

  return {
    ts,
    type: 'cost',
    agentId: typeof event.agentId === 'string' ? event.agentId : 'unknown',
    issueId: typeof event.issueId === 'string' ? event.issueId : 'UNKNOWN',
    sessionType: typeof event.sessionType === 'string' ? event.sessionType : 'unknown',
    provider: typeof event.provider === 'string' ? event.provider : 'unknown',
    model: typeof event.model === 'string' ? event.model : 'unknown',
    input: typeof event.input === 'number' ? event.input : 0,
    output: typeof event.output === 'number' ? event.output : 0,
    cacheRead: typeof event.cacheRead === 'number' ? event.cacheRead : 0,
    cacheWrite: typeof event.cacheWrite === 'number' ? event.cacheWrite : 0,
    cost: typeof event.cost === 'number' ? event.cost : 0,
    ...(typeof event.requestId === 'string' ? { requestId: event.requestId } : {}),
    ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
    ...(typeof event.sourceFile === 'string' ? { source: event.sourceFile } : {}),
    ...(Array.isArray(event.warnings) ? { warnings: event.warnings } : {}),
  };
}

export const CostArchiveLive = Layer.succeed(
  CostArchive,
  CostArchive.of((() => {
    let seen: Set<string> | null = null;

    const loadSeen = () => {
      if (seen) return seen;
      seen = new Set<string>();
      const path = costArchivePath();
      if (!existsSync(path)) return seen;
      const content = readFileSync(path, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const key = archiveKey(parsed);
          if (key) seen.add(key);
        } catch {
          // Ignore malformed historical lines; readers do the same.
        }
      }
      return seen;
    };

    return {
      append: (event) => Effect.sync(() => {
        const normalized = toCostArchiveEvent(event as Record<string, unknown>);
        const key = archiveKey(normalized);
        const archiveSeen = loadSeen();
        if (key && archiveSeen.has(key)) return;

        const path = costArchivePath();
        mkdirSync(dirname(path), { recursive: true });
        if (!existsSync(path)) writeFileSync(path, '', 'utf8');
        appendFileSync(path, `${JSON.stringify(normalized)}\n`, 'utf8');
        if (key) archiveSeen.add(key);
      }),
    };
  })()),
);

export type FtsStatement = Readonly<{
  method?: 'all' | 'exec' | 'get' | 'run';
  sql: string;
  params?: ReadonlyArray<unknown>;
}>;

export interface MemorySearchServiceShape {
  readonly statement: <T>(projectId: string, statement: FtsStatement) => Effect.Effect<T>;
  readonly transaction: (
    projectId: string,
    statements: ReadonlyArray<FtsStatement>,
  ) => Effect.Effect<ReadonlyArray<unknown>>;
}

export class MemorySearch extends Context.Service<MemorySearch, MemorySearchServiceShape>()('overdeck/MemorySearch') {}

export interface MemoryFilesServiceShape {
  readonly appendObservation: (observation: unknown) => Effect.Effect<{ jsonlPath: string; byteOffset: number }>;
  readonly upsertMarkdown: (observation: unknown) => Effect.Effect<void>;
  readonly readStatus: (projectId: string, issueId: string) => Effect.Effect<unknown | null>;
  readonly writeStatus: (projectId: string, issueId: string, status: unknown) => Effect.Effect<void>;
  readonly readResetMarkers: (projectId: string) => Effect.Effect<ReadonlyArray<unknown>>;
  readonly writeResetMarker: (projectId: string, marker: unknown) => Effect.Effect<void>;
  readonly listObservationFiles: (projectId: string) => Effect.Effect<ReadonlyArray<string>>;
  readonly readObservationsFile: (path: string) => Effect.Effect<ReadonlyArray<unknown>>;
  readonly findByteOffset: (path: string, id: string) => Effect.Effect<number>;
}

export class MemoryFiles extends Context.Service<MemoryFiles, MemoryFilesServiceShape>()('overdeck/MemoryFiles') {}
