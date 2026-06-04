import { openDatabase, type SqliteDatabase, type SqliteBindValue } from '../database/driver.js';
import { ensureParentDir, resolveFtsDbPath } from './paths.js';

const databases = new Map<string, SqliteDatabase>();
const openingDatabases = new Map<string, Promise<SqliteDatabase>>();

export interface MemoryFtsStatement {
  sql: string;
  params?: unknown[];
  method: 'all' | 'get' | 'run' | 'exec';
}

export async function getMemoryFtsDatabase(projectId: string): Promise<SqliteDatabase> {
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

export async function withMemoryFtsDatabase<T>(projectId: string, operation: (db: SqliteDatabase) => T): Promise<T> {
  const db = await getMemoryFtsDatabase(projectId);
  return deferSqliteWork(() => operation(db));
}

export async function runMemoryFtsStatement<T = unknown>(projectId: string, statement: MemoryFtsStatement): Promise<T> {
  const db = await getMemoryFtsDatabase(projectId);
  return deferSqliteWork(() => runStatement(db, statement) as T);
}

export async function runMemoryFtsTransaction(projectId: string, statements: MemoryFtsStatement[]): Promise<unknown[]> {
  const db = await getMemoryFtsDatabase(projectId);
  return deferSqliteWork(() => db.transaction(() => statements.map((statement) => runStatement(db, statement)))());
}

export function closeMemoryFtsDatabases(): void {
  for (const db of databases.values()) {
    db.close();
  }
  databases.clear();
  openingDatabases.clear();
}

async function openMemoryFtsDatabase(projectId: string): Promise<SqliteDatabase> {
  const dbPath = resolveFtsDbPath(projectId);
  await ensureParentDir(dbPath);

  return deferSqliteWork(() => {
    const cached = databases.get(projectId);
    if (cached) return cached;

    const db = openDatabase(dbPath);
    configureDatabase(db);
    initializeMemoryFtsSchema(db);
    databases.set(projectId, db);
    return db;
  });
}

function configureDatabase(db: SqliteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 67108864');
}

function initializeMemoryFtsSchema(db: SqliteDatabase): void {
  migrateMemoryFtsBranchColumn(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      display_content UNINDEXED,
      source,
      branch UNINDEXED,
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

function migrateMemoryFtsBranchColumn(db: SqliteDatabase): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'").get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes('branch UNINDEXED')) return;

  db.exec(`
    CREATE VIRTUAL TABLE memory_fts_rebuild USING fts5(
      content,
      display_content UNINDEXED,
      source,
      branch UNINDEXED,
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
    INSERT INTO memory_fts_rebuild(rowid, content, display_content, source, branch, entry_date, entry_time, entry_type, files, tags, doc_type, scope, project_id, workspace_id, issue_id, run_id, session_id, agent_role, agent_harness)
    SELECT rowid, content, display_content, source, branch, entry_date, entry_time, entry_type, files, tags, doc_type, scope, project_id, workspace_id, issue_id, run_id, session_id, agent_role, agent_harness
    FROM memory_fts;
    DROP TABLE memory_fts;
    ALTER TABLE memory_fts_rebuild RENAME TO memory_fts;
  `);
}

function runStatement(db: SqliteDatabase, statement: MemoryFtsStatement): unknown {
  if (statement.method === 'exec') {
    db.exec(statement.sql);
    return null;
  }
  const prepared = db.prepare(statement.sql);
  const params = (statement.params ?? []) as SqliteBindValue[];
  return prepared[statement.method](...params);
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
