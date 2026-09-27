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
import { isPeerDashboardProcess } from '../boot-gates.js';
import type { ProjectConfig } from '../projects.js';
import { packageRoot, getOverdeckHome } from '../paths.js';
import { sessionExists as tmuxSessionExists, killSession as tmuxKillSession, getAgentSessions } from '../tmux.js';
import { getOverdeckDatabasePath, OVERDECK_MIGRATION_PATH } from './paths.js';

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
  // PAN-3917: the sentinel used to be the `agents` table, but the pipeline-state
  // mirror tables (agents, review_status, ...) are dropped by
  // dropPipelineStateMirrorTablesSync below. `events` is drizzle-owned and never
  // dropped, so it stays a valid fresh-vs-existing signal.
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'`)
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
  ensureWorkspaceTablesSync(db);
  // PAN-1577: explicit project assignment override for moving a conversation
  // between projects without relying on cwd-derived grouping.
  runSchemaTopUp(db, 'ALTER TABLE `conversations` ADD COLUMN `project_key` text');
  // #3983: the PR head an auto-merge was scheduled for, so a cancel or a
  // failure holds only for that head and a new push re-arms the scheduler.
  runSchemaTopUp(db, 'ALTER TABLE `pending_auto_merges` ADD COLUMN `head_sha` text');
  // PAN-4185: bare conversations (no Overdeck-injected context) and the
  // native CLAUDE.md opt-out persist on the row so resume/restart/fork keep them.
  runSchemaTopUp(db, 'ALTER TABLE `conversations` ADD COLUMN `bare_context` integer NOT NULL DEFAULT 0');
  runSchemaTopUp(db, 'ALTER TABLE `conversations` ADD COLUMN `skip_claude_md` integer NOT NULL DEFAULT 0');
  // PAN-3822: pull requests linked to conversations (branch-detected by the
  // pull-request sync sweep). Mirrors the init migration for existing DBs.
  runSchemaTopUp(db, 'CREATE TABLE IF NOT EXISTS `conversation_pull_requests` (`conversation_id` text NOT NULL, `host` text NOT NULL, `repository` text NOT NULL, `number` integer NOT NULL, `url` text NOT NULL, `source` text NOT NULL, `linked_at` integer NOT NULL, `dismissed_at` integer, `snapshot_json` text, PRIMARY KEY(`conversation_id`, `host`, `repository`, `number`), FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade)');
  runSchemaTopUp(db, 'CREATE INDEX IF NOT EXISTS `idx_conversation_pull_requests_key` ON `conversation_pull_requests` (`host`, `repository`, `number`)');
}

/** `app_settings` key recording that the pipeline-mirror drop already ran. */
export const PIPELINE_MIRROR_DROPPED_SETTING = 'schema.pipelineMirrorDropped';

/** Child tables first so FK-enforced DROP TABLE succeeds. */
const PIPELINE_STATE_MIRROR_TABLES = [
  'review_run_agents',
  'review_runs',
  'agents',
  'issue_policy',
  'status_history',
  'review_status',
] as const;

export interface DropPipelineStateMirrorResult {
  /** True when this call performed the drop (and wrote the marker). */
  readonly dropped: boolean;
  /** Why it did not, when it did not. */
  readonly skipped?: 'peer' | 'already-dropped';
}

/**
 * PAN-3917 (W3): drop the overdeck.db tables that mirrored pipeline state an
 * owner elsewhere already holds — agent status/liveness (now the terminal
 * backend), review/test/merge/release status (now PR reviews, check runs, and
 * forge mergeability), and their run-scoped children. Costs, conversation
 * search, health history, caches, and the events table are untouched.
 *
 * fix10: this used to run from `ensureRuntimeIndexesSync`, i.e. on EVERY open
 * of the database by ANY process. A throwaway peer boot of the new build
 * against the real `~/.overdeck` therefore dropped `agents` out from under the
 * running 0.51.0 dashboard, which crash-looped on "no such table: agents".
 *
 * Two gates make that impossible:
 *   1. **Primary only.** A peer dashboard shares someone else's database and
 *      must never run a migration that drops or alters tables.
 *   2. **Exactly once.** A marker in `app_settings` records the drop, so a
 *      second primary boot is a no-op instead of a live DDL statement.
 *
 * It is an explicit boot step (see `src/dashboard/server/main.ts`), not a
 * side effect of opening the database, so a `pan` CLI invocation — "not peer"
 * by env, yet sharing the live database — cannot trigger it either.
 *
 * Drops and marker commit in one transaction: a partial drop must not leave a
 * marker that stops the next boot from finishing the job.
 */
