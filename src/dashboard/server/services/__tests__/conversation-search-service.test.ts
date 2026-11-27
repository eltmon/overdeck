import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import type { ConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';
import type { RankedChunkRow } from '../../../../lib/conversation-search/ranker.js';

vi.mock('../dashboard-db-task.js', () => ({ runDashboardDbJob: vi.fn() }));
vi.mock('../../../../lib/config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/config-yaml.js')>()),
  getConversationSearchConfig: vi.fn(),
}));
vi.mock('../../../../lib/conversation-search/embedding-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/conversation-search/embedding-provider.js')>()),
  createConversationEmbeddingProvider: vi.fn(),
}));
vi.mock('../../../../lib/conversation-search/health.js', () => ({
  recordConversationSearchFailure: vi.fn(),
  recordConversationSearchSuccess: vi.fn(),
}));

import { getConversationSearchConfig } from '../../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';
import { recordConversationSearchFailure, recordConversationSearchSuccess } from '../../../../lib/conversation-search/health.js';
import {
  CHUNK_SCAN_DEADLINE_MS,
  closeConversationSearchService,
  LIVE_FILTER_DEADLINE_MS,
  searchConversationChunks,
} from '../conversation-search-service.js';
import { runDashboardDbJob } from '../dashboard-db-task.js';

const config: NormalizedConversationSearchConfig = {
  enabled: true,
  provider: 'openai',
  model: 'text-embedding-3-small',
  apiKeyRef: undefined,
  dbPath: '/home/test/.overdeck/conversation-search/embeddings.db',
};

function row(rowid: number, sessionId: string): RankedChunkRow {
  return {
    rowid,
    sessionId,
    projectId: 'overdeck',
    role: 'assistant',
    ts: '2026-11-17T00:00:00.000Z',
    byteOffset: rowid * 100,
    charLength: 20,
    text: `needle in ${sessionId}`,
  };
}

function provider(embed: ConversationEmbeddingProvider['embed']): ConversationEmbeddingProvider {
  return { provider: 'openai', model: config.model, enabled: true, estimateCost: vi.fn(), embed: vi.fn(embed) };
}

const okEmbed: ConversationEmbeddingProvider['embed'] = async () => ({ embeddings: [new Float32Array([1])], model: config.model });

