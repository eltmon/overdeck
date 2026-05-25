import Database from 'better-sqlite3';
import { mkdir, readFile, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

import type { NormalizedDocsConfig } from '../config-yaml.js';
import { getDefaultDocsConfig } from '../config-yaml.js';
import { packageRoot } from '../paths.js';
import { discoverDocsCorpusSources, chunkMarkdown, type DocsChunk } from './corpus.js';

export const DEFAULT_DOCS_INDEX_PATH = join(packageRoot, 'dist', 'docs-index.sqlite');
export const DEFAULT_DOCS_INDEX_MAX_BYTES = 50 * 1024 * 1024;
export const DOCS_INDEX_SCHEMA_VERSION = 1;

export interface DocsEmbeddingInput {
  chunk: DocsChunk;
  dimensions: number;
  model: string;
}

export type DocsEmbeddingFunction = (input: DocsEmbeddingInput) => Promise<Float32Array> | Float32Array;

export interface BuildDocsIndexOptions {
  outputPath?: string;
  rootDir?: string;
  syncSourcesRoot?: string;
  config?: Pick<NormalizedDocsConfig, 'corpus' | 'embedding'>;
  embeddingFn?: DocsEmbeddingFunction;
  builtAt?: string;
  maxIndexBytes?: number;
}

export interface BuildDocsIndexResult {
  outputPath: string;
  sourceCount: number;
  chunkCount: number;
  embeddingCount: number;
  sizeBytes: number;
  builtAt: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface DocsIndexMetadata {
  schemaVersion: number;
  builtAt: string;
  sourceCount: number;
  chunkCount: number;
  embeddingCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

interface BuildConfig {
  corpus: NormalizedDocsConfig['corpus'];
  embedding: NormalizedDocsConfig['embedding'];
}

const DEFAULT_CONFIG = getDefaultDocsConfig();

function resolveBuildConfig(config?: Pick<NormalizedDocsConfig, 'corpus' | 'embedding'>): BuildConfig {
  return {
    corpus: config?.corpus ?? DEFAULT_CONFIG.corpus,
    embedding: config?.embedding ?? DEFAULT_CONFIG.embedding,
  };
}

export async function buildDocsIndex(options: BuildDocsIndexOptions = {}): Promise<BuildDocsIndexResult> {
  const outputPath = options.outputPath ?? DEFAULT_DOCS_INDEX_PATH;
  const maxIndexBytes = options.maxIndexBytes ?? DEFAULT_DOCS_INDEX_MAX_BYTES;
  const builtAt = options.builtAt ?? new Date().toISOString();
  const config = resolveBuildConfig(options.config);
  const embeddingFn = options.embeddingFn ?? deterministicDocsEmbedding;

  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });

  const db = new Database(outputPath);
  let sourceCount = 0;
  let chunkCount = 0;
  let embeddingCount = 0;

  try {
    createDocsIndexSchema(db);
    const sources = await discoverDocsCorpusSources({
      rootDir: options.rootDir,
      syncSourcesRoot: options.syncSourcesRoot,
      config: { corpus: config.corpus },
    });
    sourceCount = sources.length;

    const insertChunk = db.prepare(`
      INSERT INTO docs_chunks (
        chunk_id,
        doc_path,
        doc_kind,
        section_heading,
        section_anchor,
        content,
        display_content,
        token_count,
        built_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO docs_fts(rowid, content, display_content, doc_path, doc_kind, section_heading)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertEmbedding = db.prepare(`
      INSERT INTO docs_embeddings(chunk_id, embedding)
      VALUES (?, ?)
    `);

    const chunks: DocsChunk[] = [];
    for (const source of sources) {
      const markdown = await readFile(source.absolutePath, 'utf8');
      chunks.push(...chunkMarkdown(source, markdown, { maxChunkTokens: config.corpus.maxChunkTokens }));
    }

    const insertAll = db.transaction((items: Array<{ chunk: DocsChunk; embedding: Float32Array }>) => {
      for (const [index, item] of items.entries()) {
        const chunkId = index + 1;
        const chunk = item.chunk;
        insertChunk.run(
          chunkId,
          chunk.docPath,
          chunk.docKind,
          chunk.sectionHeading,
          chunk.sectionAnchor,
          chunk.content,
          chunk.content,
          chunk.tokenCount,
          builtAt,
        );
        insertFts.run(
          chunkId,
          chunk.content,
          chunk.content,
          chunk.docPath,
          chunk.docKind,
          chunk.sectionHeading,
        );
        insertEmbedding.run(chunkId, float32ArrayToBuffer(item.embedding));
      }
    });

    const items = [];
    for (const chunk of chunks) {
      const embedding = await embeddingFn({
        chunk,
        dimensions: config.embedding.dimensions,
        model: config.embedding.model,
      });
      items.push({ chunk, embedding: normalizeFloat32Embedding(embedding, config.embedding.dimensions) });
    }
    insertAll(items);

    chunkCount = chunks.length;
    embeddingCount = items.length;
    writeDocsIndexMetadata(db, {
      schemaVersion: DOCS_INDEX_SCHEMA_VERSION,
      builtAt,
      sourceCount,
      chunkCount,
      embeddingCount,
      embeddingModel: config.embedding.model,
      embeddingDimensions: config.embedding.dimensions,
    });
  } finally {
    db.close();
  }

  const sizeBytes = (await stat(outputPath)).size;
  if (sizeBytes > maxIndexBytes) {
    throw new Error(`docs index ${outputPath} is ${sizeBytes} bytes, exceeding budget ${maxIndexBytes} bytes`);
  }

  return {
    outputPath,
    sourceCount,
    chunkCount,
    embeddingCount,
    sizeBytes,
    builtAt,
    embeddingModel: config.embedding.model,
    embeddingDimensions: config.embedding.dimensions,
  };
}

export function createDocsIndexSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE docs_chunks (
      chunk_id INTEGER PRIMARY KEY,
      doc_path TEXT NOT NULL,
      doc_kind TEXT NOT NULL CHECK (doc_kind IN ('docs', 'skill', 'prd', 'rule', 'claude-md')),
      section_heading TEXT,
      section_anchor TEXT,
      content TEXT NOT NULL,
      display_content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      built_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE docs_fts USING fts5(
      content,
      display_content UNINDEXED,
      doc_path UNINDEXED,
      doc_kind,
      section_heading,
      tokenize = 'porter unicode61',
      content = 'docs_chunks',
      content_rowid = 'chunk_id'
    );

    CREATE TABLE docs_embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES docs_chunks(chunk_id) ON DELETE CASCADE,
      embedding BLOB NOT NULL
    );

    CREATE TABLE docs_index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function readDocsIndexMetadata(db: Database.Database): DocsIndexMetadata {
  const rows = db.prepare('SELECT key, value FROM docs_index_metadata').all() as Array<{ key: string; value: string }>;
  const metadata = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    schemaVersion: Number(metadata.schema_version),
    builtAt: metadata.built_at,
    sourceCount: Number(metadata.source_count),
    chunkCount: Number(metadata.chunk_count),
    embeddingCount: Number(metadata.embedding_count),
    embeddingModel: metadata.embedding_model,
    embeddingDimensions: Number(metadata.embedding_dimensions),
  };
}

export function validateDocsIndex(db: Database.Database): DocsIndexMetadata {
  const metadata = readDocsIndexMetadata(db);
  if (metadata.schemaVersion !== DOCS_INDEX_SCHEMA_VERSION) {
    throw new Error(`unsupported docs index schema version: ${metadata.schemaVersion}`);
  }

  const chunkCount = (db.prepare('SELECT COUNT(*) AS count FROM docs_chunks').get() as { count: number }).count;
  const ftsCount = (db.prepare('SELECT COUNT(*) AS count FROM docs_fts').get() as { count: number }).count;
  const embeddingCount = (db.prepare('SELECT COUNT(*) AS count FROM docs_embeddings').get() as { count: number }).count;

  if (chunkCount !== ftsCount) {
    throw new Error(`docs index FTS row count ${ftsCount} does not match docs_chunks row count ${chunkCount}`);
  }
  if (chunkCount !== embeddingCount) {
    throw new Error(`docs index embedding row count ${embeddingCount} does not match docs_chunks row count ${chunkCount}`);
  }
  if (metadata.chunkCount !== chunkCount || metadata.embeddingCount !== embeddingCount) {
    throw new Error('docs index metadata counts do not match table counts');
  }

  return metadata;
}

export function normalizeFloat32Embedding(embedding: Float32Array, dimensions: number): Float32Array {
  if (embedding.length !== dimensions) {
    throw new Error(`embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`);
  }

  let norm = 0;
  for (const value of embedding) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return embedding;

  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / norm;
  }
  return normalized;
}

export function float32ArrayToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function bufferToFloat32Array(buffer: Buffer, dimensions: number): Float32Array {
  if (buffer.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`embedding blob dimension mismatch: expected ${dimensions} floats, got ${buffer.byteLength} bytes`);
  }
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

export function deterministicDocsEmbedding(input: DocsEmbeddingInput): Float32Array {
  const values = new Float32Array(input.dimensions);
  let seed = `${input.model}\n${input.chunk.docPath}\n${input.chunk.sectionAnchor ?? ''}\n${input.chunk.content}`;

  for (let offset = 0; offset < input.dimensions; offset += 8) {
    const digest = createHash('sha256').update(seed).digest();
    for (let i = 0; i < 8 && offset + i < input.dimensions; i++) {
      values[offset + i] = (digest.readUInt32LE(i * 4) / 0xffffffff) * 2 - 1;
    }
    seed = digest.toString('hex');
  }

  return normalizeFloat32Embedding(values, input.dimensions);
}

function writeDocsIndexMetadata(db: Database.Database, metadata: DocsIndexMetadata): void {
  const insert = db.prepare('INSERT INTO docs_index_metadata(key, value) VALUES (?, ?)');
  insert.run('schema_version', String(metadata.schemaVersion));
  insert.run('built_at', metadata.builtAt);
  insert.run('source_count', String(metadata.sourceCount));
  insert.run('chunk_count', String(metadata.chunkCount));
  insert.run('embedding_count', String(metadata.embeddingCount));
  insert.run('embedding_model', metadata.embeddingModel);
  insert.run('embedding_dimensions', String(metadata.embeddingDimensions));
}
