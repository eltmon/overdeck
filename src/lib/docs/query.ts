import Database from 'better-sqlite3';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../config-yaml.js';
import { getDocsIndexPath } from '../paths.js';
import type { DocsDocKind } from './corpus.js';
import { bufferToFloat32Array, validateDocsIndex } from './index-builder.js';

export interface QueryDocsOptions {
  indexPath?: string;
  query: string;
  kind?: DocsDocKind;
  top?: number;
  maxTokens?: number;
  maxFtsRows?: number;
  maxVectorRows?: number;
  config?: Pick<NormalizedDocsConfig, 'budget'>;
}

export interface DocsQueryScores {
  bm25?: number;
  vector?: number;
  rrf: number;
  kindPriority: number;
}

export interface DocsQueryResultItem {
  chunkId: number;
  docPath: string;
  docKind: DocsDocKind;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  content: string;
  tokenCount: number;
  scores: DocsQueryScores;
}

export interface DocsQueryResult {
  query: string;
  results: DocsQueryResultItem[];
}

interface ChunkRow {
  chunkId: number;
  docPath: string;
  docKind: DocsDocKind;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  content: string;
  tokenCount: number;
  builtAt: string;
}

interface FtsRow extends ChunkRow {
  bm25: number;
}

interface EmbeddingRow extends ChunkRow {
  embedding: Buffer;
}

const DEFAULT_DOCS_CONFIG = getDefaultDocsConfig();
const RRF_K = 60;
const DOC_KIND_PRIORITY: Record<DocsDocKind, number> = {
  docs: 5,
  skill: 4,
  rule: 3,
  'claude-md': 2,
  prd: 1,
};

export function queryDocsIndex(options: QueryDocsOptions): DocsQueryResult {
  const query = options.query;
  const ftsQuery = sanitizeDocsFtsQuery(query);
  if (!ftsQuery) return { query, results: [] };

  let db: Database.Database | null = null;
  try {
    db = new Database(options.indexPath ?? getDocsIndexPath(), { readonly: true });
    const metadata = validateDocsIndex(db);
    const maxFtsRows = options.maxFtsRows ?? 20;
    const maxVectorRows = options.maxVectorRows ?? 20;
    const budget = options.config?.budget ?? DEFAULT_DOCS_CONFIG.budget;
    const top = options.top ?? budget.maxChunksPerInjection;
    const maxTokens = options.maxTokens ?? budget.maxTokensPerInjection;
    const ftsRows = queryFtsRows(db, ftsQuery, options.kind, maxFtsRows);
    if (ftsRows.length === 0) return { query, results: [] };

    const vectorRows = queryStoredVectorRows(db, ftsRows, metadata.embeddingDimensions, options.kind, maxVectorRows);
    const ranked = rankDocsResults(ftsRows, vectorRows);
    return { query, results: applyDocsQueryBounds(ranked, top, maxTokens) };
  } catch {
    return { query, results: [] };
  } finally {
    db?.close();
  }
}

export function sanitizeDocsFtsQuery(query: string): string | null {
  const tokens = [...query.matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0].toLowerCase())
    .filter((token) => token.length > 1)
    .slice(0, 16);
  if (tokens.length === 0) return null;
  return tokens.join(' OR ');
}

export function formatDocsQueryMarkdown(result: DocsQueryResult): string {
  if (result.results.length === 0) return '';
  const sections = result.results.map((item) => {
    const heading = item.sectionHeading ? ` → ${item.sectionHeading}` : '';
    const anchor = item.sectionAnchor ? ` (#${item.sectionAnchor})` : '';
    return `## ${item.docPath}${heading}${anchor}\n\n${sanitizeDocsSnippet(item.content)}`;
  });
  return `<panopticon-docs>\n${sections.join('\n\n---\n\n')}\n</panopticon-docs>`;
}

export function formatDocsQueryJson(result: DocsQueryResult): string {
  return JSON.stringify(result, null, 2);
}

function queryFtsRows(db: Database.Database, ftsQuery: string, kind: DocsDocKind | undefined, limit: number): FtsRow[] {
  const kindClause = kind ? 'AND c.doc_kind = ?' : '';
  const statement = db.prepare(`
    SELECT
      c.chunk_id AS chunkId,
      c.doc_path AS docPath,
      c.doc_kind AS docKind,
      c.section_heading AS sectionHeading,
      c.section_anchor AS sectionAnchor,
      c.content,
      c.token_count AS tokenCount,
      c.built_at AS builtAt,
      bm25(docs_fts) AS bm25
    FROM docs_fts
    JOIN docs_chunks c ON c.chunk_id = docs_fts.rowid
    WHERE docs_fts MATCH ? ${kindClause}
    ORDER BY bm25(docs_fts) ASC
    LIMIT ?
  `);
  return (kind ? statement.all(ftsQuery, kind, limit) : statement.all(ftsQuery, limit)) as FtsRow[];
}

