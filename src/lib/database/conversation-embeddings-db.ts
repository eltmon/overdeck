/**
 * Conversation Embeddings Sidecar Database (PAN-1395)
 *
 * Manages ~/.panopticon/conversations/embeddings.db:
 *   - FTS5 virtual table for BM25 keyword search
 *   - sqlite-vec vec0 virtual table for cosine ANN search
 *   - chunk_index master table (session_id + byte_offset keyed, rowid shared
 *     with FTS and vec tables for RRF fusion)
 *   - file_cursors for idempotent incremental indexing
 *
 * Only safe to call from the Node 22 dashboard server — uses better-sqlite3
 * and sqlite-vec native extensions, both incompatible with Bun.
 *
 * Fail-closed: if sqlite-vec cannot be loaded, open() returns { available: false }
 * and no embeddings or vector search are performed. FTS-only search may still
 * work in this degraded mode (future), but for now the whole feature gates on
 * availability.
 */

import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const _require = createRequire(import.meta.url);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ChunkInsert {
  sessionId: string;
  byteOffset: number;
  text: string;
  tokenCount: number;
  indexedAt: string;
}

export interface ChunkRow {
  rowid: number;
  sessionId: string;
  byteOffset: number;
  text: string;
  tokenCount: number;
  indexedAt: string;
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

  /** Remove all chunks and embeddings for a session (used when a session is deleted). */
  deleteSession(sessionId: string): void;

  /** Close the DB connection. */
  close(): void;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

function initSchema(db: Database.Database, dimensions: number): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= SCHEMA_VERSION) return;

  db.exec(`
    -- Source of truth: one row per indexed chunk, rowid shared with FTS + vec
    CREATE TABLE IF NOT EXISTS chunk_index (
      rowid     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      byte_offset INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      indexed_at  TEXT    NOT NULL,
      UNIQUE(session_id, byte_offset)
    );

    -- FTS5 for BM25 keyword search; content= avoids duplicating text
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content=chunk_index,
      content_rowid=rowid,
      tokenize='porter ascii'
    );

    -- Triggers to keep chunks_fts in sync with chunk_index
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunk_index BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunk_index BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunk_index BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;

    -- Incremental indexing cursors (one row per JSONL file)
    CREATE TABLE IF NOT EXISTS file_cursors (
      file_path  TEXT PRIMARY KEY,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL
    );

    -- DB metadata (dimensions, model, etc.)
    CREATE TABLE IF NOT EXISTS db_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // vec0 dimension is baked into the CREATE TABLE statement
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      rowid INTEGER PRIMARY KEY,
      embedding float[${dimensions}]
    );
  `);

  db.exec(`INSERT OR IGNORE INTO db_config(key, value) VALUES ('dimensions', '${dimensions}')`);
  db.exec(`INSERT OR IGNORE INTO db_config(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`);

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// ─── Prepared statement cache ─────────────────────────────────────────────────

interface Stmts {
  upsertChunk: Database.Statement;
  upsertEmbedding: Database.Statement;
  getCursor: Database.Statement;
  setCursor: Database.Statement;
  deleteChunksBySession: Database.Statement;
  deleteEmbeddingsBySession: Database.Statement;
  getDbConfig: Database.Statement;
}

function prepareStmts(db: Database.Database): Stmts {
  return {
    upsertChunk: db.prepare(`
      INSERT INTO chunk_index(session_id, byte_offset, text, token_count, indexed_at)
      VALUES (@sessionId, @byteOffset, @text, @tokenCount, @indexedAt)
      ON CONFLICT(session_id, byte_offset) DO UPDATE SET
        text       = excluded.text,
        token_count = excluded.token_count,
        indexed_at  = excluded.indexed_at
      RETURNING rowid
    `),
    upsertEmbedding: db.prepare(`
      INSERT INTO chunks_vec(rowid, embedding) VALUES (?, ?)
      ON CONFLICT(rowid) DO UPDATE SET embedding = excluded.embedding
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
      DELETE FROM chunk_index WHERE session_id = ?
    `),
    deleteEmbeddingsBySession: db.prepare(`
      DELETE FROM chunks_vec WHERE rowid IN (
        SELECT rowid FROM chunk_index WHERE session_id = ?
      )
    `),
    getDbConfig: db.prepare(`SELECT value FROM db_config WHERE key = ?`),
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Open (or create) the conversation embeddings sidecar DB.
 *
 * @param dbPath   Absolute path to the embeddings.db file.
 * @param dimensions  Embedding vector size (must match what was used to create the DB).
 */
export function openEmbeddingsDb(dbPath: string, dimensions: number): EmbeddingsDbHandle {
  const unavailable = (reason: string): EmbeddingsDbHandle => ({
    available: false,
    unavailableReason: reason,
    dimensions,
    upsertChunk: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    upsertEmbedding: () => { throw new Error(`EmbeddingsDb unavailable: ${reason}`); },
    getCursor: () => 0,
    setCursor: () => {},
    deleteSession: () => {},
    close: () => {},
  });

  let db: Database.Database;
  try {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const BetterSqlite3 = _require('better-sqlite3');
    db = new BetterSqlite3(dbPath) as Database.Database;
  } catch (err) {
    return unavailable(`Failed to open DB at ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    // sqlite-vec must be loaded before FTS5 schema that references vec0
    const { getLoadablePath } = _require('sqlite-vec') as { getLoadablePath: () => string };
    db.loadExtension(getLoadablePath());
  } catch (err) {
    db.close();
    return unavailable(`sqlite-vec extension failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    // Check if DB was created with a different dimension
    const existingDims = (db.prepare('SELECT value FROM db_config WHERE key = ?').get('dimensions') as { value: string } | undefined)?.value;
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
      const row = stmts.upsertChunk.get(chunk) as { rowid: number };
      return row.rowid;
    },

    upsertEmbedding(rowid: number, embedding: Float32Array): void {
      stmts.upsertEmbedding.run(rowid, embedding);
    },

    getCursor(filePath: string): number {
      const row = stmts.getCursor.get(filePath) as { byte_offset: number } | undefined;
      return row?.byte_offset ?? 0;
    },

    setCursor(filePath: string, byteOffset: number): void {
      stmts.setCursor.run(filePath, byteOffset, new Date().toISOString());
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
