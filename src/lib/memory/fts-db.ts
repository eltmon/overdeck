import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { ensureParentDir, resolveFtsDbPath } from './paths.js';

declare const Bun: unknown;

const _require = createRequire(import.meta.url);
const databases = new Map<string, Database.Database>();
const openingDatabases = new Map<string, Promise<Database.Database>>();

function isBunRuntime(): boolean {
  return typeof Bun !== 'undefined';
}

export async function getMemoryFtsDatabase(projectId: string): Promise<Database.Database> {
  const cached = databases.get(projectId);
  if (cached) return cached;

  const opening = openingDatabases.get(projectId);
  if (opening) return opening;

  const promise = openMemoryFtsDatabase(projectId).finally(() => {
    openingDatabases.delete(projectId);
  });
  openingDatabases.set(projectId, promise);
  return promise;
}

export async function withMemoryFtsDatabase<T>(projectId: string, operation: (db: Database.Database) => T): Promise<T> {
  const db = await getMemoryFtsDatabase(projectId);
  return deferSqliteWork(() => operation(db));
}

export function closeMemoryFtsDatabases(): void {
  for (const db of databases.values()) {
    db.close();
  }
  databases.clear();
  openingDatabases.clear();
}

async function openMemoryFtsDatabase(projectId: string): Promise<Database.Database> {
  const dbPath = resolveFtsDbPath(projectId);
  await ensureParentDir(dbPath);

  return deferSqliteWork(() => {
    const cached = databases.get(projectId);
    if (cached) return cached;

    const db = createDatabase(dbPath);
    configureDatabase(db);
    initializeMemoryFtsSchema(db);
    databases.set(projectId, db);
    return db;
  });
}

function createDatabase(dbPath: string): Database.Database {
  if (isBunRuntime()) {
    const { Database: BunDatabase } = _require('bun:sqlite') as { Database: new (path: string) => any };
    const bunDb = new BunDatabase(dbPath);
    bunDb.pragma = function (sql: string, options?: { simple?: boolean }): unknown {
      if (options?.simple) {
        const key = sql.trim();
        const row = bunDb.query(`PRAGMA ${key}`).get() as Record<string, unknown> | null;
        return row?.[key] ?? null;
      }
      bunDb.exec(`PRAGMA ${sql}`);
      return undefined;
    };
    return bunDb as Database.Database;
  }

  const BetterSqlite3 = _require('better-sqlite3');
  return new BetterSqlite3(dbPath) as Database.Database;
}

function configureDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 67108864');
}

function initializeMemoryFtsSchema(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      display_content UNINDEXED,
      source,
      branch,
      entry_date,
      entry_time,
      entry_type,
      files,
      tags UNINDEXED,
      doc_type UNINDEXED,
      scope UNINDEXED,
      project_id,
      workspace_id,
      issue_id,
      run_id,
      session_id,
      agent_role,
      agent_harness,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS reset_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      from_timestamp TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reset_markers_scope
      ON reset_markers(scope, scope_id, from_timestamp);

    CREATE INDEX IF NOT EXISTS idx_reset_markers_created_at
      ON reset_markers(created_at);

    CREATE TABLE IF NOT EXISTS observation_index (
      id TEXT PRIMARY KEY,
      observation_path_jsonl TEXT NOT NULL,
      byte_offset INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_observation_index_path_offset
      ON observation_index(observation_path_jsonl, byte_offset);
  `);
}

function deferSqliteWork<T>(operation: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(operation());
      } catch (err) {
        reject(err);
      }
    });
  });
}
