/** Search health stays live; corpus statistics refresh in the shared DB worker. */
import { getConversationSearchConfigSync } from '../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../lib/conversation-search/embedding-provider.js';
import { getConversationSearchHealth } from '../../../lib/conversation-search/health.js';
import { getConversationSearchStatsSnapshot } from './dashboard-poll-snapshots.js';

export async function getConversationSearchStatus() {
  const config = getConversationSearchConfigSync();
  // Runtime embed failures (exhausted credits, quota, network) are recorded
  // by the search service and watcher; surface them in every shape (PAN-3771).
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      unavailableReason: 'conversationSearch is disabled',
      dbPath: config.dbPath,
      chunkCount: 0,
      indexedFileCount: 0,
      lastIndexedAt: null,
      health: getConversationSearchHealth(),
    };
  }

  const provider = createConversationEmbeddingProvider({ config });
  if (!provider.enabled) {
    return {
      enabled: config.enabled,
      available: false,
      unavailableReason: provider.unavailableReason ?? 'embedding provider unavailable',
      dbPath: config.dbPath,
      chunkCount: 0,
      indexedFileCount: 0,
      lastIndexedAt: null,
      health: getConversationSearchHealth(),
    };
  }

  const stats = await getConversationSearchStatsSnapshot(config);
  return {
    enabled: config.enabled,
    dbPath: config.dbPath,
    ...stats,
    health: getConversationSearchHealth(),
  };
}