export function dropPipelineStateMirrorTables(
  db: SqliteDatabase = getOverdeckDatabase(),
  env: NodeJS.ProcessEnv = process.env,
): DropPipelineStateMirrorResult {
  if (isPeerDashboardProcess(env)) return { dropped: false, skipped: 'peer' };
  if (readPipelineMirrorMarker(db) !== null) return { dropped: false, skipped: 'already-dropped' };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS `app_settings` '
      + '(`key` text PRIMARY KEY NOT NULL, `value` text, `updated_at` integer)',
    );
    for (const table of PIPELINE_STATE_MIRROR_TABLES) {
      db.exec(`DROP TABLE IF EXISTS \`${table}\``);
    }
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(PIPELINE_MIRROR_DROPPED_SETTING, new Date().toISOString(), Date.now());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { dropped: true };
}

/** The marker value, or null when the drop has not run against this database. */
export function readPipelineMirrorMarker(db: SqliteDatabase): string | null {
  try {
    const row = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(PIPELINE_MIRROR_DROPPED_SETTING) as { value: string | null } | undefined;
    return row?.value ?? null;
  } catch {
    // No app_settings table yet (a database older than the settings migration).
    return null;
  }
}

/** `app_settings` key recording that the dead `issues` FK rebuild already ran. */
const DEAD_ISSUES_FK_DROPPED_SETTING = 'schema.deadIssuesFkDropped';

/**
 * Live tables whose `issue_id → issues(id)` foreign key still gates post-cut
 * writers. Nothing inserts `issues` rows since the Cut (PAN-3917), so each of
 * these FKs rejects every new issue id (PAN-3963: batch assembly died on
 * `uat_generation_members` for exactly this reason). The dropped
 * pipeline-mirror tables are not listed — they are gone.
 */
const DEAD_ISSUES_FK_TABLES = [
  'merge_queue',
  'merge_sets',
  'release_sets',
  'pending_auto_merges',
  'uat_generation_members',
  'uat_generation_member_repos',
] as const;

const ISSUES_FK_PRESENT_RE = /FOREIGN KEY\s*\(\s*`issue_id`\s*\)\s*REFERENCES\s*`issues`\s*\(\s*`id`\s*\)/i;
/** The FK clause, with its leading comma — the last clause in every listed table. */
const ISSUES_FK_CLAUSE_RE = /,\s*FOREIGN KEY\s*\(`issue_id`\)\s*REFERENCES\s*`issues`\s*\(`id`\)[^,)]*/i;

export interface DropDeadIssuesFkResult {
  /** True when this call ran the rebuild (and wrote the marker). */
  readonly dropped: boolean;
  /** Tables actually rebuilt (absent or already-clean tables are skipped). */
  readonly tables: readonly string[];
  readonly skipped?: 'peer' | 'already-dropped';
}

/**
 * PAN-3963: rebuild the live tables whose `issue_id → issues(id)` FK can bite
 * post-cut writers, dropping that one constraint and preserving every row,
 * index, and the table's remaining FKs. SQLite has no DROP CONSTRAINT, so each
 * table is rebuilt: copy into a new table under the edited CREATE statement,
 * drop the old one, rename, recreate its indexes.
 *
 * The new definition is derived from the table's own sqlite_master SQL with
 * the issues-FK clause excised — never hand-copied — so drift between the init
 * migration, the top-ups, and a live database cannot produce a wrong schema
 * here. A table whose SQL does not carry the clause (fresh database, or one
 * already rebuilt) is skipped; a table where the excision does not match
 * cleanly aborts the whole run loudly and the marker is never written, so the
 * next primary boot retries.
 *
 * Same two gates as the pipeline-mirror drop above (fix10): PRIMARY ONLY, and
 * EXACTLY ONCE via an app_settings marker. It runs from the dashboard boot
 * step in main.ts, never on database open.
 */
