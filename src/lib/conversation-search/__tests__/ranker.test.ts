import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendRecentRows,
  buildMarkedExcerpt,
  ConversationQueryEmbedTimeoutError,
  DEFAULT_EMBED_TIMEOUT_MS,
  fuseRankedRows,
  parseMarkedExcerpt,
  rankConversationSearch,
} from '../ranker.js';
import type { RankedChunkRow } from '../ranker.js';
import type { ConversationEmbeddingProvider } from '../embedding-provider.js';

function row(rowid: number, text = `chunk ${rowid}`): RankedChunkRow {
  return {
    rowid,
    sessionId: 'sess',
    projectId: 'project',
    role: 'assistant',
    ts: '2026-06-02T01:00:00.000Z',
    byteOffset: rowid * 100,
    charLength: text.length,
    text,
  };
}

function provider(): ConversationEmbeddingProvider {
  return {
    provider: 'openai',
    model: 'text-embedding-3-small',
    enabled: true,
    estimateCost: vi.fn(),
    embed: vi.fn(async () => ({ embeddings: [new Float32Array([0.1, 0.2])], model: 'text-embedding-3-small' })),
  };
}

describe('conversation ranker', () => {
  it('fuses BM25 and vector ranks with reciprocal rank fusion', () => {
    const hits = fuseRankedRows({
      query: 'alpha',
      bm25Rows: [row(1), row(2), row(3)],
      vectorRows: [row(3), row(2), row(4)],
      rrfK: 1,
      limit: 4,
    });

    expect(hits.map((hit) => hit.rowid)).toEqual([3, 2, 1, 4]);
    expect(hits.map((hit) => hit.rank)).toEqual([1, 2, 3, 4]);
  });

  it('embeds the query and searches both BM25 and vector stores', async () => {
    const embeddingProvider = provider();
    const store = {
      searchBm25: vi.fn(() => [row(1, 'exact keyword')]),
      searchVector: vi.fn(() => [row(2, 'semantic neighbor')]),
    };

    const hits = await rankConversationSearch({ query: 'keyword', store, provider: embeddingProvider, limit: 2 });

    expect(embeddingProvider.embed).toHaveBeenCalledWith(['keyword'], { signal: expect.any(AbortSignal) });
    expect(store.searchBm25).toHaveBeenCalledWith('keyword', 50);
    expect(store.searchVector).toHaveBeenCalledWith(new Float32Array([0.1, 0.2]), 50);
    expect(hits).toHaveLength(2);
  });

  it('builds marked excerpts and match segments using ⦇…⦈ markers', () => {
    const excerpt = buildMarkedExcerpt('before keyword after', 'keyword');

    expect(excerpt).toBe('before ⦇keyword⦈ after');
    expect(parseMarkedExcerpt(excerpt)).toEqual([
      { text: 'before ', match: false },
      { text: 'keyword', match: true },
      { text: ' after', match: false },
    ]);
  });

  it('returns fused search hits with excerpt match flags', async () => {
    const store = {
      searchBm25: vi.fn(() => [row(10, 'alpha exact match'), row(20, 'semantic alpha neighbor')]),
      searchVector: vi.fn(() => [row(20, 'semantic alpha neighbor'), row(30, 'distant alpha')]),
    };

    const hits = await rankConversationSearch({ query: 'alpha', store, provider: provider(), limit: 3, rrfK: 1 });

    expect(hits.map((hit) => hit.rowid)).toEqual([20, 10, 30]);
    expect(hits[0]?.excerptSegments).toContainEqual({ text: 'alpha', match: true });
    expect(hits[1]?.excerpt).toBe('⦇alpha⦈ exact match');
  });

  describe('query embedding (PAN-5447)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function pendingProvider(): { provider: ConversationEmbeddingProvider; resolve: () => void; signals: AbortSignal[] } {
      let release!: () => void;
      const signals: AbortSignal[] = [];
      const embeddingProvider: ConversationEmbeddingProvider = {
        ...provider(),
        embed: vi.fn((_texts: string[], options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
          if (options?.signal) signals.push(options.signal);
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason ?? new Error('aborted')), { once: true });
          release = () => resolve({ embeddings: [new Float32Array([0.1, 0.2])], model: 'text-embedding-3-small' });
        })),
      };
      return { provider: embeddingProvider, resolve: () => release(), signals };
    }

    it('starts BM25 before the embedding resolves', async () => {
      const pending = pendingProvider();
      const store = {
        searchBm25: vi.fn(() => [row(1, 'keyword')]),
        searchVector: vi.fn(() => [row(2, 'keyword neighbor')]),
      };

      const search = rankConversationSearch({ query: 'keyword', store, provider: pending.provider });
      await Promise.resolve();
      await Promise.resolve();

      expect(store.searchBm25).toHaveBeenCalledWith('keyword', 50);
      expect(store.searchVector).not.toHaveBeenCalled();
      pending.resolve();
      await expect(search).resolves.toHaveLength(2);
      expect(store.searchVector).toHaveBeenCalledTimes(1);
    });

    it('returns BM25 hits and reports onEmbedFailure when the embedding rejects', async () => {
      const failure = new Error('insufficient_quota');
      const embeddingProvider: ConversationEmbeddingProvider = { ...provider(), embed: vi.fn(async () => { throw failure; }) };
      const store = { searchBm25: vi.fn(() => [row(1, 'keyword')]), searchVector: vi.fn(() => []) };
      const onEmbedFailure = vi.fn();
      const onEmbedSuccess = vi.fn();

      const hits = await rankConversationSearch({ query: 'keyword', store, provider: embeddingProvider, onEmbedFailure, onEmbedSuccess });

      expect(hits.map((hit) => hit.rowid)).toEqual([1]);
      expect(onEmbedFailure).toHaveBeenCalledWith(failure);
      expect(onEmbedSuccess).not.toHaveBeenCalled();
      expect(store.searchVector).not.toHaveBeenCalled();
    });

    it('times out the embedding after embedTimeoutMs, returns BM25 hits, and reports a ConversationQueryEmbedTimeoutError', async () => {
      vi.useFakeTimers();
      const pending = pendingProvider();
      const store = { searchBm25: vi.fn(() => [row(1, 'keyword')]), searchVector: vi.fn(() => []) };
      const onEmbedFailure = vi.fn();

      const search = rankConversationSearch({ query: 'keyword', store, provider: pending.provider, onEmbedFailure });
      await vi.advanceTimersByTimeAsync(DEFAULT_EMBED_TIMEOUT_MS);
      const hits = await search;

      expect(hits.map((hit) => hit.rowid)).toEqual([1]);
      expect(pending.signals[0]?.aborted).toBe(true);
      expect(onEmbedFailure).toHaveBeenCalledTimes(1);
      const error = onEmbedFailure.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(ConversationQueryEmbedTimeoutError);
      expect((error as ConversationQueryEmbedTimeoutError).timeoutMs).toBe(DEFAULT_EMBED_TIMEOUT_MS);
      expect(store.searchVector).not.toHaveBeenCalled();
    });

    it('rejects with the abort reason and never calls searchVector when the signal aborts during the embedding', async () => {
      const pending = pendingProvider();
      const store = { searchBm25: vi.fn(() => [row(1, 'keyword')]), searchVector: vi.fn(() => []) };
      const controller = new AbortController();
      const reason = new Error('client left');
      const onEmbedFailure = vi.fn();
      const onEmbedSuccess = vi.fn();

      const search = rankConversationSearch({ query: 'keyword', store, provider: pending.provider, signal: controller.signal, onEmbedFailure, onEmbedSuccess });
      await Promise.resolve();
      controller.abort(reason);

      await expect(search).rejects.toBe(reason);
      expect(pending.signals[0]?.aborted).toBe(true);
      expect(store.searchVector).not.toHaveBeenCalled();
      expect(onEmbedFailure).not.toHaveBeenCalled();
      expect(onEmbedSuccess).not.toHaveBeenCalled();
    });
  });
});

