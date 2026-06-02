import { describe, expect, it, vi } from 'vitest';

import { buildMarkedExcerpt, fuseRankedRows, parseMarkedExcerpt, rankConversationSearch } from '../ranker.js';
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

    expect(embeddingProvider.embed).toHaveBeenCalledWith(['keyword']);
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
});
