import type { ConversationEmbeddingProvider } from './embedding-provider.js';

export interface RankedChunkRow {
  rowid: number;
  sessionId: string;
  projectId: string;
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
}

const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_LIMIT = 50;
const DEFAULT_RRF_K = 60;
const EXCERPT_CONTEXT_CHARS = 96;

export async function rankConversationSearch(
  options: RankConversationSearchOptions,
): Promise<ConversationSearchHit[]> {
  const query = options.query.trim();
  if (!query) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidateLimit = options.candidateLimit ?? Math.max(DEFAULT_CANDIDATE_LIMIT, limit);
  const embeddedQuery = await options.provider.embed([query]);
  const queryEmbedding = embeddedQuery.embeddings[0];
  if (!queryEmbedding) return [];

  const [bm25Rows, vectorRows] = await Promise.all([
    Promise.resolve(options.store.searchBm25(query, candidateLimit)),
    Promise.resolve(options.store.searchVector(queryEmbedding, candidateLimit)),
  ]);

  return fuseRankedRows({ bm25Rows, vectorRows, query, limit, rrfK: options.rrfK ?? DEFAULT_RRF_K });
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
