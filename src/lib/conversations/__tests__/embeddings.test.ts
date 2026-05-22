import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect } from 'effect';

import { normalizeEmbedding } from '../embeddings/providers.js';
import { buildEmbeddingText, embedSessions } from '../embeddings/index.js';
import { upsertDiscoveredSession, findDiscoveredSessions, getEmbedding, updateEnrichment } from '../../database/discovered-sessions-db.js';
import type { EmbeddingResult } from '../embeddings/providers.js';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

function seedEnrichedSession(id: number) {
  upsertDiscoveredSession({
    jsonlPath: `/fake/${id}.jsonl`,
    workspacePath: `/home/user/Projects/proj${id}`,
    workspaceHash: `hash${id}`,
    messageCount: 5,
    firstTs: '2025-01-01T00:00:00Z',
    lastTs: '2025-01-01T01:00:00Z',
    modelsUsed: ['claude-sonnet-4-6'],
    primaryModel: 'claude-sonnet-4-6',
    tokenInput: 100,
    tokenOutput: 200,
    estimatedCost: 0.01,
    toolsUsed: ['Read', 'Edit'],
    filesTouched: [],
    panopticonManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: 1024,
    fileMtime: '2025-01-01T00:00:00Z',
    tags: ['feat', 'auth'],
  });
  // Enrich it so it qualifies for embedding
  const sessions = findDiscoveredSessions({});
  const session = sessions.find((s) => s.jsonlPath === `/fake/${id}.jsonl`);
  if (session) {
    updateEnrichment(session.id, {
      enrichmentLevel: 1,
      enrichmentModel: 'claude-haiku-4-5-20251001',
      summary: 'Fixed authentication bug.',
      tags: ['auth', 'bug-fix'],
    });
  }
  return sessions.find((s) => s.jsonlPath === `/fake/${id}.jsonl`);
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-embed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── normalizeEmbedding ───────────────────────────────────────────────────────

describe('normalizeEmbedding', () => {
  it('unit vector stays unit vector', () => {
    const v = normalizeEmbedding([1, 0, 0]);
    expect(v[0]).toBeCloseTo(1, 5);
    expect(v[1]).toBeCloseTo(0, 5);
  });

  it('normalizes non-unit vector to length 1', () => {
    const v = normalizeEmbedding([3, 4]); // length 5
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it('zero vector returns zero array', () => {
    const v = normalizeEmbedding([0, 0, 0]);
    expect(Array.from(v)).toEqual([0, 0, 0]);
  });
});

// ─── buildEmbeddingText ───────────────────────────────────────────────────────

describe('buildEmbeddingText', () => {
  it('includes summary and tags when available', () => {
    const session = {
      id: 1,
      jsonlPath: '/fake/1.jsonl',
      sessionId: null,
      workspacePath: '/home/user/Projects/myapp',
      workspaceHash: 'abc',
      messageCount: 5,
      firstTs: null,
      lastTs: null,
      modelsUsed: ['claude-sonnet-4-6'],
      primaryModel: 'claude-sonnet-4-6',
      tokenInput: 100,
      tokenOutput: 200,
      estimatedCost: 0.01,
      toolsUsed: ['Read'],
      filesTouched: [],
      tags: ['auth', 'bug-fix'],
      summary: 'Fixed auth bug.',
      summaryDetailed: null,
      enrichmentLevel: 1 as const,
      enrichmentModel: 'claude-haiku-4-5-20251001',
      enrichedAt: '2025-01-01T00:00:00Z',
      enrichmentFailed: false,
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: 1024,
      fileMtime: '2025-01-01T00:00:00Z',
      scannedAt: '2025-01-01T00:00:00Z',
    };

    const text = buildEmbeddingText(session);
    expect(text).toContain('Fixed auth bug.');
    expect(text).toContain('auth');
    expect(text).toContain('myapp');
    expect(text).toContain('Read');
  });

  it('returns non-empty text even without enrichment', () => {
    const session = {
      id: 2,
      jsonlPath: '/fake/2.jsonl',
      sessionId: null,
      workspacePath: '/home/user/Projects/beta',
      workspaceHash: 'def',
      messageCount: 2,
      firstTs: null,
      lastTs: null,
      modelsUsed: [],
      primaryModel: null,
      tokenInput: 0,
      tokenOutput: 0,
      estimatedCost: 0,
      toolsUsed: [],
      filesTouched: [],
      tags: [],
      summary: null,
      summaryDetailed: null,
      enrichmentLevel: 0 as const,
      enrichmentModel: null,
      enrichedAt: null,
      enrichmentFailed: false,
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: null,
      fileMtime: null,
      scannedAt: '2025-01-01T00:00:00Z',
    };

    const text = buildEmbeddingText(session);
    expect(text).toContain('beta');
  });
});

// ─── embedSessions ────────────────────────────────────────────────────────────

const mockEmbedFn = (_provider: unknown, opts: { text: string }): Effect.Effect<EmbeddingResult> => {
  const dim = 8;
  const values = Array.from({ length: dim }, (_, i) => (opts.text.length + i) / 1000);
  return Effect.succeed({
    embedding: new Float32Array(values),
    model: 'text-embedding-3-small',
  });
};

describe('embedSessions', () => {
  it('embeds enriched sessions and stores in DB', async () => {
    const session = seedEnrichedSession(1);
    expect(session).toBeDefined();

    const result = await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    expect(result.embedded).toBe(1);
    expect(result.errors).toBe(0);

    const sessions = findDiscoveredSessions({});
    const s = sessions.find((x) => x.jsonlPath === '/fake/1.jsonl');
    expect(s).toBeDefined();
    const emb = getEmbedding(s!.id, 'text-embedding-3-small');
    expect(emb).not.toBeNull();
    expect(emb!.length).toBe(8);
  });

  it('skips sessions already embedded', async () => {
    seedEnrichedSession(1);

    // Embed once
    await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    // Embed again — should skip
    const result2 = await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    expect(result2.embedded).toBe(0);
  });

  it('stores OpenAI text-embedding-3-small embeddings as 1536 dimensions', async () => {
    const session = seedEnrichedSession(1);
    const embedFn = (await Effect.runPromise(vi.fn((_provider: unknown, opts: { model: string }): Effect.Effect<EmbeddingResult> =>
      Effect.succeed({ embedding: new Float32Array(1536).fill(0.1), model: opts.model }),
    )));

    const result = await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: embedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    expect(result.embedded).toBe(1);
    (await Effect.runPromise(expect(embedFn))).toHaveBeenCalledWith('openai', expect.objectContaining({ model: 'text-embedding-3-small' }));
    expect(getEmbedding(session!.id, 'text-embedding-3-small')?.length).toBe(1536);
  });

  it('uses nomic-embed-text as the Ollama provider default', async () => {
    const session = seedEnrichedSession(1);
    const embedFn = (await Effect.runPromise(vi.fn((_provider: unknown, opts: { model: string }): Effect.Effect<EmbeddingResult> =>
      Effect.succeed({ embedding: new Float32Array(768).fill(0.1), model: opts.model }),
    )));

    const result = await embedSessions({
      provider: 'ollama',
      embedFn: embedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
      config: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'claude-code',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
        watchDirs: [],
        scanMaxParallel: null,
        embeddings: true,
        embeddingProvider: 'ollama',
        embeddingModel: 'text-embedding-3-small',
        embeddingAutoOnDeep: false,
        enrichment: { quickModel: null, deepModel: null, maxParallel: 1, costConfirmThreshold: 1 },
      },
    });

    expect(result.embedded).toBe(1);
    (await Effect.runPromise(expect(embedFn))).toHaveBeenCalledWith('ollama', expect.objectContaining({ model: 'nomic-embed-text' }));
    expect(getEmbedding(session!.id, 'nomic-embed-text')?.length).toBe(768);
  });

  it('stores Voyage voyage-code-3 embeddings as 1024 dimensions', async () => {
    const session = seedEnrichedSession(1);
    const embedFn = (await Effect.runPromise(vi.fn((_provider: unknown, opts: { model: string }): Effect.Effect<EmbeddingResult> =>
      Effect.succeed({ embedding: new Float32Array(1024).fill(0.1), model: opts.model }),
    )));

    const result = await embedSessions({
      provider: 'voyage',
      embedFn: embedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
      config: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'claude-code',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
        watchDirs: [],
        scanMaxParallel: null,
        embeddings: true,
        embeddingProvider: 'voyage',
        embeddingModel: 'voyage-code-3',
        embeddingAutoOnDeep: false,
        enrichment: { quickModel: null, deepModel: null, maxParallel: 1, costConfirmThreshold: 1 },
      },
    });

    expect(result.embedded).toBe(1);
    (await Effect.runPromise(expect(embedFn))).toHaveBeenCalledWith('voyage', expect.objectContaining({ model: 'voyage-code-3' }));
    expect(getEmbedding(session!.id, 'voyage-code-3')?.length).toBe(1024);
  });

  it('fires progress callbacks', async () => {
    seedEnrichedSession(1);
    seedEnrichedSession(2);

    const progressCalls: unknown[] = [];
    await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 2,
      onProgress: (p) => progressCalls.push(p),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
  });

  it('returns empty result when no sessions to embed', async () => {
    const result = await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
    });
    expect(result.embedded).toBe(0);
    expect(result.errors).toBe(0);
  });
});
