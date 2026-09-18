import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, provider, stats } = vi.hoisted(() => ({
  config: vi.fn(), provider: vi.fn(), stats: vi.fn(),
}));
vi.mock('../../../../lib/config-yaml.js', () => ({ getConversationSearchConfigSync: config }));
vi.mock('../../../../lib/conversation-search/embedding-provider.js', () => ({ createConversationEmbeddingProvider: provider }));
vi.mock('../dashboard-poll-snapshots.js', () => ({ getConversationSearchStatsSnapshot: stats }));
import { getConversationSearchStatus } from '../conversation-search-status.js';
import {
  getConversationSearchHealth, recordConversationSearchFailure, recordConversationSearchSuccess,
  resetConversationSearchHealthForTests,
} from '../../../../lib/conversation-search/health.js';

const settings = { enabled: true, dbPath: '/fixture/search.db', model: 'text-embedding-3-small' };
const counters = { available: true, unavailableReason: undefined,
  chunkCount: 19, indexedFileCount: 3, lastIndexedAt: '2026-09-09T00:00:00.000Z' };

beforeEach(() => {
  vi.resetAllMocks();
  resetConversationSearchHealthForTests();
  config.mockReturnValue(settings);
  provider.mockReturnValue({ enabled: true });
  stats.mockResolvedValue(counters);
});

describe('conversation search status response no-loss audit', () => {
  it('preserves availability, database path, all counters and current runtime health', async () => {
    recordConversationSearchFailure('quota exhausted');
    expect(await getConversationSearchStatus()).toEqual({
      enabled: true, dbPath: settings.dbPath, ...counters, health: getConversationSearchHealth(),
    });
    recordConversationSearchSuccess();
    expect((await getConversationSearchStatus()).health).toEqual(getConversationSearchHealth());
    expect(stats).toHaveBeenCalledWith(settings);
  });

  it('immediately reports disabled configuration without reading corpus counters', async () => {
    config.mockReturnValue({ ...settings, enabled: false });
    recordConversationSearchFailure('last runtime error');
    expect(await getConversationSearchStatus()).toEqual({ enabled: false, available: false,
      unavailableReason: 'conversationSearch is disabled', dbPath: settings.dbPath,
      chunkCount: 0, indexedFileCount: 0, lastIndexedAt: null, health: getConversationSearchHealth() });
    expect(provider).not.toHaveBeenCalled();
    expect(stats).not.toHaveBeenCalled();
  });

  it.each(['missing key', undefined])('immediately reports provider failure (%s) and recovery', async reason => {
    provider.mockReturnValue({ enabled: false, unavailableReason: reason });
    expect(await getConversationSearchStatus()).toEqual({ enabled: true, available: false,
      unavailableReason: reason ?? 'embedding provider unavailable', dbPath: settings.dbPath,
      chunkCount: 0, indexedFileCount: 0, lastIndexedAt: null, health: getConversationSearchHealth() });
    expect(stats).not.toHaveBeenCalled();
    provider.mockReturnValue({ enabled: true });
    expect((await getConversationSearchStatus()).available).toBe(true);
  });

  it('preserves database unavailability and does not cache runtime errors across a worker wait', async () => {
    let finish!: (value: typeof counters) => void;
    stats.mockReturnValue(new Promise<typeof counters>(resolve => { finish = resolve; }));
    const pending = getConversationSearchStatus();
    recordConversationSearchFailure('network offline');
    finish({ ...counters, available: false });
    expect(await pending).toEqual({ enabled: true, dbPath: settings.dbPath,
      ...counters, available: false, health: getConversationSearchHealth() });
  });

  it('propagates worker failure to the existing HTTP error handler', async () => {
    stats.mockRejectedValue(new Error('worker unavailable'));
    await expect(getConversationSearchStatus()).rejects.toThrow('worker unavailable');
  });
});
