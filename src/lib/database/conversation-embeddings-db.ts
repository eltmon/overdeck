/**
 * Conversation Embeddings Sidecar Database (PAN-1395)
 *
 * Manages ~/.overdeck/conversations/embeddings.db:
 *   - chunks source table keyed by (session_id, byte_offset)
 *   - FTS5 virtual table for BM25 keyword search
 *   - sqlite-vec vec0 virtual table for cosine ANN search
 *   - file_cursors for idempotent incremental indexing
 *
 * Only safe to call from the Node 22 dashboard server — uses the shared SQLite
 * adapter plus the sqlite-vec native extension.
 *
 * Fail-closed: if sqlite-vec cannot be loaded, open() returns { available: false }
 * and no embeddings or vector search are performed.
 */

import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase, type SqliteDatabase, type SqliteStatement } from './driver.js';

const _require = createRequire(import.meta.url);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ChunkInsert {
  sessionId: string;
  projectId: string;
  role: string;
  ts?: string | null;
  byteOffset: number;
  charLength: number;
  text: string;
  tokenCount: number;
  indexedAt: string;
}

export interface ChunkRow {
  rowid: number;
  sessionId: string;
  projectId: string;
  role: string;
  ts: string | null;
  byteOffset: number;
  charLength: number;
  text: string;
  tokenCount: number;
  indexedAt: string;
}

export interface ChunkSearchRow extends ChunkRow {
  score: number;
}

export interface EmbeddingsDbStats {
  chunkCount: number;
  indexedFileCount: number;
  lastIndexedAt: string | null;
}

export interface EmbeddingsDbHandle {
  /** Whether sqlite-vec loaded and schema init succeeded */
  available: boolean;
  /** Reason for unavailability (for health/doctor surfaces) */
  unavailableReason?: string;
  /** Embedding vector dimensions this DB was created with */
  dimensions: number;

  /**
   * Upsert a chunk by (sessionId, byteOffset).
   * Returns the rowid — the same rowid must be used for the vec embedding.
   */
  upsertChunk(chunk: ChunkInsert): number;

  /**
   * Upsert an embedding vector for a given chunk rowid.
   * Must be called after upsertChunk with the returned rowid.
   */
  upsertEmbedding(rowid: number, embedding: Float32Array): void;

  /** Returns the current byte-offset cursor for a file path, or 0 if not set. */
  getCursor(filePath: string): number;

  /** Persists the byte-offset cursor for a file path. */
  setCursor(filePath: string, byteOffset: number): void;

  /** BM25 keyword search over indexed chunk text. */
  searchBm25(query: string, limit: number): ChunkSearchRow[];

  /** Cosine/ANN vector search over indexed embeddings. */
  searchVector(embedding: Float32Array, limit: number): ChunkSearchRow[];

  /** Sidecar indexing stats for settings/status surfaces. */
  getStats(): EmbeddingsDbStats;

  /** Remove all chunks and embeddings for a session (used when a session is deleted). */
  deleteSession(sessionId: string): void;

  /** Close the DB connection. */
  close(): void;
}

export interface OpenEmbeddingsDbOptions {
  /** Test hook: override the sqlite-vec loadable extension path. */
  sqliteVecPath?: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?`)
    .get(tableName) as { 1: number } | undefined;
  return row !== undefined;
}

function getConfigValue(db: SqliteDatabase, key: string): string | undefined {
  if (!tableExists(db, 'db_config')) return undefined;
  return (db.prepare('SELECT value FROM db_config WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function initSchema(db: SqliteDatabase, dimensions: number): void {
  db.exec(`
    -- Source of truth: one row per indexed chunk, rowid shared with FTS + vec
    CREATE TABLE IF NOT EXISTS chunks (
      rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      project_id  TEXT    NOT NULL,
      role        TEXT    NOT NULL,
      ts          TEXT,
      byte_offset INTEGER NOT NULL,
      char_length INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      indexed_at  TEXT    NOT NULL,
      UNIQUE(session_id, byte_offset)
    );

