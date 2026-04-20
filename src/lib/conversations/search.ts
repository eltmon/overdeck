/**
 * Search composer for discovered sessions (PAN-457).
 *
 * Three search strategies, composable:
 *   1. Structured filters → SQL AND composition via findDiscoveredSessions
 *   2. FTS5 full-text search → BM25 ranked matches via searchFts
 *   3. Semantic similarity → cosine distance over Float32 embeddings
 *
 * Strategy selection:
 *   - q only        → FTS5
 *   - similarTo only → semantic
 *   - filter only   → structured SQL
 *   - q + filter    → FTS5 then intersect with filter conditions
 *   - q + similarTo → FTS5 results re-ranked by semantic similarity
 *
 * Relative time strings ("7d", "1h", "today") are parsed to ISO timestamps
 * before passing to structured filters.
 */

import {
  findDiscoveredSessions,
  countDiscoveredSessions,
  countFts,
  countFtsInSet,
  searchFts,
  loadEmbeddings,
  getEmbedding,
  getDiscoveredSessionById,
} from '../database/discovered-sessions-db.js';
import type { DiscoveredSession, ConversationFilter } from '../database/discovered-sessions-db.js';
import { embed } from './embeddings/providers.js';
import type { EmbeddingProviderName } from './embeddings/providers.js';
import { getConversationsConfig } from '../config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchQuery {
  /** Full-text query (FTS5 MATCH syntax) */
  q?: string;
  /** Session ID to find similar sessions for (semantic) */
  similarTo?: number;
  /** Free-text string to embed and use for semantic cosine-ranked search */
  semanticQuery?: string;
  /** Embedding provider for semanticQuery (defaults to config) */
  semanticProvider?: EmbeddingProviderName;
  /** Embedding model to use for semantic search */
  embeddingModel?: string;
  /** Structured filters (time fields accept relative strings like "7d") */
  filter?: RawFilter;
  /** Max results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Output format (for CLI callers) */
  format?: 'table' | 'json' | 'brief' | 'ids';
}

/**
 * Like ConversationFilter but time fields accept relative strings.
 */
export interface RawFilter {
  workspacePath?: string;
  primaryModel?: string;
  managed?: boolean;
  unmanaged?: boolean;
  /** ISO timestamp OR relative string ("7d", "2h", "today", "yesterday", "1w") */
  since?: string;
  /** ISO timestamp OR relative string */
  before?: string;
  /** ISO timestamp OR relative string */
  after?: string;
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  issueId?: string;
  enriched?: boolean;
  notEnriched?: boolean;
}

export type SearchMode = 'filter' | 'fts' | 'semantic' | 'fts+filter' | 'semantic+fts';

export interface SearchResult {
  sessions: DiscoveredSession[];
  total: number;
  mode: SearchMode;
  durationMs: number;
}

// ─── Relative time parsing ────────────────────────────────────────────────────

const RELATIVE_PATTERN = /^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)$/i;

/**
 * Parse a relative time string to an ISO timestamp.
 * Passthrough for ISO strings (starts with a digit followed by a date-like pattern,
 * or starts with 'Z', '-', or '+').
 *
 * Supported relative forms:
 *   - "7d" / "7 days" → 7 days ago
 *   - "24h" / "24 hours"
 *   - "30m" / "30 minutes"
 *   - "2w" / "2 weeks"
 *   - "1mo" / "1 month"
 *   - "today" → start of today (00:00:00 UTC)
 *   - "yesterday" → start of yesterday (00:00:00 UTC)
 */
