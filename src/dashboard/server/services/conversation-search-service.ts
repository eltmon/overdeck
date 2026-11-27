/**
 * Palette conversation chunk search (PAN-5447).
 *
 * The BM25 scan, the sqlite-vec vector scan and the live-transcript filter run
 * on the dashboard DB worker's serial `conversation-text` and
 * `conversation-vector` lanes, never on the main thread. The query embedding
 * stays here (async network I/O) and runs alongside BM25. Every slow leg has a
 * deadline counted from submission; a leg that misses it contributes nothing
 * and the search returns what the other legs found. The request signal aborts
 * the whole search: waiting jobs are dropped and no health outcome is recorded.
 */
import { getConversationSearchConfig, type NormalizedConversationSearchConfig } from '../../../lib/config-yaml.js';
import { closeChunkSearchHandles, type ChunkSearchJobResult } from '../../../lib/conversation-search/chunk-search-jobs.js';
import { createConversationEmbeddingProvider, type ConversationEmbeddingProvider } from '../../../lib/conversation-search/embedding-provider.js';
import type { ConversationSearchSort } from '../../../lib/conversation-search/group-hits.js';
import { recordConversationSearchFailure, recordConversationSearchSuccess } from '../../../lib/conversation-search/health.js';
import { appendRecentRows, rankConversationSearch, type ConversationSearchHit, type RankedChunkRow } from '../../../lib/conversation-search/ranker.js';
import { runDashboardDbJob, type DashboardDbOperation } from './dashboard-db-task.js';

/** Budget for each BM25 / vector leg, counted from submission so queue wait counts. */
export const CHUNK_SCAN_DEADLINE_MS = 4_000;
/** Budget for the live-transcript filter; on a miss the hits are returned unfiltered. */
export const LIVE_FILTER_DEADLINE_MS = 2_000;

interface ConversationSearchServiceHandle {
  signature: string;
  provider: ConversationEmbeddingProvider;
}

let activeHandle: ConversationSearchServiceHandle | null = null;

class ChunkLegDeadlineError extends Error {
  constructor(readonly operation: DashboardDbOperation, readonly deadlineMs: number) {
    super(`${operation} exceeded ${deadlineMs} ms`);
    this.name = 'ChunkLegDeadlineError';
  }
}

/** Marker: the embeddings DB cannot open; the search returns [] and records nothing. */
class EmbeddingsDbUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'EmbeddingsDbUnavailable';
  }
}

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

  activeHandle = { signature, provider };
  return activeHandle;
}

export function closeConversationSearchService(): void {
  activeHandle = null;
  // Closes the Vitest inline cache; production worker handles die with the process.
  closeChunkSearchHandles();
}

/**
 * Run one leg on the DB worker under a deadline. Returns `{ deadline: true }`
 * when the deadline fires first; rethrows everything else, including the
 * request signal's abort reason.
 */