    -- FTS5 for BM25 keyword search; content= keeps text stored in chunks
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='rowid',
      tokenize='porter ascii'
    );

    -- Triggers to keep chunks_fts in sync with chunks
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;

    -- Incremental indexing cursors (one row per JSONL file)
    CREATE TABLE IF NOT EXISTS file_cursors (
      file_path   TEXT PRIMARY KEY,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL
    );

    -- DB metadata (dimensions, schema version, etc.)
    CREATE TABLE IF NOT EXISTS db_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // vec0 dimensions are baked into the CREATE TABLE statement.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      embedding float[${dimensions}]
    );
  `);

  db.prepare(`INSERT OR IGNORE INTO db_config(key, value) VALUES (?, ?)`).run('dimensions', String(dimensions));
  db.prepare(`INSERT OR REPLACE INTO db_config(key, value) VALUES (?, ?)`).run('schema_version', String(SCHEMA_VERSION));

  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// ─── Prepared statement cache ─────────────────────────────────────────────────

interface Stmts {
  upsertChunk: SqliteStatement;
  deleteEmbeddingByRowid: SqliteStatement;
  upsertEmbedding: SqliteStatement;
  getCursor: SqliteStatement;
  setCursor: SqliteStatement;
  deleteChunksBySession: SqliteStatement;
  deleteEmbeddingsBySession: SqliteStatement;
}

function prepareStmts(db: SqliteDatabase): Stmts {
  return {
    upsertChunk: db.prepare(`
      INSERT INTO chunks(session_id, project_id, role, ts, byte_offset, char_length, text, token_count, indexed_at)
      VALUES (@sessionId, @projectId, @role, @ts, @byteOffset, @charLength, @text, @tokenCount, @indexedAt)
      ON CONFLICT(session_id, byte_offset) DO UPDATE SET
        project_id   = excluded.project_id,
        role         = excluded.role,
        ts           = excluded.ts,
        char_length  = excluded.char_length,
        text         = excluded.text,
        token_count  = excluded.token_count,
        indexed_at   = excluded.indexed_at
      RETURNING rowid
    `),
    deleteEmbeddingByRowid: db.prepare(`
      DELETE FROM chunks_vec WHERE rowid = CAST(? AS INTEGER)
    `),
    upsertEmbedding: db.prepare(`
      INSERT INTO chunks_vec(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)
    `),
    getCursor: db.prepare(`
      SELECT byte_offset FROM file_cursors WHERE file_path = ?
    `),
    setCursor: db.prepare(`
      INSERT INTO file_cursors(file_path, byte_offset, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET byte_offset = excluded.byte_offset, updated_at = excluded.updated_at
    `),
    deleteChunksBySession: db.prepare(`
      DELETE FROM chunks WHERE session_id = ?
    `),
    deleteEmbeddingsBySession: db.prepare(`
      DELETE FROM chunks_vec WHERE rowid IN (
        SELECT rowid FROM chunks WHERE session_id = ?
      )
    `),
  };
}

interface DbChunkSearchRow {
  rowid: number;
  session_id: string;
  project_id: string;
  role: string;
  ts: string | null;
  byte_offset: number;
  char_length: number;
  text: string;
  token_count: number;
  indexed_at: string;
  score: number;
}

function mapSearchRow(row: DbChunkSearchRow): ChunkSearchRow {
  return {
    rowid: row.rowid,
    sessionId: row.session_id,
    projectId: row.project_id,
    role: row.role,
    ts: row.ts,
    byteOffset: row.byte_offset,
    charLength: row.char_length,
    text: row.text,
    tokenCount: row.token_count,
    indexedAt: row.indexed_at,
    score: row.score,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Open (or create) the conversation embeddings sidecar DB.
 *
 * @param dbPath   Absolute path to the embeddings.db file.
 * @param dimensions  Embedding vector size (must match what was used to create the DB).
 */
export function openEmbeddingsDb(
  dbPath: string,
  dimensions: number,
  options: OpenEmbeddingsDbOptions = {},
): EmbeddingsDbHandle {
  const unavailable = (reason: string): EmbeddingsDbHandle => ({
    available: false,
    unavailableReason: reason,
    dimensions,
    upsertChunk: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    upsertEmbedding: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    getCursor: () => 0,
    setCursor: () => {},
    searchBm25: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    searchVector: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    getStats: () => ({ chunkCount: 0, indexedFileCount: 0, lastIndexedAt: null }),
    deleteSession: () => {},
    close: () => {},
  });

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    return unavailable(`Invalid embedding dimensions: ${dimensions}`);
  }

  let db: SqliteDatabase;
  try {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    db = openDatabase(dbPath, { allowExtension: true });
  } catch (err) {
    return unavailable(`Failed to open DB at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    // sqlite-vec must be loaded before creating/querying vec0 virtual tables.
    const { getLoadablePath } = _require('sqlite-vec') as { getLoadablePath: () => string };
    db.loadExtension(options.sqliteVecPath ?? getLoadablePath());
  } catch (err) {
    db.close();
    return unavailable(`sqlite-vec extension failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    const existingDims = getConfigValue(db, 'dimensions');
    if (existingDims !== undefined && parseInt(existingDims, 10) !== dimensions) {
      db.close();
      return unavailable(
        `Embedding dimension mismatch: DB was created with ${existingDims} dimensions but config requests ${dimensions}. Delete ${dbPath} to reindex.`,
      );
    }

    initSchema(db, dimensions);
  } catch (err) {
    db.close();
    return unavailable(`Schema init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const stmts = prepareStmts(db);

  return {
    available: true,
    dimensions,

    upsertChunk(chunk: ChunkInsert): number {
      const row = stmts.upsertChunk.get({ ...chunk, ts: chunk.ts ?? null }) as { rowid: number };
      return row.rowid;
    },

    upsertEmbedding(rowid: number, embedding: Float32Array): void {
      if (embedding.length !== dimensions) {
        throw new Error(`Embedding dimension mismatch: expected ${dimensions}, received ${embedding.length}`);
      }
      stmts.deleteEmbeddingByRowid.run(rowid);
      stmts.upsertEmbedding.run(rowid, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
    },

    getCursor(filePath: string): number {
      const row = stmts.getCursor.get(filePath) as { byte_offset: number } | undefined;
      return row?.byte_offset ?? 0;
    },

    setCursor(filePath: string, byteOffset: number): void {
      stmts.setCursor.run(filePath, byteOffset, new Date().toISOString());
    },

    searchBm25(query: string, limit: number): ChunkSearchRow[] {
      const rows = db.prepare(`
        SELECT c.rowid, c.session_id, c.project_id, c.role, c.ts, c.byte_offset, c.char_length, c.text, c.token_count, c.indexed_at,
               bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts) ASC
        LIMIT ?
      `).all(query, limit) as DbChunkSearchRow[];
      return rows.map(mapSearchRow);
    },

    searchVector(embedding: Float32Array, limit: number): ChunkSearchRow[] {
      const vector = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      const rows = db.prepare(`
        SELECT c.rowid, c.session_id, c.project_id, c.role, c.ts, c.byte_offset, c.char_length, c.text, c.token_count, c.indexed_at,
               v.distance AS score
        FROM chunks_vec v
        JOIN chunks c ON c.rowid = v.rowid
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance ASC
      `).all(vector, limit) as DbChunkSearchRow[];
      return rows.map(mapSearchRow);
    },

    getStats(): EmbeddingsDbStats {
      const chunks = db.prepare(`SELECT count(*) AS chunkCount, max(indexed_at) AS lastIndexedAt FROM chunks`).get() as { chunkCount: number; lastIndexedAt: string | null };
      const cursors = db.prepare(`SELECT count(*) AS indexedFileCount FROM file_cursors WHERE byte_offset > 0`).get() as { indexedFileCount: number };
      return {
        chunkCount: chunks.chunkCount,
        indexedFileCount: cursors.indexedFileCount,
        lastIndexedAt: chunks.lastIndexedAt,
      };
    },

    deleteSession(sessionId: string): void {
      stmts.deleteEmbeddingsBySession.run(sessionId);
      stmts.deleteChunksBySession.run(sessionId);
    },

    close(): void {
      db.close();
    },
  };
}

// ─── Dimension lookup ─────────────────────────────────────────────────────────

/** Returns the standard embedding dimension for a known model, or a safe default. */
export function dimensionsForModel(model: string): number {
  if (model.includes('3-large')) return 3072;
  if (model.includes('3-small')) return 1536;
  // Default: text-embedding-3-small
  return 1536;
}
