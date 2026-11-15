/**
 * Lexical ranking of curated memory facts against a prompt (PAN-5358 FR-2, FR-3).
 * Pure, no I/O: BM25 over id/title/description/tags (head, double-weighted) and
 * body, gated by a head/rarity floor so a stray common-word match never surfaces
 * an unrelated fact. The `vectors` input is accepted but not yet used; vector
 * re-ranking lands in a later work item.
 */
import { PROMPT_KEYWORD_STOPWORDS } from '../search.js';
import type { MemoryFact } from './store.js';

export const FACT_RETRIEVAL_LIMIT = 6;
export const FACT_QUERY_MAX_TERMS = 400;
export const VECTOR_ONLY_MIN_SIMILARITY = 0.9;

export interface RankedFact {
  readonly fact: MemoryFact;
  /** RRF score when fused with vectors, BM25 otherwise. */
  readonly score: number;
  readonly bm25: number;
  /** Distinct discriminating query terms found in the fact's head. */
  readonly headMatches: number;
  /** Cosine similarity to the query centroid, when vectors were used. */
  readonly similarity?: number;
}

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const MIN_TOKEN_LENGTH = 3;

function extractWords(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_PATTERN) ?? [];
  return matches.filter((word) => word.length >= MIN_TOKEN_LENGTH);
}

function stemToken(word: string): string {
  let stem = word;
  if (stem.length >= 7 && stem.endsWith('ing')) {
    stem = stem.slice(0, -3);
  } else if (stem.length >= 6 && stem.endsWith('ed')) {
    stem = stem.slice(0, -2);
  } else if (stem.length >= 4 && stem.endsWith('s') && !stem.endsWith('ss')) {
    stem = stem.slice(0, -1);
  }
  if (stem.length >= 5 && stem.endsWith('e')) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

/** Lowercased letter/number runs of length >= 3, with a light suffix strip. */
export function tokenizeForFacts(text: string): string[] {
  return extractWords(text).map(stemToken);
}

function extractQueryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of extractWords(query)) {
    if (PROMPT_KEYWORD_STOPWORDS.has(word)) continue;
    const stem = stemToken(word);
    if (seen.has(stem)) continue;
    seen.add(stem);
    terms.push(stem);
    if (terms.length === FACT_QUERY_MAX_TERMS) break;
  }
  return terms;
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function factHeadText(fact: MemoryFact): string {
  return [fact.id.replace(/-/g, ' '), fact.title, fact.description, fact.tags.join(' ')].join(' ');
}

interface FactIndex {
  readonly fact: MemoryFact;
  readonly headCounts: ReadonlyMap<string, number>;
  readonly bodyCounts: ReadonlyMap<string, number>;
  readonly len: number;
}

function buildFactIndex(fact: MemoryFact): FactIndex {
  const headTokens = tokenizeForFacts(factHeadText(fact));
  const bodyTokens = tokenizeForFacts(fact.body);
  return {
    fact,
    headCounts: countTokens(headTokens),
    bodyCounts: countTokens(bodyTokens),
    len: 2 * headTokens.length + bodyTokens.length,
  };
}

function termFrequency(index: FactIndex, term: string): number {
  return 2 * (index.headCounts.get(term) ?? 0) + (index.bodyCounts.get(term) ?? 0);
}

function compareFacts(a: MemoryFact, b: MemoryFact): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return 0;
}

export function rankFactsForQuery(input: {
  facts: readonly MemoryFact[];
  /** The full expansion/prompt text — not the 12-term search query. */
  query: string;
  /** Keyed by fact.file; declared for the vector re-ranking work item, ignored here. */
  vectors?: ReadonlyMap<string, Float32Array>;
  limit?: number;
}): RankedFact[] {
  const { facts, query, limit = FACT_RETRIEVAL_LIMIT } = input;
  if (facts.length === 0) return [];

  const queryTerms = extractQueryTerms(query);
  if (queryTerms.length === 0) return [];

  const indices = facts.map(buildFactIndex);
  const totalLen = indices.reduce((sum, index) => sum + index.len, 0);
  const avgLen = totalLen === 0 ? 1 : totalLen / indices.length;
  const factCount = facts.length;

  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const index of indices) {
      if (termFrequency(index, term) > 0) count += 1;
    }
    documentFrequency.set(term, count);
  }

  const inverseDocumentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    const df = documentFrequency.get(term) ?? 0;
    inverseDocumentFrequency.set(term, Math.log(1 + (factCount - df + 0.5) / (df + 0.5)));
  }

  const discriminatingThreshold = Math.ceil(factCount / 2);
  const rareThreshold = Math.max(2, Math.ceil(factCount * 0.02));

  const eligible: Array<{ index: FactIndex; bm25: number; headMatches: number }> = [];
  for (const index of indices) {
    let bm25 = 0;
    let headMatches = 0;
    let rareHeadMatch = false;
    for (const term of queryTerms) {
      const tf = termFrequency(index, term);
      const idf = inverseDocumentFrequency.get(term) ?? 0;
      bm25 += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (index.len / avgLen)));
      const inHead = (index.headCounts.get(term) ?? 0) > 0;
      if (!inHead) continue;
      const df = documentFrequency.get(term) ?? 0;
      if (df <= discriminatingThreshold) headMatches += 1;
      if (df <= rareThreshold) rareHeadMatch = true;
    }
    if (bm25 > 0 && (headMatches >= 2 || rareHeadMatch)) {
      eligible.push({ index, bm25, headMatches });
    }
  }

  eligible.sort((a, b) => {
    if (b.bm25 !== a.bm25) return b.bm25 - a.bm25;
    return compareFacts(a.index.fact, b.index.fact);
  });

  return eligible.slice(0, limit).map(({ index, bm25, headMatches }) => ({
    fact: index.fact,
    score: bm25,
    bm25,
    headMatches,
  }));
}