function queryStoredVectorRows(
  db: Database.Database,
  ftsRows: FtsRow[],
  dimensions: number,
  kind: DocsDocKind | undefined,
  limit: number,
): Array<ChunkRow & { similarity: number }> {
  const queryVector = centroidVector(loadEmbeddingsForChunks(db, ftsRows.map((row) => row.chunkId), dimensions));
  if (!queryVector) return [];

  const kindClause = kind ? 'WHERE c.doc_kind = ?' : '';
  const statement = db.prepare(`
    SELECT
      c.chunk_id AS chunkId,
      c.doc_path AS docPath,
      c.doc_kind AS docKind,
      c.section_heading AS sectionHeading,
      c.section_anchor AS sectionAnchor,
      c.content,
      c.token_count AS tokenCount,
      c.built_at AS builtAt,
      e.embedding
    FROM docs_embeddings e
    JOIN docs_chunks c ON c.chunk_id = e.chunk_id
    ${kindClause}
  `);
  const rows = (kind ? statement.all(kind) : statement.all()) as EmbeddingRow[];
  return rows
    .map((row) => ({ ...row, similarity: cosineSimilarity(queryVector, bufferToFloat32Array(row.embedding, dimensions)) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function loadEmbeddingsForChunks(db: Database.Database, chunkIds: number[], dimensions: number): Float32Array[] {
  if (chunkIds.length === 0) return [];
  const placeholders = chunkIds.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT embedding FROM docs_embeddings WHERE chunk_id IN (${placeholders})`).all(...chunkIds) as Array<{ embedding: Buffer }>;
  return rows.map((row) => bufferToFloat32Array(row.embedding, dimensions));
}

function rankDocsResults(ftsRows: FtsRow[], vectorRows: Array<ChunkRow & { similarity: number }>): DocsQueryResultItem[] {
  const ranked = new Map<number, DocsQueryResultItem & { builtAt: string }>();

  for (const [index, row] of ftsRows.entries()) {
    const rank = index + 1;
    ranked.set(row.chunkId, {
      ...row,
      scores: {
        bm25: row.bm25,
        rrf: 1 / (RRF_K + rank),
        kindPriority: DOC_KIND_PRIORITY[row.docKind],
      },
    });
  }

  for (const [index, row] of vectorRows.entries()) {
    const rank = index + 1;
    const existing = ranked.get(row.chunkId);
    if (existing) {
      existing.scores.vector = row.similarity;
      existing.scores.rrf += 1 / (RRF_K + rank);
      continue;
    }
    ranked.set(row.chunkId, {
      chunkId: row.chunkId,
      docPath: row.docPath,
      docKind: row.docKind,
      sectionHeading: row.sectionHeading,
      sectionAnchor: row.sectionAnchor,
      content: row.content,
      tokenCount: row.tokenCount,
      builtAt: row.builtAt,
      scores: {
        vector: row.similarity,
        rrf: 1 / (RRF_K + rank),
        kindPriority: DOC_KIND_PRIORITY[row.docKind],
      },
    });
  }

  return [...ranked.values()]
    .sort((a, b) => {
      const scoreDelta = b.scores.rrf - a.scores.rrf;
      if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
      const kindDelta = b.scores.kindPriority - a.scores.kindPriority;
      if (kindDelta !== 0) return kindDelta;
      return b.builtAt.localeCompare(a.builtAt);
    })
    .map(({ builtAt: _builtAt, ...item }) => item);
}

function applyDocsQueryBounds(results: DocsQueryResultItem[], top: number, maxTokens: number): DocsQueryResultItem[] {
  const bounded: DocsQueryResultItem[] = [];
  let remainingTokens = Math.max(0, maxTokens);
  for (const result of results) {
    if (bounded.length >= top || remainingTokens <= 0) break;
    const content = truncateToTokenBudget(result.content, remainingTokens);
    const tokenCount = countTokens(content);
    if (!content || tokenCount === 0) continue;
    bounded.push({ ...result, content, tokenCount });
    remainingTokens -= tokenCount;
  }
  return bounded;
}

function centroidVector(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const centroid = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    for (let i = 0; i < vector.length; i++) centroid[i] += vector[i];
  }
  for (let i = 0; i < centroid.length; i++) centroid[i] /= vectors.length;
  return normalizeVector(centroid);
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
  return dot;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, maxTokens).join(' ');
}

function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function sanitizeDocsSnippet(content: string): string {
  return content.replace(/<\/panopticon-docs>/gi, '&lt;/panopticon-docs&gt;');
}
