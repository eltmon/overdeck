import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/dashboard/server/services/pi-conversation-parser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/dashboard/server/services/pi-conversation-parser.js')>();
  return {
    ...actual,
    parsePiConversationMessages: vi.fn(actual.parsePiConversationMessages),
  };
});

import {
  type DashboardDbOperation,
  runDashboardDbJob,
  workerLane,
} from '../../../src/dashboard/server/services/dashboard-db-task.js';
import { parsePiConversationMessages } from '../../../src/dashboard/server/services/pi-conversation-parser.js';
import { closeChunkSearchHandles } from '../../../src/lib/conversation-search/chunk-search-jobs.js';
import { dimensionsForModel, openEmbeddingsDb } from '../../../src/lib/overdeck/conversations-search.js';

const piFixture = new URL(
  '../../../src/dashboard/server/services/__tests__/pi-conversation-parser.fixture.jsonl',
  import.meta.url,
);

describe('dashboard database worker lanes', () => {
  it.each([
    'listSessionsFeed',
    'getSessionsFeedFacets',
    'getConversationByName',
    'getDiscoveredSessionById',
  ] satisfies DashboardDbOperation[])('routes interactive operation %s to read', operation => {
    expect(workerLane(operation)).toBe('read');
  });

  it.each([
    'scanConversations',
    'enrichSessions',
    'embedSessions',
    'costReconcileSweep',
  ] satisfies DashboardDbOperation[])('routes bulk operation %s to long', operation => {
    expect(workerLane(operation)).toBe('long');
  });

  it('routes semantic search to its dedicated lane', () => {
    expect(workerLane('searchSessionsSemantic')).toBe('semantic');
  });

  it('routes transcript parsing to its dedicated lane', () => {
    expect(workerLane('parseTranscriptSnapshot')).toBe('parse');
  });

  it('routes searchConversationVector to conversation-vector', () => {
    expect(workerLane('searchConversationVector')).toBe('conversation-vector');
  });

  it.each([
    'searchConversationBm25',
    'filterLiveConversationSessions',
  ] satisfies DashboardDbOperation[])('routes searchConversationBm25 and filterLiveConversationSessions to conversation-text (%s)', operation => {
    expect(workerLane(operation)).toBe('conversation-text');
  });

  it('dispatches transcript parsing through the job surface', async () => {
    const expected = await parsePiConversationMessages(piFixture.pathname);

    await expect(runDashboardDbJob('parseTranscriptSnapshot', {
      sessionFile: piFixture.pathname,
      parser: 'pi',
    })).resolves.toEqual(expected);
  });

  it('rejects unknown transcript parsers', async () => {
    await expect(runDashboardDbJob('parseTranscriptSnapshot', {
      sessionFile: piFixture.pathname,
      parser: 'unknown',
    })).rejects.toThrow('Unknown transcript parser: unknown');
  });

  it('coalesces concurrent parses with identical payloads', async () => {
    vi.mocked(parsePiConversationMessages).mockClear();
    const payload = { sessionFile: piFixture.pathname, parser: 'pi' };

    const [first, second] = await Promise.all([
      runDashboardDbJob('parseTranscriptSnapshot', payload),
      runDashboardDbJob('parseTranscriptSnapshot', payload),
    ]);

    expect(parsePiConversationMessages).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
  });

  it('runs searchConversationBm25 inline against a temp embeddings DB (PAN-5447)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-db-task-bm25-'));
    try {
      const model = 'text-embedding-3-small';
      const dbPath = join(dir, 'embeddings.db');
      const db = openEmbeddingsDb(dbPath, dimensionsForModel(model));
      expect(db.available).toBe(true);
      db.upsertChunk({
        sessionId: 'session-a',
        projectId: 'overdeck',
        role: 'assistant',
        byteOffset: 0,
        charLength: 32,
        text: 'The needle appears in this chunk.',
        tokenCount: 7,
        indexedAt: '2026-11-17T00:00:00.000Z',
      });
      db.close();

      const result = await runDashboardDbJob<{ available: boolean; value?: Array<{ sessionId: string }> }>(
        'searchConversationBm25',
        { dbPath, model, matchQuery: 'needle', limit: 5 },
      );

      expect(result.available).toBe(true);
      expect(result.value?.map((row) => row.sessionId)).toEqual(['session-a']);
    } finally {
      closeChunkSearchHandles();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
