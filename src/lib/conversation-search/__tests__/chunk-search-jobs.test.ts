import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../config-yaml.js';
import type { ConversationEmbeddingProvider } from '../embedding-provider.js';

vi.mock('../../overdeck/conversations-search.js', async () => {
  const actual = await vi.importActual<typeof import('../../overdeck/conversations-search.js')>('../../overdeck/conversations-search.js');
  return { ...actual, openEmbeddingsDb: vi.fn(actual.openEmbeddingsDb) };
});

import { dimensionsForModel, openEmbeddingsDb } from '../../overdeck/conversations-search.js';
import {
  closeChunkSearchHandles,
  filterLiveConversationSessionsJob,
  searchConversationBm25Job,
  searchConversationVectorJob,
} from '../chunk-search-jobs.js';
import { indexConversationFile } from '../indexer.js';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = dimensionsForModel(MODEL);

let tmpDir: string;

function makeVector(): Float32Array {
  const vector = new Float32Array(DIMENSIONS);
  vector[0] = 1;
  return vector;
}

function fakeProvider(): ConversationEmbeddingProvider {
  return {
    provider: 'openai',
    model: MODEL,
    enabled: true,
    estimateCost: vi.fn(),
    embed: vi.fn(async (texts: string[]) => ({ embeddings: texts.map(() => makeVector()), model: MODEL })),
  };
}

function jsonlMessage(text: string, timestamp = '2026-06-02T01:00:00.000Z'): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })}\n`;
}

async function indexSessions(dbPath: string, sessionIds: string[]): Promise<string[]> {
  const projectDir = join(tmpDir, 'projects', 'overdeck');
  mkdirSync(projectDir, { recursive: true });
  const config: NormalizedConversationSearchConfig = { enabled: true, provider: 'openai', model: MODEL, apiKeyRef: undefined, dbPath };
  const db = openEmbeddingsDb(dbPath, DIMENSIONS);
  expect(db.available).toBe(true);
  const provider = fakeProvider();
  const files: string[] = [];
  for (const sessionId of sessionIds) {
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(filePath, jsonlMessage(`The needle appears in ${sessionId}.`));
    await indexConversationFile({ filePath, config, db, provider, now: () => '2026-06-02T01:01:00.000Z' });
    files.push(filePath);
  }
  db.close();
  vi.mocked(openEmbeddingsDb).mockClear();
  return files;
}

describe('chunk-search jobs', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-chunk-search-jobs-'));
    vi.mocked(openEmbeddingsDb).mockClear();
  });

  afterEach(() => {
    closeChunkSearchHandles();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reuses one handle across BM25 and vector jobs for the same dbPath/model', async () => {
    const dbPath = join(tmpDir, 'embeddings.db');
    await indexSessions(dbPath, ['session-a']);

    const bm25 = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });
    const vector = searchConversationVectorJob({ dbPath, model: MODEL, embedding: makeVector(), limit: 5 });

    expect(bm25).toMatchObject({ available: true });
    expect(vector).toMatchObject({ available: true });
    expect(bm25.available && bm25.value.map((row) => row.sessionId)).toEqual(['session-a']);
    expect(vector.available && vector.value.map((row) => row.sessionId)).toEqual(['session-a']);
    expect(openEmbeddingsDb).toHaveBeenCalledTimes(1);
  });

  it('forwards order: recent to searchBm25; omitting order keeps relevance order (PAN-5677)', async () => {
    const dbPath = join(tmpDir, 'embeddings.db');
    const db = openEmbeddingsDb(dbPath, DIMENSIONS);
    expect(db.available).toBe(true);
    const projectDir = join(tmpDir, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const config: NormalizedConversationSearchConfig = { enabled: true, provider: 'openai', model: MODEL, apiKeyRef: undefined, dbPath };
    const provider = fakeProvider();
    const sessions: Array<[sessionId: string, ts: string, text: string]> = [
      ['session-old', '2026-01-01T00:00:00.000Z', 'needle needle needle strongest match'],
      ['session-new', '2026-06-01T00:00:00.000Z', 'a single needle mention'],
    ];
    for (const [sessionId, ts, text] of sessions) {
      const filePath = join(projectDir, `${sessionId}.jsonl`);
      writeFileSync(filePath, jsonlMessage(text, ts));
      await indexConversationFile({ filePath, config, db, provider, now: () => '2026-06-02T01:01:00.000Z' });
    }
    db.close();
    vi.mocked(openEmbeddingsDb).mockClear();

    const relevance = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });
    expect(relevance.available && relevance.value[0]?.sessionId).toBe('session-old');

    const recent = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5, order: 'recent' });
    expect(recent.available && recent.value[0]?.sessionId).toBe('session-new');
  });

  it('returns available:false with the reason when the DB cannot open', () => {
    const blocker = join(tmpDir, 'not-a-dir');
    writeFileSync(blocker, 'regular file');
    const dbPath = join(blocker, 'nested', 'embeddings.db');

    const first = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });
    const second = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });

    expect(first.available).toBe(false);
    expect(!first.available && first.reason.length).toBeGreaterThan(0);
    expect(second.available).toBe(false);
    // Nothing cached: the second job retried the open.
    expect(openEmbeddingsDb).toHaveBeenCalledTimes(2);
  });

  it('filterLiveConversationSessionsJob drops sessions whose transcript is gone', async () => {
    const dbPath = join(tmpDir, 'embeddings.db');
    const [, goneFile] = await indexSessions(dbPath, ['session-a', 'session-gone', 'session-c']);
    rmSync(goneFile!);

    const result = await filterLiveConversationSessionsJob({
      dbPath,
      model: MODEL,
      sessionIds: ['session-c', 'session-gone', 'session-a', 'session-c', 'session-unknown'],
    });

    expect(result).toEqual({ available: true, value: ['session-c', 'session-a'] });
  });

  it('closeChunkSearchHandles closes the cached handle', async () => {
    const dbPath = join(tmpDir, 'embeddings.db');
    await indexSessions(dbPath, ['session-a']);

    searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });
    closeChunkSearchHandles();
    const after = searchConversationBm25Job({ dbPath, model: MODEL, matchQuery: 'needle', limit: 5 });

    expect(after).toMatchObject({ available: true });
    expect(openEmbeddingsDb).toHaveBeenCalledTimes(2);
  });
});