export function dropDeadIssuesForeignKeys(
  db: SqliteDatabase = getOverdeckDatabase(),
  env: NodeJS.ProcessEnv = process.env,
): DropDeadIssuesFkResult {
  if (isPeerDashboardProcess(env)) return { dropped: false, tables: [], skipped: 'peer' };
  let marker: string | null = null;
  try {
    const row = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(DEAD_ISSUES_FK_DROPPED_SETTING) as { value: string | null } | undefined;
    marker = row?.value ?? null;
  } catch {
    marker = null; // no app_settings table yet
  }
  if (marker !== null) return { dropped: false, tables: [], skipped: 'already-dropped' };

  const rebuilt: string[] = [];
  // FK enforcement must be off for the drop/rename step, and the pragma is a
  // no-op inside a transaction — so it wraps the transaction, not vice versa.
  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS `app_settings` '
        + '(`key` text PRIMARY KEY NOT NULL, `value` text, `updated_at` integer)',
      );
      for (const table of DEAD_ISSUES_FK_TABLES) {
        const row = db
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { sql: string | null } | undefined;
        if (!row?.sql || !ISSUES_FK_PRESENT_RE.test(row.sql)) continue;

        const newSql = row.sql.replace(ISSUES_FK_CLAUSE_RE, '');
        if (ISSUES_FK_PRESENT_RE.test(newSql) || newSql.length >= row.sql.length) {
          throw new Error(`[schema] could not excise the issues FK from ${table} — leaving it untouched`);
        }
        const tmp = `__pan3963_${table}`;
        const tmpSql = newSql.replace(
          new RegExp(`(CREATE\\s+TABLE\\s+)\`?${table}\`?`, 'i'),
          `$1\`${tmp}\``,
        );
        if (!new RegExp(`CREATE\\s+TABLE\\s+\`${tmp}\``, 'i').test(tmpSql)) {
          throw new Error(`[schema] could not rename ${table} in its CREATE statement — leaving it untouched`);
        }

        const indexes = db
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`)
          .all(table) as Array<{ sql: string }>;

        db.exec(tmpSql);
        db.exec(`INSERT INTO \`${tmp}\` SELECT * FROM \`${table}\``);
        db.exec(`DROP TABLE \`${table}\``);
        db.exec(`ALTER TABLE \`${tmp}\` RENAME TO \`${table}\``);
        for (const index of indexes) db.exec(index.sql);
        rebuilt.push(table);
      }
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(DEAD_ISSUES_FK_DROPPED_SETTING, new Date().toISOString(), Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return { dropped: true, tables: rebuilt };
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
  // PAN-3963: no FK into `issues` — that table is a pre-cut cache nothing
  // writes any more, so the constraint rejects every post-cut issue id.
  // Existing databases get the FK dropped by dropDeadIssuesForeignKeysSync.
  db.exec(`
    CREATE TABLE IF NOT EXISTS \`release_sets\` (
      \`issue_id\` text PRIMARY KEY NOT NULL,
      \`project_key\` text NOT NULL,
      \`project_path\` text NOT NULL,
      \`workspace_type\` text NOT NULL,
      \`status\` text DEFAULT 'pending' NOT NULL,
      \`created_at\` integer NOT NULL,
      \`updated_at\` integer NOT NULL
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
      FOREIGN KEY (\`uat_name\`) REFERENCES \`uat_generations\`(\`name\`) ON UPDATE no action ON DELETE no action
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

export function getOverdeckDatabase(
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
  overdeckDbSync = { path: dbPath, db };
  return db;
}

function getOverdeckDatabaseReadOnlySync(dbPath: string): SqliteDatabase {
  if (overdeckReadOnlyDbSync?.path === dbPath) return overdeckReadOnlyDbSync.db;

  overdeckReadOnlyDbSync?.db.close();
  const db = openDatabase(dbPath, { readOnly: true });
  db.pragma('foreign_keys = ON');
  overdeckReadOnlyDbSync = { path: dbPath, db };
  return db;
}

/** Test seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8). */
export function closeOverdeckDatabase(): void {
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

/** PAN-3917: reads plan artifacts. There is no per-issue record to write. */
export interface RecordsServiceShape {
  readonly readSpec: (planRef: string) => Effect.Effect<unknown>;
  readonly writeAgentIdentity: (issueId: string, opts: { harness: string; model: string }) => Effect.Effect<void>;
}

export class Records extends Context.Service<Records, RecordsServiceShape>()('overdeck/Records') {}

export const RecordsLive = Layer.succeed(
  Records,
  Records.of({
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