type JobHandler = (payload: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<unknown>;

/** Answer jobs by operation; a missing handler means the job never settles until its signal aborts. */
function answerJobs(handlers: Partial<Record<string, JobHandler>>) {
  const signals: Record<string, AbortSignal | undefined> = {};
  vi.mocked(runDashboardDbJob).mockImplementation(((operation: string, payload: unknown, _progress: unknown, options?: { signal?: AbortSignal }) => {
    signals[operation] = options?.signal;
    const handler = handlers[operation];
    if (handler) return handler(payload as Record<string, unknown>, options?.signal);
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  }) as typeof runDashboardDbJob);
  return signals;
}

const liveAll: JobHandler = async (payload) => ({ available: true, value: payload['sessionIds'] });

describe('searchConversationChunks (PAN-5447)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider(okEmbed));
    vi.mocked(recordConversationSearchFailure).mockClear();
    vi.mocked(recordConversationSearchSuccess).mockClear();
    vi.mocked(runDashboardDbJob).mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    closeConversationSearchService();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends BM25 and vector legs to runDashboardDbJob with the request signal combined', async () => {
    const signals = answerJobs({
      searchConversationBm25: async () => ({ available: true, value: [row(1, 'session-a')] }),
      searchConversationVector: async () => ({ available: true, value: [row(2, 'session-b')] }),
      filterLiveConversationSessions: liveAll,
    });
    const request = new AbortController();

    const hits = await searchConversationChunks({ rawQuery: 'needle', matchQuery: '"needle"', limit: 5, signal: request.signal });

    expect(hits.map((hit) => hit.sessionId).sort()).toEqual(['session-a', 'session-b']);
    expect(runDashboardDbJob).toHaveBeenCalledWith(
      'searchConversationBm25',
      { dbPath: config.dbPath, model: config.model, matchQuery: '"needle"', limit: 50 },
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    expect(runDashboardDbJob).toHaveBeenCalledWith(
      'searchConversationVector',
      { dbPath: config.dbPath, model: config.model, embedding: new Float32Array([1]), limit: 50 },
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    // The leg signal is a combination, not the request signal itself, and it follows the request.
    const bm25Signal = signals['searchConversationBm25']!;
    expect(bm25Signal).not.toBe(request.signal);
    expect(bm25Signal.aborted).toBe(false);
    request.abort(new Error('late'));
    expect(bm25Signal.aborted).toBe(true);
    expect(recordConversationSearchSuccess).toHaveBeenCalledTimes(1);
  });

  it('a vector leg past CHUNK_SCAN_DEADLINE_MS returns BM25 hits and aborts the leg\'s job signal', async () => {
    const signals = answerJobs({
      searchConversationBm25: async () => ({ available: true, value: [row(1, 'session-a')] }),
      filterLiveConversationSessions: liveAll,
    });

    const search = searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5 });
    await vi.advanceTimersByTimeAsync(CHUNK_SCAN_DEADLINE_MS);
    const hits = await search;

    expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a']);
    expect(signals['searchConversationVector']?.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      `[conversation-search] searchConversationVector exceeded ${CHUNK_SCAN_DEADLINE_MS} ms; continuing without it`,
    );
    expect(recordConversationSearchFailure).not.toHaveBeenCalled();
  });

  it('an aborted request rejects with the abort reason and records no health outcome', async () => {
    answerJobs({ filterLiveConversationSessions: liveAll });
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider((_texts, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
    const request = new AbortController();
    const reason = new Error('client left');

    const search = searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5, signal: request.signal });
    await vi.advanceTimersByTimeAsync(10);
    request.abort(reason);

    await expect(search).rejects.toBe(reason);
    expect(recordConversationSearchFailure).not.toHaveBeenCalled();
    expect(recordConversationSearchSuccess).not.toHaveBeenCalled();
    expect(runDashboardDbJob).not.toHaveBeenCalledWith('searchConversationVector', expect.anything(), undefined, expect.anything());
    expect(console.error).not.toHaveBeenCalled();
  });

  it('an embedding failure records a failure and still returns BM25 hits', async () => {
    answerJobs({
      searchConversationBm25: async () => ({ available: true, value: [row(1, 'session-a')] }),
      filterLiveConversationSessions: liveAll,
    });
    const failure = new Error('insufficient_quota');
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider(async () => { throw failure; }));

    const hits = await searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5 });

    expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a']);
    expect(recordConversationSearchFailure).toHaveBeenCalledTimes(1);
    expect(recordConversationSearchFailure).toHaveBeenCalledWith(failure);
    expect(recordConversationSearchSuccess).not.toHaveBeenCalled();
  });

  it('a live-filter deadline returns the hits unfiltered', async () => {
    const signals = answerJobs({
      searchConversationBm25: async () => ({ available: true, value: [row(1, 'session-a'), row(2, 'session-b')] }),
      searchConversationVector: async () => ({ available: true, value: [] }),
    });

    const search = searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5 });
    await vi.advanceTimersByTimeAsync(LIVE_FILTER_DEADLINE_MS);
    const hits = await search;

    expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a', 'session-b']);
    expect(signals['filterLiveConversationSessions']?.aborted).toBe(true);
  });

  describe('sort: recent (PAN-5677)', () => {
    it('relevance mode (no sort) sends exactly one searchConversationBm25 call with no order key', async () => {
      answerJobs({
        searchConversationBm25: async () => ({ available: true, value: [row(1, 'session-a')] }),
        searchConversationVector: async () => ({ available: true, value: [] }),
        filterLiveConversationSessions: liveAll,
      });

      const hits = await searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5 });

      expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a']);
      const bm25Calls = vi.mocked(runDashboardDbJob).mock.calls.filter((call) => call[0] === 'searchConversationBm25');
      expect(bm25Calls).toHaveLength(1);
      expect(bm25Calls[0]?.[1]).not.toHaveProperty('order');
    });

    it('recent mode sends a second searchConversationBm25 call carrying order "recent" and returns the union', async () => {
      answerJobs({
        searchConversationBm25: async (payload) => payload['order'] === 'recent'
          ? { available: true, value: [row(2, 'session-recent')] }
          : { available: true, value: [row(1, 'session-a')] },
        searchConversationVector: async () => ({ available: true, value: [] }),
        filterLiveConversationSessions: liveAll,
      });

      const hits = await searchConversationChunks({
        rawQuery: 'needle',
        matchQuery: 'needle',
        limit: 5,
        candidateLimit: 50,
        sort: 'recent',
      });

      expect(hits.map((hit) => hit.sessionId).sort()).toEqual(['session-a', 'session-recent']);
      const bm25Calls = vi.mocked(runDashboardDbJob).mock.calls.filter((call) => call[0] === 'searchConversationBm25');
      expect(bm25Calls).toHaveLength(2);
      const recentCall = bm25Calls.find((call) => (call[1] as Record<string, unknown>)['order'] === 'recent');
      expect(recentCall?.[1]).toMatchObject({ matchQuery: 'needle', limit: 50, order: 'recent' });
    });

    it('a recency leg that never answers degrades to relevance hits past CHUNK_SCAN_DEADLINE_MS, recording no failure', async () => {
      answerJobs({
        searchConversationBm25: async (payload, signal) => {
          if (payload['order'] === 'recent') {
            return new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          }
          return { available: true, value: [row(1, 'session-a')] };
        },
        searchConversationVector: async () => ({ available: true, value: [] }),
        filterLiveConversationSessions: liveAll,
      });

      const search = searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5, sort: 'recent' });
      await vi.advanceTimersByTimeAsync(CHUNK_SCAN_DEADLINE_MS);
      const hits = await search;

      expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a']);
      expect(recordConversationSearchFailure).not.toHaveBeenCalled();
    });

    it('a recency leg that rejects returns the relevance hits, logs one console.warn, and records no failure', async () => {
      const failure = new Error('boom');
      answerJobs({
        searchConversationBm25: async (payload) => {
          if (payload['order'] === 'recent') throw failure;
          return { available: true, value: [row(1, 'session-a')] };
        },
        searchConversationVector: async () => ({ available: true, value: [] }),
        filterLiveConversationSessions: liveAll,
      });

      const hits = await searchConversationChunks({ rawQuery: 'needle', matchQuery: 'needle', limit: 5, sort: 'recent' });

      expect(hits.map((hit) => hit.sessionId)).toEqual(['session-a']);
      expect(recordConversationSearchFailure).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith('[conversation-search] recent leg failed; using relevance results only:', failure);
    });
  });
});
