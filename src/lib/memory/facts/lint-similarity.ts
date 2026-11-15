/**
 * Pairwise fact similarity for `pan memory lint` (PAN-5360 W8, D16, FR-10). Uses the
 * configured conversation-search embedder when one is available and falls back to a
 * local TF-IDF cosine over word tokens when it is not. Not imported by the launch
 * path: render.ts, store.ts and operator-sync*.ts never import this module.
 */
import { createConversationEmbeddingProvider } from '../../conversation-search/embedding-provider.js';
import type { MemoryFact } from './store.js';

export const LEXICAL_DUPLICATE_THRESHOLD = 0.6;
export const LEXICAL_CANDIDATE_THRESHOLD = 0.3;
export const EMBEDDING_DUPLICATE_THRESHOLD = 0.9;
export const EMBEDDING_CANDIDATE_THRESHOLD = 0.75;
const FALLBACK_REASON_MAX = 200;

export type Embedder = (texts: string[]) => Promise<{ embeddings: Float32Array[]; model: string }>;

/** One scored fact pair; `a` sorts before `b`. */
export interface ScoredPair {
  readonly a: string;
  readonly b: string;
  readonly score: number;
}

export interface SimilarityResult {
  method: 'lexical' | 'embedding';
  model?: string;
  fallbackReason?: string;
  pairs: ScoredPair[];
}

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been',
  'before', 'but', 'by', 'can', 'do', 'does', 'each', 'for', 'from', 'has', 'have', 'how', 'if', 'in',
  'into', 'is', 'it', 'its', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'so', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'use', 'was', 'we', 'were',
  'what', 'when', 'which', 'while', 'who', 'why', 'will', 'with', 'you', 'your',
]);

/** The text one fact is compared by: title, description and body. */
export function factText(fact: MemoryFact): string {
  return `${fact.title}\n${fact.description}\n${fact.body}`;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** TF-IDF vectors, `idf = ln(1 + N / df)`, one sparse map per text. */
export function lexicalVectors(texts: readonly string[]): Map<string, number>[] {
  const counts = texts.map((text) => {
    const tf = new Map<string, number>();
    for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);
    return tf;
  });
  const df = new Map<string, number>();
  for (const tf of counts) for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const n = texts.length;
  return counts.map((tf) => {
    const vector = new Map<string, number>();
    for (const [token, count] of tf) vector.set(token, count * Math.log(1 + n / (df.get(token) ?? 1)));
    return vector;
  });
}

/** Cosine similarity of two sparse (Map) or two dense (Float32Array) vectors; 0 when either is all zero. */
export function cosine(a: Map<string, number>, b: Map<string, number>): number;
export function cosine(a: Float32Array, b: Float32Array): number;
export function cosine(a: Map<string, number> | Float32Array, b: Map<string, number> | Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  if (a instanceof Map && b instanceof Map) {
    for (const [key, value] of a) {
      normA += value * value;
      dot += value * (b.get(key) ?? 0);
    }
    for (const value of b.values()) normB += value * value;
  } else if (a instanceof Float32Array && b instanceof Float32Array) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function pairsAtOrAbove(
  ids: readonly string[],
  score: (i: number, j: number) => number,
  threshold: number,
): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const value = score(i, j);
      if (value < threshold) continue;
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      pairs.push({ a, b, score: value });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

function lexicalPairs(ids: readonly string[], texts: readonly string[]): ScoredPair[] {
  const vectors = lexicalVectors(texts);
  return pairsAtOrAbove(ids, (i, j) => cosine(vectors[i], vectors[j]), LEXICAL_CANDIDATE_THRESHOLD);
}

/**
 * Every fact pair scoring at or above the method's candidate threshold, most similar
 * first. With an embedder, its vectors are used; if it throws, lexical similarity is used
 * and `fallbackReason` carries the error message.
 */
export async function scoreFactPairs(facts: readonly MemoryFact[], embedder: Embedder | null): Promise<SimilarityResult> {
  const ids = facts.map((fact) => fact.id);
  const texts = facts.map(factText);
  if (embedder === null) return { method: 'lexical', pairs: lexicalPairs(ids, texts) };

  try {
    const { embeddings, model } = await embedder(texts);
    if (embeddings.length !== texts.length) {
      throw new Error(`embedder returned ${embeddings.length} vectors for ${texts.length} facts`);
    }
    return {
      method: 'embedding',
      model,
      pairs: pairsAtOrAbove(ids, (i, j) => cosine(embeddings[i], embeddings[j]), EMBEDDING_CANDIDATE_THRESHOLD),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { method: 'lexical', fallbackReason: message.slice(0, FALLBACK_REASON_MAX), pairs: lexicalPairs(ids, texts) };
  }
}

/** The configured conversation-search embedder, or null with the reason it is unavailable. */
export function defaultEmbedder(): { embedder: Embedder | null; unavailableReason?: string } {
  const provider = createConversationEmbeddingProvider();
  if (!provider.enabled) return { embedder: null, unavailableReason: provider.unavailableReason ?? 'embeddings unavailable' };
  return {
    embedder: async (texts) => {
      const result = await provider.embed(texts);
      return { embeddings: result.embeddings, model: result.model };
    },
  };
}
