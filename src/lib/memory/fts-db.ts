import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';
import { ensureParentDir, resolveFtsDbPath } from './paths.js';

declare const Bun: unknown;

const _require = createRequire(import.meta.url);
const databases = new Map<string, Database.Database>();
const openingDatabases = new Map<string, Promise<Database.Database>>();
let worker: Worker | null = null;
let nextRequestId = 1;
const pendingWorkerRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

export interface MemoryFtsStatement {
  sql: string;
  params?: unknown[];
  method: 'all' | 'get' | 'run' | 'exec';
}


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

export async function runMemoryFtsStatement<T = unknown>(projectId: string, statement: MemoryFtsStatement): Promise<T> {
  return await postWorkerRequest<T>({ projectId, statements: [statement], transaction: false });
}

export async function runMemoryFtsTransaction(projectId: string, statements: MemoryFtsStatement[]): Promise<unknown[]> {
  return await postWorkerRequest<unknown[]>({ projectId, statements, transaction: true });
}

export function closeMemoryFtsDatabases(): void {
  for (const db of databases.values()) {
    db.close();
  }
  databases.clear();
  openingDatabases.clear();
  for (const request of pendingWorkerRequests.values()) request.reject(new Error('Memory FTS worker closed'));
  pendingWorkerRequests.clear();
  void worker?.terminate();
  worker = null;
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

function migrateMemoryFtsBranchColumn(db: Database.Database): void {
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

function postWorkerRequest<T>(payload: { projectId: string; statements: MemoryFtsStatement[]; transaction: boolean }): Promise<T> {
  const requestId = nextRequestId++;
  const activeWorker = getMemoryFtsWorker();
  return new Promise<T>((resolve, reject) => {
    pendingWorkerRequests.set(requestId, { resolve: (value) => resolve(value as T), reject });
    activeWorker.postMessage({ id: requestId, ...payload });
  });
}

function getMemoryFtsWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(memoryFtsWorkerSource(), { eval: true });
  const activeWorker = worker;
  worker.on('message', (message: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const request = pendingWorkerRequests.get(message.id);
    if (!request) return;
    pendingWorkerRequests.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error ?? 'Memory FTS worker failed'));
  });
  worker.on('error', (error) => {
    if (worker !== activeWorker) return;
    for (const request of pendingWorkerRequests.values()) request.reject(error);
    pendingWorkerRequests.clear();
    worker = null;
  });
  worker.on('exit', (code) => {
    if (worker !== activeWorker) return;
    worker = null;
    if (code === 0) return;
    for (const request of pendingWorkerRequests.values()) request.reject(new Error(`Memory FTS worker exited with code ${code}`));
    pendingWorkerRequests.clear();
  });
  return worker;
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

function memoryFtsWorkerSource(): string {
  return `
const { parentPort } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { dirname } = require('node:path');
const { mkdirSync } = require('node:fs');
const requireFromMain = createRequire(process.cwd() + '/package.json');
const BetterSqlite3 = requireFromMain('better-sqlite3');
const databases = new Map();

parentPort.on('message', (message) => {
  try {
    const db = databaseForProject(message.projectId);
    const execute = () => message.statements.map((statement) => runStatement(db, statement));
    const results = message.transaction ? db.transaction(execute)() : execute();
    parentPort.postMessage({ id: message.id, ok: true, result: message.transaction ? results : results[0] });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: error && error.message ? error.message : String(error) });
  }
});

function databaseForProject(projectId) {
  const dbPath = resolveFtsDbPath(projectId);
  const cached = databases.get(dbPath);
  if (cached) return cached;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 67108864');
  initializeMemoryFtsSchema(db);
  databases.set(dbPath, db);
  return db;
}

function runStatement(db, statement) {
  if (statement.method === 'exec') {
    db.exec(statement.sql);
    return null;
  }
  const prepared = db.prepare(statement.sql);
  return prepared[statement.method](...(statement.params || []));
}

function resolveFtsDbPath(projectId) {
  const home = process.env.PANOPTICON_HOME || require('node:path').join(require('node:os').homedir(), '.panopticon');
  return require('node:path').join(home, 'memory', assertSafeSegment(projectId), 'memory-search.db');
}

function assertSafeSegment(value) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || value === '.' || value === '..') throw new Error('Invalid memory projectId');
  return value;
}

function initializeMemoryFtsSchema(db) {
  migrateMemoryFtsBranchColumn(db);
  db.exec(\`
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
  \`);
}

function migrateMemoryFtsBranchColumn(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'").get();
  if (!row || !row.sql || row.sql.includes('branch UNINDEXED')) return;

  db.exec(\`
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
  \`);
}
`;
}
