import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { estimateFullReindexConversationSearchCost, fullReindexConversationSearch, indexConversationFile, indexConversationSearch } from '../indexer.js';
import type { ChunkInsert, EmbeddingsDbHandle } from '../../database/conversation-embeddings-db.js';
import type { ConversationEmbeddingProvider } from '../embedding-provider.js';
import type { NormalizedConversationSearchConfig } from '../../config-yaml.js';
import { encodeClaudeProjectDir } from '../../runtimes/storage/claude-code.js';
import { parentSessionIdFromPath } from '../transcript-paths.js';

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
    deleteSession: vi.fn((sessionId: string) => {
      for (let i = chunks.length - 1; i >= 0; i -= 1) {
        if (chunks[i]!.sessionId === sessionId) chunks.splice(i, 1);
      }
    }),
    listFileCursors: vi.fn(() => [...cursors.keys()]),
    deleteCursor: vi.fn((filePath: string) => { cursors.delete(filePath); }),
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
  vi.unstubAllEnvs();
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

  it('prunes chunks and cursors for sessions whose JSONL was deleted', async () => {
    const dir = makeTmpDir();
    const gonePath = join(dir, 'session-gone.jsonl');
    const keptPath = join(dir, 'session-kept.jsonl');
    writeFileSync(gonePath, line(message('user', 'soon deleted')));
    writeFileSync(keptPath, line(message('user', 'still here')));
    const db = fakeDb();
    const provider = fakeProvider();

    await indexConversationSearch({ config: config(), roots: [dir], db, provider });
    expect(db.chunks.map((chunk) => chunk.sessionId).sort()).toEqual(['session-gone', 'session-kept']);

    rmSync(gonePath);
    const result = await indexConversationSearch({ config: config(), roots: [dir], db, provider });

    expect(result.sessionsPruned).toBe(1);
    expect(db.deleteSession).toHaveBeenCalledWith('session-gone');
    expect(db.chunks.map((chunk) => chunk.sessionId)).toEqual(['session-kept']);
    expect(db.cursors.has(gonePath)).toBe(false);
    expect(db.cursors.has(keptPath)).toBe(true);
  });

  it('records the parent session id on subagent chunks (PAN-3982)', async () => {
    const dir = makeTmpDir();
    const parent = '3f2b1a4c-5d6e-4f70-8a91-b2c3d4e5f607';
    const projectDir = join(dir, 'projects', 'enc');
    mkdirSync(join(projectDir, parent, 'subagents'), { recursive: true });
    writeFileSync(join(projectDir, `${parent}.jsonl`), line(message('user', 'parent text')));
    writeFileSync(join(projectDir, parent, 'subagents', 'agent-abc123.jsonl'), line(message('user', 'subagent text')));
    const db = fakeDb();

    await indexConversationSearch({ config: config(), roots: [dir], db, provider: fakeProvider() });

    const byText = Object.fromEntries(db.chunks.map((chunk) => [chunk.text, chunk]));
    expect(byText['subagent text']).toMatchObject({ sessionId: 'agent-abc123', parentSessionId: parent });
    expect(byText['parent text']).toMatchObject({ sessionId: parent, parentSessionId: null });
  });

  it('never indexes background AI utility transcripts, and prunes ones already indexed', async () => {
    const dir = makeTmpDir();
    const overdeckHome = join(dir, 'overdeck-home');
    vi.stubEnv('OVERDECK_HOME', overdeckHome);
    const projects = join(dir, 'projects');
    const backgroundDir = join(projects, encodeClaudeProjectDir(join(overdeckHome, 'tmp', 'background-ai')));
    const realDir = join(projects, '-home-user-project');
    mkdirSync(backgroundDir, { recursive: true });
    mkdirSync(realDir, { recursive: true });
    const backgroundPath = join(backgroundDir, 'session-bg.jsonl');
    writeFileSync(backgroundPath, line(message('assistant', 'a generated conversation title')));
    writeFileSync(join(realDir, 'session-real.jsonl'), line(message('user', 'a real conversation')));
    const db = fakeDb();
    const provider = fakeProvider();

    // Seed the index as if the transcript had been indexed before the exclusion existed.
    db.upsertChunk({
      sessionId: 'session-bg',
      projectId: 'background',
      role: 'assistant',
      byteOffset: 0,
      charLength: 5,
      text: 'stale',
      tokenCount: 1,
      indexedAt: '2026-06-02T01:00:00.000Z',
    });
    db.setCursor(backgroundPath, 10);

    const result = await indexConversationSearch({ config: config(), roots: [projects], db, provider });

    expect(db.chunks.map((chunk) => chunk.sessionId)).toEqual(['session-real']);
    expect(db.cursors.has(backgroundPath)).toBe(false);
    expect(result.sessionsPruned).toBe(1);

    // The file watcher indexes new transcripts one at a time, bypassing the sweep.
    const direct = await indexConversationFile({ filePath: backgroundPath, config: config(), db, provider });
    expect(direct.chunksIndexed).toBe(0);
    expect(db.chunks.map((chunk) => chunk.sessionId)).toEqual(['session-real']);
  });

  it('skips a transcript deleted before indexing instead of reporting an error (PAN-3915)', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-gone.jsonl');
    writeFileSync(filePath, line(message('user', 'short-lived')));
    rmSync(filePath);
    const provider = fakeProvider();

    const result = await indexConversationFile({ filePath, config: config(), db: fakeDb(), provider });

    expect(result.errors).toEqual([]);
    expect(result.chunksSkipped).toBe(1);
    expect(provider.embed).not.toHaveBeenCalled();
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

  it('full reindex no-ops without touching cursors when conversation search is disabled', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-disabled-full.jsonl');
    writeFileSync(filePath, line(message('user', 'disabled full')));
    const db = fakeDb();
    const provider = fakeProvider();

    const result = await fullReindexConversationSearch({ config: config({ enabled: false }), roots: [dir], db, provider });

    expect(result.disabled).toBe(true);
    expect(db.cursors.size).toBe(0);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('does not advance the cursor past a trailing partial JSONL line', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-partial.jsonl');
    const complete = line(message('user', 'complete before partial'));
    writeFileSync(filePath, `${complete}{"type":"assistant"`);
    const db = fakeDb();
    const provider = fakeProvider();

    await indexConversationFile({ filePath, config: config(), db, provider });

    expect(db.getCursor(filePath)).toBe(Buffer.byteLength(complete, 'utf8'));
    appendFileSync(filePath, `,"timestamp":"2026-06-02T01:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"completed later"}]}}\n`);
    const result = await indexConversationFile({ filePath, config: config(), db, provider });

    expect(result.chunksIndexed).toBe(1);
    expect(db.chunks.map((chunk) => chunk.text)).toEqual(['complete before partial', 'completed later']);
  });

  it('embeds and persists large appends in bounded batches', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'session-batches.jsonl');
    writeFileSync(filePath, [0, 1, 2].map((i) => line(message('user', `batch ${i}`))).join(''));
    const db = fakeDb();
    const provider = fakeProvider();

    const result = await indexConversationFile({ filePath, config: config(), db, provider, batchSize: 2 });

    expect(result.chunksIndexed).toBe(3);
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(provider.embed).toHaveBeenNthCalledWith(1, ['batch 0', 'batch 1']);
    expect(provider.embed).toHaveBeenNthCalledWith(2, ['batch 2']);
    expect(db.getCursor(filePath)).toBe(Buffer.byteLength(readFileSync(filePath), 'utf8'));
  });

  it('estimates full reindex cost without embedding chunks', async () => {
    const dir = makeTmpDir();
    const projectDir = join(dir, 'projects', 'overdeck');
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

describe('parentSessionIdFromPath', () => {
  const parent = '3f2b1a4c-5d6e-4f70-8a91-b2c3d4e5f607';

  it('returns the parent uuid only for <uuid>/subagents/agent-*.jsonl', () => {
    expect(parentSessionIdFromPath(`/h/.claude/projects/enc/${parent}/subagents/agent-abc.jsonl`)).toBe(parent);
    expect(parentSessionIdFromPath(`/h/.claude/projects/enc/${parent}.jsonl`)).toBeNull();
    expect(parentSessionIdFromPath('/h/.claude/projects/enc/not-a-uuid/subagents/agent-abc.jsonl')).toBeNull();
    expect(parentSessionIdFromPath(`C:\\h\\.claude\\projects\\enc\\${parent}\\subagents\\agent-abc.jsonl`)).toBe(parent);
  });
});
