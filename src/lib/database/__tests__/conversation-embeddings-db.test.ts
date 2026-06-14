import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openEmbeddingsDb, dimensionsForModel } from '../conversation-embeddings-db.js';
import type { ChunkInsert, EmbeddingsDbHandle } from '../conversation-embeddings-db.js';
import { openDatabase, type SqliteDatabase } from '../driver.js';

const require = createRequire(import.meta.url);
const sqliteVec = require('sqlite-vec') as { getLoadablePath: () => string };

let tmpDir: string | undefined;
let handle: EmbeddingsDbHandle | undefined;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-embeddings-'));
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function makeChunk(overrides: Partial<ChunkInsert> = {}): ChunkInsert {
  return {
    sessionId: 'session-abc',
    projectId: 'panopticon-cli',
    role: 'assistant',
    ts: '2026-06-02T00:00:00.000Z',
    byteOffset: 0,
    charLength: 17,
    text: 'Hello world chunk',
    tokenCount: 3,
    indexedAt: '2026-06-02T00:00:01.000Z',
    ...overrides,
  };
}

function openRawDb(dbPath: string): SqliteDatabase {
  const db = openDatabase(dbPath, { allowExtension: true });
  db.loadExtension(sqliteVec.getLoadablePath());
  return db;
}

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('conversation-embeddings-db', () => {
  describe('openEmbeddingsDb', () => {
    it('opens successfully and reports available=true', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      expect(handle.available).toBe(true);
      expect(handle.dimensions).toBe(8);
      expect(handle.unavailableReason).toBeUndefined();
    });

    it('creates the db directory if it does not exist', () => {
      const dir = makeTmpDir();
      const nested = join(dir, 'nested', 'conversations');
      handle = openEmbeddingsDb(join(nested, 'embeddings.db'), 8);
      expect(handle.available).toBe(true);
    });

    it('returns available=false for a path that cannot be created', () => {
      const dir = makeTmpDir();
      const notADirectory = join(dir, 'not-a-directory');
      writeFileSync(notADirectory, 'file blocks directory creation');

      handle = openEmbeddingsDb(join(notADirectory, 'embeddings.db'), 8);
      expect(handle.available).toBe(false);
      expect(handle.unavailableReason).toMatch(/failed to open db/i);
    });

    it('returns available=false when sqlite-vec cannot be loaded', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8, { sqliteVecPath: join(dir, 'missing-vec0.so') });
      expect(handle.available).toBe(false);
      expect(handle.unavailableReason).toMatch(/sqlite-vec extension failed to load/i);
    });

    it('returns available=false and meaningful reason when dimension mismatches existing DB', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');

      const first = openEmbeddingsDb(dbPath, 8);
      expect(first.available).toBe(true);
      first.close();

      handle = openEmbeddingsDb(dbPath, 16);
      expect(handle.available).toBe(false);
      expect(handle.unavailableReason).toMatch(/dimension mismatch/i);
    });

    it('can be reopened with the same dimension (idempotent init)', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');

      const first = openEmbeddingsDb(dbPath, 8);
      expect(first.available).toBe(true);
      first.close();

      handle = openEmbeddingsDb(dbPath, 8);
      expect(handle.available).toBe(true);
    });
  });

  describe('schema', () => {
    it('creates chunks, chunks_fts, chunks_vec, file_cursors, and db_config tables', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      handle = openEmbeddingsDb(dbPath, 8);
      expect(handle.available).toBe(true);
      handle.close();
      handle = undefined;

      const db = openRawDb(dbPath);
      try {
        const names = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')`).all().map((row: { name: string }) => row.name);
        expect(names).toEqual(expect.arrayContaining(['chunks', 'chunks_fts', 'chunks_vec', 'file_cursors', 'db_config']));
      } finally {
        db.close();
      }
    });

    it('stores the configured dimensions in db_config', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      handle = openEmbeddingsDb(dbPath, 4);
      expect(handle.available).toBe(true);
      handle.close();
      handle = undefined;

      const db = openRawDb(dbPath);
      try {
        expect(db.prepare(`SELECT value FROM db_config WHERE key = 'dimensions'`).get()).toEqual({ value: '4' });
      } finally {
        db.close();
      }
    });
  });

  describe('upsertChunk', () => {
    it('inserts a chunk and returns a positive rowid', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk(makeChunk());
      expect(rowid).toBeGreaterThan(0);
    });

    it('stores chunker record fields in the chunks table', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      handle = openEmbeddingsDb(dbPath, 8);
      const rowid = handle.upsertChunk(makeChunk({
        sessionId: 'session-fields',
        projectId: 'project-fields',
        role: 'user',
        ts: '2026-06-02T01:02:03.000Z',
        byteOffset: 128,
        charLength: 42,
        text: 'field check text',
        tokenCount: 4,
      }));
      handle.close();
      handle = undefined;

      const db = openRawDb(dbPath);
      try {
        expect(db.prepare(`SELECT session_id, project_id, role, ts, byte_offset, char_length, text, token_count FROM chunks WHERE rowid = ?`).get(rowid)).toEqual({
          session_id: 'session-fields',
          project_id: 'project-fields',
          role: 'user',
          ts: '2026-06-02T01:02:03.000Z',
          byte_offset: 128,
          char_length: 42,
          text: 'field check text',
          token_count: 4,
        });
      } finally {
        db.close();
      }
    });

    it('returns the same rowid and does not duplicate on conflict', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      handle = openEmbeddingsDb(dbPath, 8);
      const chunk = makeChunk({ sessionId: 'session-abc', byteOffset: 0, text: 'First content', tokenCount: 2 });
      const rowid1 = handle.upsertChunk(chunk);
      const rowid2 = handle.upsertChunk({ ...chunk, text: 'Updated content', charLength: 15 });
      expect(rowid1).toBe(rowid2);
      handle.close();
      handle = undefined;

      const db = openRawDb(dbPath);
      try {
        expect(db.prepare(`SELECT count(*) AS count FROM chunks WHERE session_id = ? AND byte_offset = ?`).get('session-abc', 0)).toEqual({ count: 1 });
        expect(db.prepare(`SELECT text FROM chunks WHERE rowid = ?`).get(rowid1)).toEqual({ text: 'Updated content' });
      } finally {
        db.close();
      }
    });

    it('assigns distinct rowids for different (sessionId, byteOffset) pairs', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const r1 = handle.upsertChunk(makeChunk({ sessionId: 'sess', byteOffset: 0, text: 'chunk A' }));
      const r2 = handle.upsertChunk(makeChunk({ sessionId: 'sess', byteOffset: 100, text: 'chunk B' }));
      const r3 = handle.upsertChunk(makeChunk({ sessionId: 'sess2', byteOffset: 0, text: 'chunk C' }));
      expect(new Set([r1, r2, r3]).size).toBe(3);
    });
  });

  describe('upsertEmbedding', () => {
    it('stores a Float32Array embedding for a chunk rowid', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk(makeChunk());
      expect(() => handle?.upsertEmbedding(rowid, new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]))).not.toThrow();
    });

    it('overwrites the embedding on a second call for the same rowid (idempotent)', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk(makeChunk());
      handle.upsertEmbedding(rowid, new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
      expect(() => handle?.upsertEmbedding(rowid, new Float32Array(8).fill(0.5))).not.toThrow();
    });

    it('rejects vectors with the wrong dimension', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk(makeChunk());
      expect(() => handle?.upsertEmbedding(rowid, new Float32Array(7))).toThrow(/dimension mismatch/i);
    });
  });

  describe('file cursors', () => {
    it('returns 0 for an unknown file', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      expect(handle.getCursor('/some/file.jsonl')).toBe(0);
    });

    it('stores and retrieves a cursor', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      handle.setCursor('/some/file.jsonl', 4096);
      expect(handle.getCursor('/some/file.jsonl')).toBe(4096);
    });

    it('updates an existing cursor', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      handle.setCursor('/file.jsonl', 1024);
      handle.setCursor('/file.jsonl', 2048);
      expect(handle.getCursor('/file.jsonl')).toBe(2048);
    });

    it('tracks independent cursors for different files', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      handle.setCursor('/a.jsonl', 100);
      handle.setCursor('/b.jsonl', 200);
      expect(handle.getCursor('/a.jsonl')).toBe(100);
      expect(handle.getCursor('/b.jsonl')).toBe(200);
    });
  });

  describe('getStats', () => {
    it('returns chunk count, indexed file count, and latest indexed timestamp', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      handle.upsertChunk(makeChunk({ sessionId: 'stats-a', byteOffset: 0, indexedAt: '2026-06-02T01:00:00.000Z' }));
      handle.upsertChunk(makeChunk({ sessionId: 'stats-b', byteOffset: 0, indexedAt: '2026-06-02T02:00:00.000Z' }));
      handle.setCursor('/tmp/session-a.jsonl', 100);

      expect(handle.getStats()).toEqual({
        chunkCount: 2,
        indexedFileCount: 1,
        lastIndexedAt: '2026-06-02T02:00:00.000Z',
      });
    });
  });

  describe('deleteSession', () => {
    it('removes all chunks and embeddings for a session without affecting others', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      handle = openEmbeddingsDb(dbPath, 8);

      const r1 = handle.upsertChunk(makeChunk({ sessionId: 'keep', byteOffset: 0, text: 'keep this' }));
      handle.upsertEmbedding(r1, new Float32Array(8).fill(0.1));

      const r2 = handle.upsertChunk(makeChunk({ sessionId: 'delete-me', byteOffset: 0, text: 'delete this' }));
      handle.upsertEmbedding(r2, new Float32Array(8).fill(0.2));

      handle.deleteSession('delete-me');
      handle.close();
      handle = undefined;

      const db = openRawDb(dbPath);
      try {
        expect(db.prepare(`SELECT count(*) AS count FROM chunks WHERE session_id = 'keep'`).get()).toEqual({ count: 1 });
        expect(db.prepare(`SELECT count(*) AS count FROM chunks WHERE session_id = 'delete-me'`).get()).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    });
  });

  describe('dimensionsForModel', () => {
    it('returns 1536 for text-embedding-3-small', () => {
      expect(dimensionsForModel('text-embedding-3-small')).toBe(1536);
    });

    it('returns 3072 for text-embedding-3-large', () => {
      expect(dimensionsForModel('text-embedding-3-large')).toBe(3072);
    });

    it('returns 1536 as default for unknown models', () => {
      expect(dimensionsForModel('some-future-model')).toBe(1536);
    });
  });
});