async function runLeg<T>(
  operation: DashboardDbOperation,
  payload: unknown,
  deadlineMs: number,
  signal: AbortSignal | undefined,
): Promise<ChunkSearchJobResult<T> | { deadline: true }> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new ChunkLegDeadlineError(operation, deadlineMs)), deadlineMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    return await runDashboardDbJob<ChunkSearchJobResult<T>>(operation, payload, undefined, { signal: combined });
  } catch (error) {
    if (error instanceof ChunkLegDeadlineError && !signal?.aborted) {
      console.warn(`[conversation-search] ${operation} exceeded ${deadlineMs} ms; continuing without it`);
      return { deadline: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runScanLeg(
  operation: 'searchConversationBm25' | 'searchConversationVector',
  payload: unknown,
  signal: AbortSignal | undefined,
): Promise<RankedChunkRow[]> {
  const result = await runLeg<RankedChunkRow[]>(operation, payload, CHUNK_SCAN_DEADLINE_MS, signal);
  if ('deadline' in result) return [];
  if (!result.available) throw new EmbeddingsDbUnavailable(result.reason);
  return result.value;
}

/** Keep hits whose transcript still exists; on a deadline keep them all. */
async function filterLiveHits(
  config: NormalizedConversationSearchConfig,
  hits: ConversationSearchHit[],
  signal: AbortSignal | undefined,
): Promise<ConversationSearchHit[]> {
  if (hits.length === 0) return hits;
  const sessionIds = [...new Set(hits.map((hit) => hit.sessionId))];
  const result = await runLeg<string[]>(
    'filterLiveConversationSessions',
    { dbPath: config.dbPath, model: config.model, sessionIds },
    LIVE_FILTER_DEADLINE_MS,
    signal,
  );
  if ('deadline' in result) return hits;
  if (!result.available) throw new EmbeddingsDbUnavailable(result.reason);
  const live = new Set(result.value);
  return hits.filter((hit) => live.has(hit.sessionId));
}

export async function searchConversationChunks(input: {
  rawQuery: string;
  matchQuery: string;
  limit: number;
  candidateLimit?: number;
  config?: NormalizedConversationSearchConfig;
  signal?: AbortSignal;
  sort?: ConversationSearchSort;
}): Promise<ConversationSearchHit[]> {
  const { signal } = input;
  signal?.throwIfAborted();
  const config = input.config ?? getConversationSearchConfig();
  const handle = getHandle(config);
  if (!handle) return [];
  const dbRef = { dbPath: config.dbPath, model: config.model };

  try {
    // The relevance scan's own `store.searchBm25` call is itself deferred by
    // one microtask inside rankConversationSearch (`Promise.resolve().then(...)`).
    // Calling rankConversationSearch first, then deferring the recent leg's
    // runScanLeg call by one more microtask, puts the relevance BM25 job on
    // the shared `conversation-text` lane ahead of the best-effort recent
    // job — the recent scan must never consume the relevance scan's deadline
    // budget by queueing in front of it (PAN-5677; CodeRabbit PR #5678,
    // thread 4720777472). The recent leg is still caught at creation (H2): a
    // relevance-path failure must not leave it unobserved.
    const searchPromise = rankConversationSearch({
      query: input.rawQuery,
      limit: input.limit,
      candidateLimit: input.candidateLimit,
      store: {
        searchBm25: (_query, candidateLimit) => runScanLeg(
          'searchConversationBm25',
          { ...dbRef, matchQuery: input.matchQuery, limit: candidateLimit },
          signal,
        ),
        searchVector: (embedding, candidateLimit) => runScanLeg(
          'searchConversationVector',
          { ...dbRef, embedding, limit: candidateLimit },
          signal,
        ),
      },
      provider: handle.provider,
      signal,
      // PAN-3771: a failed query embedding must not read as "no results"; the
      // banner shows the reason while BM25 + title rows still return.
      onEmbedFailure: recordConversationSearchFailure,
      onEmbedSuccess: recordConversationSearchSuccess,
    });

    const recentLeg: Promise<RankedChunkRow[]> = input.sort === 'recent'
      ? Promise.resolve().then(() => runScanLeg(
          'searchConversationBm25',
          { ...dbRef, matchQuery: input.matchQuery, limit: input.candidateLimit ?? input.limit, order: 'recent' },
          signal,
        )).catch((error: unknown) => {
          if (!signal?.aborted) console.warn('[conversation-search] recent leg failed; using relevance results only:', error);
          return [];
        })
      : Promise.resolve([]);

    const hits = await searchPromise;
    const pool = input.sort === 'recent'
      ? appendRecentRows({ hits, recentRows: await recentLeg, query: input.rawQuery })
      : hits;
    return await filterLiveHits(config, pool, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof EmbeddingsDbUnavailable) return [];
    // PAN-3771: record any other failure so the dashboard banner can surface it.
    recordConversationSearchFailure(error);
    console.error('[conversation-search] service search failed:', error);
    return [];
  }
}