export function parseRelativeTime(value: string, now: Date = new Date()): string {
  const trimmed = value.trim();

  // Pass through ISO 8601 formats
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;

  if (trimmed.toLowerCase() === 'today') {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  if (trimmed.toLowerCase() === 'yesterday') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  const match = RELATIVE_PATTERN.exec(trimmed);
  if (!match) return trimmed; // Unknown — pass through

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const ms = (() => {
    if (unit.startsWith('s')) return amount * 1_000;
    if (unit.startsWith('m') && !unit.startsWith('mo')) return amount * 60_000;
    if (unit.startsWith('h')) return amount * 3_600_000;
    if (unit.startsWith('d')) return amount * 86_400_000;
    if (unit.startsWith('w')) return amount * 7 * 86_400_000;
    if (unit.startsWith('mo')) return amount * 30 * 86_400_000;
    return 0;
  })();

  return new Date(now.getTime() - ms).toISOString();
}

// ─── Filter normalization ─────────────────────────────────────────────────────

function normalizeFilter(raw: RawFilter | undefined, limit: number | undefined, offset: number | undefined): ConversationFilter {
  if (!raw) return { limit, offset };
  const f: ConversationFilter = { ...raw, limit, offset };
  if (raw.since) f.since = parseRelativeTime(raw.since);
  if (raw.before) f.before = parseRelativeTime(raw.before);
  if (raw.after) f.after = parseRelativeTime(raw.after);
  return f;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Search strategies ────────────────────────────────────────────────────────

function semanticSearch(
  referenceId: number,
  model: string,
  allSessions: DiscoveredSession[],
  limit: number,
): DiscoveredSession[] {
  const refEmbedding = getEmbedding(referenceId, model);
  if (!refEmbedding) return [];

  const allEmbeddings = loadEmbeddings(model);
  const sessionMap = new Map(allSessions.map((s) => [s.id, s]));

  const scored: Array<{ session: DiscoveredSession; score: number }> = [];
  for (const { sessionId, embedding } of allEmbeddings) {
    if (sessionId === referenceId) continue;
    const session = sessionMap.get(sessionId);
    if (!session) continue;
    scored.push({ session, score: cosineSimilarity(refEmbedding, embedding) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.session);
}

// ─── Main search entry point ──────────────────────────────────────────────────

/**
 * Execute a search query against discovered sessions.
 *
 * Strategy dispatch:
 *  - No q, no similarTo → structured filter only
 *  - q only             → FTS5
 *  - similarTo only     → semantic
 *  - q + filter         → FTS5 + intersect with filter IDs
 *  - similarTo + q      → FTS5 re-ranked by semantic similarity
 */
export async function searchSessions(query: SearchQuery): Promise<SearchResult> {
  const start = Date.now();
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const config = getConversationsConfig();
  const embeddingModel = query.embeddingModel ?? config.embeddingModel ?? 'text-embedding-3-small';

  // ── Semantic free-text query path ─────────────────────────────────────────
  if (query.semanticQuery?.trim()) {
    const provider = (query.semanticProvider ?? config.embeddingProvider ?? 'openai') as EmbeddingProviderName;
    const embedResult = await embed(provider, { text: query.semanticQuery.trim(), model: embeddingModel });
    const queryEmbedding = embedResult.embedding;
    const filter = normalizeFilter(query.filter, undefined, undefined);
    const allSessions = findDiscoveredSessions(filter);
    const allEmbeddings = loadEmbeddings(embeddingModel);
    const embMap = new Map(allEmbeddings.map((e) => [e.sessionId, e.embedding]));
    const sessionMap = new Map(allSessions.map((s) => [s.id, s]));
    const scored: Array<{ session: DiscoveredSession; score: number }> = [];
    for (const [sid, emb] of embMap) {
      const session = sessionMap.get(sid);
      if (!session) continue;
      scored.push({ session, score: cosineSimilarity(queryEmbedding, emb) });
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      sessions: scored.slice(offset, offset + limit).map((x) => x.session),
      total: scored.length,
      mode: 'semantic',
      durationMs: Date.now() - start,
    };
  }

  const hasQ = Boolean(query.q?.trim());
  const hasSimilarTo = query.similarTo != null;
  const hasFilter = query.filter != null && Object.keys(query.filter).length > 0;

  // ── Strategy 1: filter only ──────────────────────────────────────────────
  if (!hasQ && !hasSimilarTo) {
    const total = countDiscoveredSessions(normalizeFilter(query.filter, undefined, undefined));
    const filter = normalizeFilter(query.filter, limit, offset);
    const sessions = findDiscoveredSessions(filter);
    return {
      sessions,
      total,
      mode: 'filter',
      durationMs: Date.now() - start,
    };
  }

  // ── Strategy 2: FTS5 only or FTS5 + filter ───────────────────────────────
  if (hasQ && !hasSimilarTo) {
    // FTS+filter needs all matches for correct intersection; FTS-only needs offset+limit
    const ftsMatches = hasFilter ? searchFts(query.q!) : searchFts(query.q!, offset + limit);
    if (ftsMatches.length === 0) {
      return { sessions: [], total: 0, mode: 'fts', durationMs: Date.now() - start };
    }

    const ftsIds = new Set(ftsMatches.map((m) => m.id));

    // Fetch sessions in FTS rank order
    let sessions: DiscoveredSession[];
    let total: number;
    if (hasFilter) {
      // Apply structured filter then intersect with FTS result IDs.
      // Total = count of filter results that also match the FTS query (true intersection).
      const filter = normalizeFilter(query.filter, undefined, undefined);
      const allFiltered = findDiscoveredSessions(filter);
      total = countFtsInSet(query.q!, allFiltered.map((s) => s.id));
      // Preserve FTS rank order for the page
      const rankMap = new Map(ftsMatches.map((m, i) => [m.id, i]));
      sessions = allFiltered
        .filter((s) => ftsIds.has(s.id))
        .sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999))
        .slice(offset, offset + limit);
    } else {
      // FTS only — use COUNT query for true total (not bounded by over-fetch cap)
      total = countFts(query.q!);
      sessions = ftsMatches
        .slice(offset, offset + limit)
        .map((m) => getDiscoveredSessionById(m.id))
        .filter((s): s is DiscoveredSession => s != null);
    }

    return {
      sessions,
      total,
      mode: hasFilter ? 'fts+filter' : 'fts',
      durationMs: Date.now() - start,
    };
  }

  // ── Strategy 3: semantic only ─────────────────────────────────────────────
  if (hasSimilarTo && !hasQ) {
    const filter = normalizeFilter(query.filter, undefined, undefined);
    const allSessions = findDiscoveredSessions(filter);
    // Rank ALL sessions (no limit cap) so pagination is correct
    const allRanked = semanticSearch(query.similarTo!, embeddingModel, allSessions, allSessions.length);
    return {
      sessions: allRanked.slice(offset, offset + limit),
      total: allRanked.length,
      mode: 'semantic',
      durationMs: Date.now() - start,
    };
  }

  // ── Strategy 4: FTS + semantic re-ranking ─────────────────────────────────
  // similarTo + q: get FTS candidates, re-rank by cosine similarity
  // Fetch all FTS matches — semantic re-ranking changes order so we need the full set
  const refEmbedding = getEmbedding(query.similarTo!, embeddingModel);
  const ftsMatches = searchFts(query.q!);

  let candidates: DiscoveredSession[];
  let ftsTotal: number;
  if (hasFilter) {
    // Intersect FTS candidates with filter constraints so results respect all filters
    const filter = normalizeFilter(query.filter, undefined, undefined);
    const allFiltered = findDiscoveredSessions(filter);
    const ftsIdSet = new Set(ftsMatches.map((m) => m.id));
    candidates = allFiltered.filter((s) => ftsIdSet.has(s.id));
    ftsTotal = countFtsInSet(query.q!, allFiltered.map((s) => s.id));
  } else {
    const ftsIds = ftsMatches.map((m) => m.id);
    candidates = ftsIds
      .map((id) => getDiscoveredSessionById(id))
      .filter((s): s is DiscoveredSession => s != null);
    ftsTotal = countFts(query.q!);
  }

  if (!refEmbedding || candidates.length === 0) {
    // Fall back to FTS order
    const sessions = candidates.slice(offset, offset + limit);
    return {
      sessions,
      total: ftsTotal,
      mode: 'semantic+fts',
      durationMs: Date.now() - start,
    };
  }

  // Re-rank FTS candidates by cosine similarity
  const embeddingMap = new Map(
    loadEmbeddings(embeddingModel).map((e) => [e.sessionId, e.embedding]),
  );
  const scored = candidates
    .map((s) => {
      const emb = embeddingMap.get(s.id);
      const score = emb ? cosineSimilarity(refEmbedding, emb) : 0;
      return { session: s, score };
    })
    .sort((a, b) => b.score - a.score);

  const sessions = scored.slice(offset, offset + limit).map((x) => x.session);
  return {
    sessions,
    total: ftsTotal,
    mode: 'semantic+fts',
    durationMs: Date.now() - start,
  };
}
