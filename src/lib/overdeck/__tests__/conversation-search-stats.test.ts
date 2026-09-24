import { beforeEach, describe, expect, it, vi } from 'vitest';

const { open, close, stats, dimensions } = vi.hoisted(() => ({
  open: vi.fn(), close: vi.fn(), stats: vi.fn(), dimensions: vi.fn(),
}));
vi.mock('../../database/conversation-embeddings-db.js', () => ({
  openEmbeddingsDb: open, dimensionsForModel: dimensions,
}));
import { getConversationSearchStats } from '../conversations-search.js';

beforeEach(() => {
  vi.resetAllMocks();
  dimensions.mockReturnValue(1536);
  open.mockReturnValue({ available: true, unavailableReason: undefined, getStats: stats, close });
});

describe('conversation search counters read door', () => {
  it('preserves all counters and availability and closes the database', () => {
    stats.mockReturnValue({ chunkCount: 100, indexedFileCount: 7, lastIndexedAt: '2026-09-09T00:00:00.000Z' });
    expect(getConversationSearchStats({ dbPath: '/fixture/search.db', model: 'small' })).toEqual({
      available: true, unavailableReason: undefined,
      chunkCount: 100, indexedFileCount: 7, lastIndexedAt: '2026-09-09T00:00:00.000Z',
    });
    expect(dimensions).toHaveBeenCalledWith('small');
    expect(open).toHaveBeenCalledWith('/fixture/search.db', 1536);
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains an unavailable database reason and zero counters', () => {
    open.mockReturnValue({ available: false, unavailableReason: 'vector extension missing', getStats: stats, close });
    stats.mockReturnValue({ chunkCount: 0, indexedFileCount: 0, lastIndexedAt: null });
    expect(getConversationSearchStats({ dbPath: '/fixture/search.db', model: 'small' })).toEqual({
      available: false, unavailableReason: 'vector extension missing',
      chunkCount: 0, indexedFileCount: 0, lastIndexedAt: null,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the database when the statistics query fails', () => {
    stats.mockImplementation(() => { throw new Error('database locked'); });
    expect(() => getConversationSearchStats({ dbPath: '/fixture/search.db', model: 'small' })).toThrow('database locked');
    expect(close).toHaveBeenCalledOnce();
  });
});