describe('appendRecentRows (PAN-5677)', () => {
  it('drops recentRows whose rowid is already in hits', () => {
    const hits = fuseRankedRows({ query: 'needle', bm25Rows: [row(1, 'needle one')], vectorRows: [], limit: 1 });

    const out = appendRecentRows({ hits, recentRows: [row(1, 'needle one')], query: 'needle' });

    expect(out.map((hit) => hit.rowid)).toEqual([1]);
  });

  it('returns relevance hits unchanged and first, appended rows with rrfScore 0 and consecutive ranks after them', () => {
    const hits = fuseRankedRows({ query: 'needle', bm25Rows: [row(1, 'needle one')], vectorRows: [], limit: 1 });

    const out = appendRecentRows({ hits, recentRows: [row(2, 'needle two'), row(3, 'needle three')], query: 'needle' });

    expect(out[0]).toEqual(hits[0]);
    expect(out.map((hit) => hit.rowid)).toEqual([1, 2, 3]);
    expect(out.map((hit) => hit.rank)).toEqual([1, 2, 3]);
    expect(out[1]?.rrfScore).toBe(0);
    expect(out[2]?.rrfScore).toBe(0);
    expect(out[1]?.excerptSegments.some((segment) => segment.match)).toBe(true);
  });

  it('appends a duplicate inside recentRows itself only once', () => {
    const hits = fuseRankedRows({ query: 'needle', bm25Rows: [row(1, 'needle one')], vectorRows: [], limit: 1 });

    const out = appendRecentRows({ hits, recentRows: [row(2, 'needle two'), row(2, 'needle two again')], query: 'needle' });

    expect(out.map((hit) => hit.rowid)).toEqual([1, 2]);
  });
});
