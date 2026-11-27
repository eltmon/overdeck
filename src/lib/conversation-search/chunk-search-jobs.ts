/**
 * Conversation chunk-search jobs (PAN-5447).
 *
 * The dashboard DB worker runs these on the `conversation-text` and
 * `conversation-vector` lanes so the BM25 scan, the sqlite-vec brute-force KNN
 * scan, and the live-transcript filter never block the dashboard main thread.
 * Vitest runs the same functions inline.
 *
 * Each worker thread keeps one read handle to `embeddings.db`, keyed by
 * `dbPath` and embedding dimensions. Opening the DB loads sqlite-vec and checks
 * the schema, so reusing the handle keeps every job to its query alone. An
 * unavailable open is never cached: the next job retries the open.
 */
import { stat } from 'node:fs/promises';

import {
  dimensionsForModel,
  openEmbeddingsDb,
  type ChunkSearchOrder,
  type ChunkSearchRow,
  type EmbeddingsDbHandle,
} from '../overdeck/conversations-search.js';
import { sessionIdFromPath } from './transcript-paths.js';

export interface ChunkSearchDbRef {
  dbPath: string;
  model: string;
}

export type ChunkSearchJobResult<T> =
  | { available: true; value: T }
  | { available: false; reason: string };

let cached: { key: string; db: EmbeddingsDbHandle } | null = null;

/** The cached handle for `ref`, opening it on first use or on a key change. */
function openCached(ref: ChunkSearchDbRef): EmbeddingsDbHandle | { reason: string } {
  const dimensions = dimensionsForModel(ref.model);
  const key = `${ref.dbPath}\u0000${dimensions}`;
  if (cached?.key === key) return cached.db;
  closeChunkSearchHandles();
  const db = openEmbeddingsDb(ref.dbPath, dimensions);
  if (!db.available) {
    const reason = db.unavailableReason ?? 'embeddings DB unavailable';
    db.close();
    return { reason };
  }
  cached = { key, db };
  return db;
}

function unavailable(opened: EmbeddingsDbHandle | { reason: string }): opened is { reason: string } {
  return 'reason' in opened;
}

export function searchConversationBm25Job(
  input: ChunkSearchDbRef & { matchQuery: string; limit: number; order?: ChunkSearchOrder },
): ChunkSearchJobResult<ChunkSearchRow[]> {
  const db = openCached(input);
  if (unavailable(db)) return { available: false, reason: db.reason };
  return { available: true, value: db.searchBm25(input.matchQuery, input.limit, input.order) };
}

export function searchConversationVectorJob(
  input: ChunkSearchDbRef & { embedding: Float32Array; limit: number },
): ChunkSearchJobResult<ChunkSearchRow[]> {
  const db = openCached(input);
  if (unavailable(db)) return { available: false, reason: db.reason };
  return { available: true, value: db.searchVector(input.embedding, input.limit) };
}

/**
 * Keep the session ids whose transcript still exists on disk, in input order,
 * de-duplicated. Index pruning lags behind file deletion (and only runs on full
 * passes), so without this the palette can surface a session whose JSONL is
 * already gone — opening it 404s. Cursor paths are the absolute paths the
 * indexer wrote, so the stat is exact.
 */
export async function filterLiveConversationSessionsJob(
  input: ChunkSearchDbRef & { sessionIds: string[] },
): Promise<ChunkSearchJobResult<string[]>> {
  const db = openCached(input);
  if (unavailable(db)) return { available: false, reason: db.reason };

  const pathBySessionId = new Map<string, string>();
  for (const filePath of db.listFileCursors()) {
    pathBySessionId.set(sessionIdFromPath(filePath), filePath);
  }
  const uniqueIds = [...new Set(input.sessionIds)];
  const liveByPath = new Map<string, Promise<boolean>>();
  const live = await Promise.all(
    uniqueIds.map((sessionId) => {
      const filePath = pathBySessionId.get(sessionId);
      if (!filePath) return false;
      let pending = liveByPath.get(filePath);
      if (!pending) {
        pending = stat(filePath).then(() => true, () => false);
        liveByPath.set(filePath, pending);
      }
      return pending;
    }),
  );
  return { available: true, value: uniqueIds.filter((_, index) => live[index]) };
}

/** Close and forget the cached `embeddings.db` handle. */
export function closeChunkSearchHandles(): void {
  cached?.db.close();
  cached = null;
}
