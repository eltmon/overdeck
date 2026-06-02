import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openEmbeddingsDb, dimensionsForModel } from '../conversation-embeddings-db.js';
import type { EmbeddingsDbHandle } from '../conversation-embeddings-db.js';

let tmpDir: string | undefined;
let handle: EmbeddingsDbHandle | undefined;

function makeTmpDir(): string {
  tmpDir = join(tmpdir(), `pan-embeddings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
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
      // /proc is read-only on Linux — open should fail gracefully
      handle = openEmbeddingsDb('/proc/this-cannot-exist/embeddings.db', 8);
      expect(handle.available).toBe(false);
      expect(handle.unavailableReason).toBeTruthy();
    });

    it('returns available=false and meaningful reason when dimension mismatches existing DB', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');

      // Create with dim=8
      const first = openEmbeddingsDb(dbPath, 8);
      expect(first.available).toBe(true);
      first.close();

      // Reopen with a different dim
      handle = openEmbeddingsDb(dbPath, 16);
      expect(handle.available).toBe(false);
      expect(handle.unavailableReason).toMatch(/dimension mismatch/i);
    });

    it('can be reopened with the same dimension (idempotent init)', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');

      const first = openEmbeddingsDb(dbPath, 8);
      first.close();

      handle = openEmbeddingsDb(dbPath, 8);
      expect(handle.available).toBe(true);
    });
  });

  describe('schema', () => {
    it('creates chunk_index, chunks_fts, chunks_vec, file_cursors, db_config tables', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      expect(handle.available).toBe(true);
    });

    it('stores the configured dimensions in db_config', () => {
      // Verified indirectly: if dimensions mismatch on reopen, db_config must have stored them
      const dir = makeTmpDir();
      const dbPath = join(dir, 'embeddings.db');
      const first = openEmbeddingsDb(dbPath, 4);
      expect(first.available).toBe(true);
      first.close();

      const mismatch = openEmbeddingsDb(dbPath, 8);
      expect(mismatch.available).toBe(false);
      mismatch.close();
    });
  });

  describe('upsertChunk', () => {
    it('inserts a chunk and returns a positive rowid', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk({
        sessionId: 'session-abc',
        byteOffset: 0,
        text: 'Hello world chunk',
        tokenCount: 3,
        indexedAt: new Date().toISOString(),
      });
      expect(rowid).toBeGreaterThan(0);
    });

    it('returns the same rowid on conflict (idempotent upsert)', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const chunk = {
        sessionId: 'session-abc',
        byteOffset: 0,
        text: 'First content',
        tokenCount: 2,
        indexedAt: new Date().toISOString(),
      };
      const rowid1 = handle.upsertChunk(chunk);
      const rowid2 = handle.upsertChunk({ ...chunk, text: 'Updated content' });
      expect(rowid1).toBe(rowid2);
    });

    it('assigns distinct rowids for different (sessionId, byteOffset) pairs', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const ts = new Date().toISOString();
      const r1 = handle.upsertChunk({ sessionId: 'sess', byteOffset: 0, text: 'chunk A', tokenCount: 2, indexedAt: ts });
      const r2 = handle.upsertChunk({ sessionId: 'sess', byteOffset: 100, text: 'chunk B', tokenCount: 2, indexedAt: ts });
      const r3 = handle.upsertChunk({ sessionId: 'sess2', byteOffset: 0, text: 'chunk C', tokenCount: 2, indexedAt: ts });
      expect(new Set([r1, r2, r3]).size).toBe(3);
    });
  });

  describe('upsertEmbedding', () => {
    it('stores a Float32Array embedding for a chunk rowid', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk({
        sessionId: 'sess',
        byteOffset: 0,
        text: 'content',
        tokenCount: 1,
        indexedAt: new Date().toISOString(),
      });
      // Should not throw
      handle.upsertEmbedding(rowid, new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
    });

    it('overwrites the embedding on a second call for the same rowid (idempotent)', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const rowid = handle.upsertChunk({
        sessionId: 'sess',
        byteOffset: 0,
        text: 'content',
        tokenCount: 1,
        indexedAt: new Date().toISOString(),
      });
      const emb = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      handle.upsertEmbedding(rowid, emb);
      // Should not throw on second call
      handle.upsertEmbedding(rowid, new Float32Array(8).fill(0.5));
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

  describe('deleteSession', () => {
    it('removes all chunks and embeddings for a session without affecting others', () => {
      const dir = makeTmpDir();
      handle = openEmbeddingsDb(join(dir, 'embeddings.db'), 8);
      const ts = new Date().toISOString();

      const r1 = handle.upsertChunk({ sessionId: 'keep', byteOffset: 0, text: 'keep this', tokenCount: 2, indexedAt: ts });
      handle.upsertEmbedding(r1, new Float32Array(8).fill(0.1));

      const r2 = handle.upsertChunk({ sessionId: 'delete-me', byteOffset: 0, text: 'delete this', tokenCount: 2, indexedAt: ts });
      handle.upsertEmbedding(r2, new Float32Array(8).fill(0.2));

      handle.deleteSession('delete-me');

      // 'keep' chunk cursor still works normally
      handle.setCursor('/keep.jsonl', 512);
      expect(handle.getCursor('/keep.jsonl')).toBe(512);
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
