import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { estimateFullReindexConversationSearchCost, indexConversationFile } from '../indexer.js';
import type { ChunkInsert, EmbeddingsDbHandle } from '../../database/conversation-embeddings-db.js';
import type { ConversationEmbeddingProvider } from '../embedding-provider.js';
import type { NormalizedConversationSearchConfig } from '../../config-yaml.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-indexer-'));
  return tmpDir;
}

function line(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

function message(role: string, text: string): unknown {
  return { type: role, timestamp: '2026-06-02T01:00:00.000Z', message: { role, content: [{ type: 'text', text }] } };
}

function config(overrides: Partial<NormalizedConversationSearchConfig> = {}): NormalizedConversationSearchConfig {
  return { enabled: true, provider: 'openai', model: 'text-embedding-3-small', apiKeyRef: undefined, dbPath: '/tmp/embeddings.db', ...overrides };
}

function fakeDb(): EmbeddingsDbHandle & { chunks: ChunkInsert[]; cursors: Map<string, number> } {
  const cursors = new Map<string, number>();
  const chunks: ChunkInsert[] = [];
  return {
    available: true,
    dimensions: 2,
    chunks,
    cursors,
    upsertChunk(chunk) {
      const existing = chunks.findIndex((row) => row.sessionId === chunk.sessionId && row.byteOffset === chunk.byteOffset);
      if (existing >= 0) chunks[existing] = chunk;
      else chunks.push(chunk);
      return existing >= 0 ? existing + 1 : chunks.length;
    },
    upsertEmbedding: vi.fn(),
    getCursor: (filePath) => cursors.get(filePath) ?? 0,
    setCursor: (filePath, byteOffset) => { cursors.set(filePath, byteOffset); },
    searchBm25: vi.fn(),
    searchVector: vi.fn(),
    getStats: vi.fn(() => ({ chunkCount: chunks.length, indexedFileCount: cursors.size, lastIndexedAt: null })),
    deleteSession: vi.fn(),
    close: vi.fn(),
  };
}

function fakeProvider(): ConversationEmbeddingProvider {
  return {
    provider: 'openai',
    model: 'text-embedding-3-small',
    enabled: true,
    estimateCost: vi.fn(),
    embed: vi.fn(async (texts: string[]) => ({ embeddings: texts.map(() => new Float32Array([0.1, 0.2])), model: 'text-embedding-3-small' })),
  };
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('conversation search indexer', () => {
  it('chunks, embeds, upserts, and advances the file cursor', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-a.jsonl');
    writeFileSync(filePath, line(message('user', 'hello indexer')) + line(message('assistant', 'indexed reply')));
    const db = fakeDb();
    const provider = fakeProvider();

    const result = await indexConversationFile({ filePath, config: config(), db, provider, now: () => '2026-06-02T01:00:00.000Z' });

    expect(result).toMatchObject({ filesScanned: 1, filesIndexed: 1, chunksIndexed: 2, disabled: false });
    expect(provider.embed).toHaveBeenCalledWith(['hello indexer', 'indexed reply']);
    expect(db.chunks.map((chunk) => chunk.text)).toEqual(['hello indexer', 'indexed reply']);
    expect(db.getCursor(filePath)).toBeGreaterThan(0);
  });

  it('indexes only bytes after the stored cursor on append', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-b.jsonl');
    const first = line(message('user', 'first'));
    writeFileSync(filePath, first);
    const db = fakeDb();
    const provider = fakeProvider();

    await indexConversationFile({ filePath, config: config(), db, provider });
    appendFileSync(filePath, line(message('assistant', 'second')));

    const result = await indexConversationFile({ filePath, config: config(), db, provider });

    expect(result.chunksIndexed).toBe(1);
    expect(db.chunks.map((chunk) => chunk.text)).toEqual(['first', 'second']);
  });

  it('no-ops when conversation search is disabled', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-c.jsonl');
    writeFileSync(filePath, line(message('user', 'disabled')));
    const provider = fakeProvider();

    const result = await indexConversationFile({ filePath, config: config({ enabled: false }), db: fakeDb(), provider });

    expect(result.disabled).toBe(true);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('estimates full reindex cost without embedding chunks', async () => {
    const dir = makeTmpDir();
    const projectDir = join(dir, 'projects', 'panopticon-cli');
    const filePath = join(projectDir, 'session-d.jsonl');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(filePath, line(message('assistant', 'cost estimate text')));
    const provider = fakeProvider();
    vi.mocked(provider.estimateCost).mockReturnValue({
      provider: 'openai',
      model: 'text-embedding-3-small',
      tokenCount: 4,
      pricePerMillionTokens: 0.02,
      estimatedUsd: 0.00000008,
    });

    const estimate = await estimateFullReindexConversationSearchCost({ config: config(), roots: [join(dir, 'projects')], provider });

    expect(provider.embed).not.toHaveBeenCalled();
    expect(provider.estimateCost).toHaveBeenCalledWith(['cost estimate text']);
    expect(estimate).toMatchObject({ filesScanned: 1, chunksEstimated: 1, disabled: false, estimatedUsd: 0.00000008 });
  });
});
