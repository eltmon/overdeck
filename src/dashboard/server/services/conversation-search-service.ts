import { stat } from 'node:fs/promises';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider, type ConversationEmbeddingProvider } from '../../../lib/conversation-search/embedding-provider.js';
import { rankConversationSearch, type ConversationSearchHit } from '../../../lib/conversation-search/ranker.js';
import { sessionIdFromPath } from '../../../lib/conversation-search/indexer.js';
import { dimensionsForModel, openEmbeddingsDb, type EmbeddingsDbHandle } from '../../../lib/overdeck/conversations-search.js';

interface ConversationSearchServiceHandle {
  signature: string;
  db: EmbeddingsDbHandle;
  provider: ConversationEmbeddingProvider;
}

let activeHandle: ConversationSearchServiceHandle | null = null;

function signatureForConfig(config: NormalizedConversationSearchConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    apiKeyRef: config.apiKeyRef ?? null,
    dbPath: config.dbPath,
  });
}

function getHandle(config: NormalizedConversationSearchConfig): ConversationSearchServiceHandle | null {
  if (!config.enabled) {
    closeConversationSearchService();
    return null;
  }

  const signature = signatureForConfig(config);
  if (activeHandle?.signature === signature) return activeHandle;

  closeConversationSearchService();
  const provider = createConversationEmbeddingProvider({ config });
  if (!provider.enabled) return null;

  const db = openEmbeddingsDb(config.dbPath, dimensionsForModel(config.model));
  if (!db.available) {
    db.close();
    return null;
  }

  activeHandle = {
    signature,
    db,
    provider,
  };
  return activeHandle;
}

export function closeConversationSearchService(): void {
  activeHandle?.db.close();
  activeHandle = null;
}

export async function searchConversationChunks(input: {
  rawQuery: string;
  matchQuery: string;
  limit: number;
  config?: NormalizedConversationSearchConfig;
}): Promise<ConversationSearchHit[]> {
  const config = input.config ?? getConversationSearchConfigSync();
  const handle = getHandle(config);
  if (!handle) return [];

  return new Promise((resolve) => {
    setImmediate(() => {
      rankConversationSearch({
        query: input.rawQuery,
        limit: input.limit,
        store: {
          searchBm25: (_query, candidateLimit) => handle.db.searchBm25(input.matchQuery, candidateLimit),
          searchVector: (embedding, candidateLimit) => handle.db.searchVector(embedding, candidateLimit),
        },
        provider: handle.provider,
      })
        .then((hits) => filterLiveHits(handle.db, hits))
        .then(resolve, (error: unknown) => {
          console.error('[conversation-search] service search failed:', error);
          resolve([]);
        });
    });
  });
}

/**
 * Drop hits whose transcript no longer exists on disk. Index pruning lags behind
 * file deletion (and only runs on full passes), so without this the palette can
 * surface a session whose JSONL is already gone — opening it 404s. Cursor paths
 * are the absolute paths the indexer wrote, so the stat is exact.
 */
async function filterLiveHits(db: EmbeddingsDbHandle, hits: ConversationSearchHit[]): Promise<ConversationSearchHit[]> {
  if (hits.length === 0) return hits;
  const pathBySessionId = new Map<string, string>();
  for (const filePath of db.listFileCursors()) {
    pathBySessionId.set(sessionIdFromPath(filePath), filePath);
  }
  const live = await Promise.all(
    hits.map(async (hit) => {
      const filePath = pathBySessionId.get(hit.sessionId);
      if (!filePath) return false;
      return stat(filePath).then(() => true, () => false);
    }),
  );
  return hits.filter((_, index) => live[index]);
}
