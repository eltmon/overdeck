import { openDatabase, type SqliteDatabase } from '../database/driver.js';
import { mkdir, readFile, rename, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

import type { DocsEmbeddingProvider, NormalizedDocsConfig } from '../config-yaml.js';
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
  provider: DocsEmbeddingProvider;
}

export interface DocsEmbeddingOutput {
  embedding: Float32Array;
  provider?: DocsEmbeddingProvider;
  model?: string;
}

export type DocsEmbeddingFunction =
  (input: DocsEmbeddingInput) => Promise<Float32Array | DocsEmbeddingOutput> | Float32Array | DocsEmbeddingOutput;

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
  embeddingProvider: DocsEmbeddingProvider;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface DocsIndexMetadata {
  schemaVersion: number;
  builtAt: string;
  sourceCount: number;
  chunkCount: number;
  embeddingCount: number;
  embeddingProvider: DocsEmbeddingProvider;
  embeddingModel: string;
  embeddingDimensions: number;
}

interface BuildConfig {
  corpus: NormalizedDocsConfig['corpus'];
  embedding: NormalizedDocsConfig['embedding'];
}

const DEFAULT_CONFIG = getDefaultDocsConfig();
const LOCAL_GTE_SMALL_MODEL_ID = 'Xenova/gte-small';

type FeatureExtractionPipeline = (text: string, options: { pooling: 'mean'; normalize: boolean }) => Promise<{
  data: Float32Array | number[];
}>;

const localEmbeddingPipelines = new Map<string, Promise<FeatureExtractionPipeline>>();

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
  const embeddingFn = options.embeddingFn ?? createDocsEmbeddingFunction(config.embedding);
  const outputDir = dirname(outputPath);
  const buildDir = join(outputDir, '..', '.pan-docs-index-tmp');
  const buildPath = join(buildDir, `docs-index.${process.pid}.${Date.now()}.tmp.sqlite`);
  let embeddingProvider: DocsEmbeddingProvider = config.embedding.provider;
  let embeddingModel = config.embedding.model;

  await mkdir(outputDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await removeSqliteFiles(buildPath);

  const db = openDatabase(buildPath);
  let sourceCount = 0;
  let chunkCount = 0;
  let embeddingCount = 0;
  let buildFailed = false;

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
      const output = await embeddingFn({
        chunk,
        dimensions: config.embedding.dimensions,
        model: config.embedding.model,
        provider: config.embedding.provider,
      });
      const resolved = resolveDocsEmbeddingOutput(output);
      embeddingProvider = resolved.provider ?? embeddingProvider;
      embeddingModel = resolved.model ?? embeddingModel;
      items.push({ chunk, embedding: normalizeFloat32Embedding(resolved.embedding, config.embedding.dimensions) });
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
      embeddingProvider,
      embeddingModel,
      embeddingDimensions: config.embedding.dimensions,
    });
  } catch (error) {
    buildFailed = true;
    throw error;
  } finally {
    db.close();
    if (buildFailed) await removeSqliteFiles(buildPath);
  }

  try {
    const sizeBytes = (await stat(buildPath)).size;
    if (sizeBytes > maxIndexBytes) {
      throw new Error(`docs index ${outputPath} is ${sizeBytes} bytes, exceeding budget ${maxIndexBytes} bytes`);
    }

    await mkdir(outputDir, { recursive: true });
    await rename(buildPath, outputPath);
    await removeSqliteFiles(buildPath);

    return {
      outputPath,
      sourceCount,
      chunkCount,
      embeddingCount,
      sizeBytes,
      builtAt,
      embeddingProvider,
      embeddingModel,
      embeddingDimensions: config.embedding.dimensions,
    };
  } catch (error) {
    await removeSqliteFiles(buildPath);
    throw error;
  }
}

export function createDocsIndexSchema(db: SqliteDatabase): void {
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

export function readDocsIndexMetadata(db: SqliteDatabase): DocsIndexMetadata {
  const rows = db.prepare('SELECT key, value FROM docs_index_metadata').all() as Array<{ key: string; value: string }>;
  const metadata = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    schemaVersion: Number(metadata.schema_version),
    builtAt: metadata.built_at,
    sourceCount: Number(metadata.source_count),
    chunkCount: Number(metadata.chunk_count),
    embeddingCount: Number(metadata.embedding_count),
    embeddingProvider: metadata.embedding_provider as DocsEmbeddingProvider,
    embeddingModel: metadata.embedding_model,
    embeddingDimensions: Number(metadata.embedding_dimensions),
  };
}

export function validateDocsIndex(db: SqliteDatabase): DocsIndexMetadata {
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

export function createDocsEmbeddingFunction(config: NormalizedDocsConfig['embedding']): DocsEmbeddingFunction {
  switch (config.provider) {
    case 'local': return embedDocsWithLocalModel;
    case 'openai': return embedDocsWithOpenAI;
  }
}

export async function embedDocsWithLocalModel(input: DocsEmbeddingInput): Promise<DocsEmbeddingOutput> {
  const modelId = input.model === 'gte-small' ? LOCAL_GTE_SMALL_MODEL_ID : input.model;
  const extractor = await getLocalEmbeddingPipeline(modelId);
  const output = await extractor(input.chunk.content, { pooling: 'mean', normalize: true });
  return {
    embedding: output.data instanceof Float32Array ? output.data : new Float32Array(output.data),
    provider: 'local',
    model: input.model,
  };
}

export async function embedDocsWithOpenAI(input: DocsEmbeddingInput): Promise<DocsEmbeddingOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to build docs embeddings with provider openai');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      input: input.chunk.content,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI docs embedding request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[]; model?: string }> };
  return {
    embedding: new Float32Array(data.data[0].embedding),
    provider: 'openai',
    model: input.model,
  };
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

export function bufferToFloat32Array(buffer: Uint8Array, dimensions: number): Float32Array {
  if (buffer.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`embedding blob dimension mismatch: expected ${dimensions} floats, got ${buffer.byteLength} bytes`);
  }
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

export function deterministicDocsTestEmbedding(input: DocsEmbeddingInput): Float32Array {
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

function resolveDocsEmbeddingOutput(output: Float32Array | DocsEmbeddingOutput): DocsEmbeddingOutput {
  return output instanceof Float32Array ? { embedding: output } : output;
}

async function removeSqliteFiles(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-wal`, { force: true }),
  ]);
}

async function getLocalEmbeddingPipeline(modelId: string): Promise<FeatureExtractionPipeline> {
  const cached = localEmbeddingPipelines.get(modelId);
  if (cached) return cached;

  const pipelinePromise = import('@xenova/transformers')
    .then(({ pipeline }) => pipeline('feature-extraction', modelId))
    .then((pipeline) => pipeline as FeatureExtractionPipeline);
  localEmbeddingPipelines.set(modelId, pipelinePromise);
  return pipelinePromise;
}

function writeDocsIndexMetadata(db: SqliteDatabase, metadata: DocsIndexMetadata): void {
  const insert = db.prepare('INSERT INTO docs_index_metadata(key, value) VALUES (?, ?)');
  insert.run('schema_version', String(metadata.schemaVersion));
  insert.run('built_at', metadata.builtAt);
  insert.run('source_count', String(metadata.sourceCount));
  insert.run('chunk_count', String(metadata.chunkCount));
  insert.run('embedding_count', String(metadata.embeddingCount));
  insert.run('embedding_provider', metadata.embeddingProvider);
  insert.run('embedding_model', metadata.embeddingModel);
  insert.run('embedding_dimensions', String(metadata.embeddingDimensions));
}
