import type { ConversationEmbeddingProvider } from './embedding-provider.js';

export interface RankedChunkRow {
  rowid: number;
  sessionId: string;
  projectId: string;
  /** Parent session UUID when the chunk came from a Claude subagent transcript (PAN-3982). */
  parentSessionId?: string | null;
  role: string;
  ts: string | null;
  byteOffset: number;
  charLength: number;
  text: string;
  score?: number;
}

export interface ConversationRankerStore {
  searchBm25(query: string, limit: number): Promise<RankedChunkRow[]> | RankedChunkRow[];
  searchVector(embedding: Float32Array, limit: number): Promise<RankedChunkRow[]> | RankedChunkRow[];
}

export interface PaletteExcerptSegment {
  text: string;
  match: boolean;
}

export interface ConversationSearchHit extends RankedChunkRow {
  rank: number;
  rrfScore: number;
  excerpt: string;
  excerptSegments: PaletteExcerptSegment[];
}

export interface RankConversationSearchOptions {
  query: string;
  store: ConversationRankerStore;
  provider: ConversationEmbeddingProvider;
  limit?: number;
  candidateLimit?: number;
  rrfK?: number;
  /** Request signal; abort rejects with signal.reason and skips the vector leg. */
  signal?: AbortSignal;
  /** Query-embedding budget; default DEFAULT_EMBED_TIMEOUT_MS. */
  embedTimeoutMs?: number;
  /** Called once when the embedding fails or times out (not on abort). */
  onEmbedFailure?: (error: unknown) => void;
  /** Called once when the embedding succeeds. */
  onEmbedSuccess?: () => void;
}

/** Query-embedding budget (PAN-5447): measured 220-420 ms, so ~6x headroom. */
export const DEFAULT_EMBED_TIMEOUT_MS = 2_500;

export class ConversationQueryEmbedTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query embedding timed out after ${timeoutMs} ms`);
    this.name = 'ConversationQueryEmbedTimeoutError';
  }
}

const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_LIMIT = 50;
const DEFAULT_RRF_K = 60;
const EXCERPT_CONTEXT_CHARS = 96;

/**
 * BM25 starts at once; the vector leg waits only for the query embedding
 * (PAN-5447). An embedding failure or timeout degrades to BM25 hits; an abort
 * rejects with the signal's reason and never runs the vector leg.
 */
export async function rankConversationSearch(
  options: RankConversationSearchOptions,
): Promise<ConversationSearchHit[]> {
  const query = options.query.trim();
  if (!query) return [];
  options.signal?.throwIfAborted();

  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidateLimit = options.candidateLimit ?? Math.max(DEFAULT_CANDIDATE_LIMIT, limit);

  const bm25 = Promise.resolve().then(() => options.store.searchBm25(query, candidateLimit));
  const vector = embedQuery(options, query).then(
    (embedding) => {
      options.signal?.throwIfAborted();
      return embedding ? options.store.searchVector(embedding, candidateLimit) : [];
    },
    (error: unknown) => {
      options.signal?.throwIfAborted();
      options.onEmbedFailure?.(error);
      return [];
    },
  );
  const [bm25Rows, vectorRows] = await Promise.all([bm25, vector]);
  options.signal?.throwIfAborted();

  return fuseRankedRows({ bm25Rows, vectorRows, query, limit, rrfK: options.rrfK ?? DEFAULT_RRF_K });
}

async function embedQuery(options: RankConversationSearchOptions, query: string): Promise<Float32Array | null> {
  const timeoutMs = options.embedTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await options.provider.embed([query], { signal: controller.signal });
    options.signal?.throwIfAborted();
    options.onEmbedSuccess?.();
    return result.embeddings[0] ?? null;
  } catch (error) {
    if (timedOut) throw new ConversationQueryEmbedTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function fuseRankedRows(input: {
  bm25Rows: RankedChunkRow[];
  vectorRows: RankedChunkRow[];
  query: string;
  limit?: number;
  rrfK?: number;
}): ConversationSearchHit[] {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const rrfK = input.rrfK ?? DEFAULT_RRF_K;
  const byRowid = new Map<number, { row: RankedChunkRow; score: number }>();

  addRrfScores(byRowid, input.bm25Rows, rrfK);
  addRrfScores(byRowid, input.vectorRows, rrfK);

  return Array.from(byRowid.values())
    .sort((a, b) => b.score - a.score || a.row.rowid - b.row.rowid)
    .slice(0, limit)
    .map((entry, index) => {
      const excerpt = buildMarkedExcerpt(entry.row.text, input.query);
      return {
        ...entry.row,
        rank: index + 1,
        rrfScore: entry.score,
        excerpt,
        excerptSegments: parseMarkedExcerpt(excerpt),
      };
    });
}

/**
 * Newest-first palette search (PAN-5677): append recency-leg rows that the
 * relevance hits do not already contain. Relevance hits keep their order,
 * ranks and RRF scores; appended rows score 0 and rank after them.
 */
export function appendRecentRows(input: {
  hits: ConversationSearchHit[];
  recentRows: RankedChunkRow[];
  query: string;
}): ConversationSearchHit[] {
  const seen = new Set(input.hits.map((hit) => hit.rowid));
  const out = [...input.hits];
  for (const row of input.recentRows) {
    if (seen.has(row.rowid)) continue;
    seen.add(row.rowid);
    const excerpt = buildMarkedExcerpt(row.text, input.query);
    out.push({ ...row, rank: out.length + 1, rrfScore: 0, excerpt, excerptSegments: parseMarkedExcerpt(excerpt) });
  }
  return out;
}

function addRrfScores(target: Map<number, { row: RankedChunkRow; score: number }>, rows: RankedChunkRow[], rrfK: number): void {
  rows.forEach((row, index) => {
    const score = 1 / (rrfK + index + 1);
    const existing = target.get(row.rowid);
    if (existing) existing.score += score;
    else target.set(row.rowid, { row, score });
  });
}

export function buildMarkedExcerpt(text: string, query: string): string {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const lower = text.toLowerCase();
  const match = terms
    .map((term) => ({ term, index: lower.indexOf(term.toLowerCase()) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => a.index - b.index)[0];

  if (!match) {
    return truncateExcerpt(text.trim());
  }

  const start = Math.max(0, match.index - EXCERPT_CONTEXT_CHARS);
  const end = Math.min(text.length, match.index + match.term.length + EXCERPT_CONTEXT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const before = text.slice(start, match.index);
  const matched = text.slice(match.index, match.index + match.term.length);
  const after = text.slice(match.index + match.term.length, end);
  return `${prefix}${before}⦇${matched}⦈${after}${suffix}`;
}

export function parseMarkedExcerpt(excerpt: string): PaletteExcerptSegment[] {
  const segments: PaletteExcerptSegment[] = [];
  let cursor = 0;
  while (cursor < excerpt.length) {
    const start = excerpt.indexOf('⦇', cursor);
    if (start === -1) {
      if (cursor < excerpt.length) segments.push({ text: excerpt.slice(cursor), match: false });
      break;
    }
    if (start > cursor) segments.push({ text: excerpt.slice(cursor, start), match: false });
    const end = excerpt.indexOf('⦈', start + 1);
    if (end === -1) {
      segments.push({ text: excerpt.slice(start), match: false });
      break;
    }
    segments.push({ text: excerpt.slice(start + 1, end), match: true });
    cursor = end + 1;
  }
  return segments;
}

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_CONTEXT_CHARS * 2) return text;
  return `${text.slice(0, EXCERPT_CONTEXT_CHARS * 2)}…`;
}
