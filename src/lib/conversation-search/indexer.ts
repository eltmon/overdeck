import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../config-yaml.js';
import { dimensionsForModel, openEmbeddingsDb, type EmbeddingsDbHandle } from '../database/conversation-embeddings-db.js';
import { chunkConversationJsonl, getLastCompleteJsonlOffset, type ConversationChunkRecord } from './chunker.js';
import { createConversationEmbeddingProvider, type ConversationEmbeddingCostEstimate, type ConversationEmbeddingProvider } from './embedding-provider.js';

export interface ConversationIndexerOptions {
  config?: NormalizedConversationSearchConfig;
  db?: EmbeddingsDbHandle;
  provider?: ConversationEmbeddingProvider;
  roots?: string[];
  now?: () => string;
}

export interface IndexConversationFileOptions extends ConversationIndexerOptions {
  filePath: string;
  sessionId?: string;
  projectId?: string;
  fullReindex?: boolean;
  batchSize?: number;
}

export interface ConversationIndexResult {
  filesScanned: number;
  filesIndexed: number;
  chunksIndexed: number;
  chunksSkipped: number;
  errors: Array<{ filePath: string; message: string }>;
  disabled: boolean;
  unavailableReason?: string;
}

const EMPTY_RESULT: ConversationIndexResult = {
  filesScanned: 0,
  filesIndexed: 0,
  chunksIndexed: 0,
  chunksSkipped: 0,
  errors: [],
  disabled: false,
};

const DEFAULT_EMBED_BATCH_SIZE = 64;

export async function indexConversationSearch(
  options: ConversationIndexerOptions = {},
): Promise<ConversationIndexResult> {
  const config = options.config ?? getConversationSearchConfigSync();
  if (!config.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: 'conversationSearch is disabled' };

  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots());
  const result: ConversationIndexResult = { ...EMPTY_RESULT, filesScanned: files.length, errors: [] };

  const owned = openIndexerResources(config, options);
  if (!owned.db.available) {
    owned.close();
    return { ...result, disabled: true, unavailableReason: owned.db.unavailableReason ?? 'embeddings DB unavailable' };
  }

  try {
    for (const filePath of files) {
      const fileResult = await indexConversationFile({ ...options, config, db: owned.db, provider: owned.provider, filePath });
      result.filesIndexed += fileResult.filesIndexed;
      result.chunksIndexed += fileResult.chunksIndexed;
      result.chunksSkipped += fileResult.chunksSkipped;
      result.errors.push(...fileResult.errors);
    }
  } finally {
    owned.close();
  }

  return result;
}

export async function fullReindexConversationSearch(
  options: ConversationIndexerOptions = {},
): Promise<ConversationIndexResult> {
  const config = options.config ?? getConversationSearchConfigSync();
  if (!config.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: 'conversationSearch is disabled' };

  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots());
  const db = options.db ?? openEmbeddingsDb(config.dbPath, dimensionsForModel(config.model));
  try {
    if (!db.available) {
      return {
        ...EMPTY_RESULT,
        filesScanned: files.length,
        disabled: true,
        unavailableReason: db.unavailableReason ?? 'embeddings DB unavailable',
      };
    }
    for (const filePath of files) db.setCursor(filePath, 0);
  } finally {
    if (!options.db) db.close();
  }
  return indexConversationSearch(options);
}

export interface ConversationReindexCostEstimate extends ConversationEmbeddingCostEstimate {
  filesScanned: number;
  chunksEstimated: number;
  disabled: boolean;
  unavailableReason?: string;
}

export async function estimateFullReindexConversationSearchCost(
  options: ConversationIndexerOptions = {},
): Promise<ConversationReindexCostEstimate> {
  const config = options.config ?? getConversationSearchConfigSync();
  const provider = options.provider ?? createConversationEmbeddingProvider({ config });
  const empty = provider.estimateCost([]);
  if (!config.enabled) {
    return { ...empty, filesScanned: 0, chunksEstimated: 0, disabled: true, unavailableReason: 'conversationSearch is disabled' };
  }

  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots());
  let tokenCount = 0;
  let estimatedUsd = 0;
  let chunksEstimated = 0;
  for (const filePath of files) {
    for await (const chunk of chunkConversationJsonl({
      filePath,
      sessionId: sessionIdFromPath(filePath),
      projectId: projectIdFromPath(filePath),
      fromOffset: 0,
    })) {
      const estimate = provider.estimateCost([chunk.text]);
      tokenCount += estimate.tokenCount;
      estimatedUsd += estimate.estimatedUsd;
      chunksEstimated += 1;
    }
  }
  return { ...empty, tokenCount, estimatedUsd, filesScanned: files.length, chunksEstimated, disabled: false };
}

export async function indexConversationFile(
  options: IndexConversationFileOptions,
): Promise<ConversationIndexResult> {
  const config = options.config ?? getConversationSearchConfigSync();
  if (!config.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: 'conversationSearch is disabled' };

  const owned = openIndexerResources(config, options);
  const result: ConversationIndexResult = { ...EMPTY_RESULT, filesScanned: 1, errors: [] };
  if (!owned.db.available) {
    owned.close();
    return { ...result, disabled: true, unavailableReason: owned.db.unavailableReason ?? 'embeddings DB unavailable' };
  }

  try {
    const stat = await fs.stat(options.filePath);
    const fromOffset = options.fullReindex ? 0 : owned.db.getCursor(options.filePath);
    if (fromOffset >= stat.size) {
      result.chunksSkipped += 1;
      return result;
    }

    const lastCompleteOffset = await getLastCompleteJsonlOffset(options.filePath, fromOffset, stat.size);
    if (lastCompleteOffset <= fromOffset) {
      result.chunksSkipped += 1;
      return result;
    }

    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_EMBED_BATCH_SIZE);
    let batch: ConversationChunkRecord[] = [];
    for await (const chunk of chunkConversationJsonl({
      filePath: options.filePath,
      sessionId: options.sessionId ?? sessionIdFromPath(options.filePath),
      projectId: options.projectId ?? projectIdFromPath(options.filePath),
      fromOffset,
      toOffset: stat.size,
    })) {
      batch.push(chunk);
      if (batch.length >= batchSize) {
        await indexBatch({ batch, db: owned.db, provider: owned.provider, filePath: options.filePath, now: options.now, result });
        batch = [];
      }
    }

    if (batch.length > 0) {
      await indexBatch({ batch, db: owned.db, provider: owned.provider, filePath: options.filePath, now: options.now, result });
    }

    if (result.chunksIndexed === 0) {
      result.chunksSkipped += 1;
    }
    owned.db.setCursor(options.filePath, lastCompleteOffset);
    result.filesIndexed = result.chunksIndexed > 0 ? 1 : 0;
    return result;
  } catch (error) {
    result.errors.push({ filePath: options.filePath, message: error instanceof Error ? error.message : String(error) });
    return result;
  } finally {
    owned.close();
  }
}

async function indexBatch(input: {
  batch: ConversationChunkRecord[];
  db: EmbeddingsDbHandle;
  provider: ConversationEmbeddingProvider;
  filePath: string;
  now?: () => string;
  result: ConversationIndexResult;
}): Promise<void> {
  const embedded = await input.provider.embed(input.batch.map((chunk) => chunk.text));
  const indexedAt = input.now?.() ?? new Date().toISOString();
  input.batch.forEach((chunk, index) => {
    const { sourceLineEndOffset: _sourceLineEndOffset, ...insert } = chunk;
    const rowid = input.db.upsertChunk({ ...insert, indexedAt });
    const embedding = embedded.embeddings[index];
    if (embedding) input.db.upsertEmbedding(rowid, embedding);
  });
  const lastBatchOffset = Math.max(...input.batch.map((chunk) => chunk.sourceLineEndOffset));
  input.db.setCursor(input.filePath, lastBatchOffset);
  input.result.chunksIndexed += input.batch.length;
}

async function discoverConversationJsonlFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) await collectJsonlFiles(root, files);
  return files.sort();
}

async function collectJsonlFiles(dir: string, files: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(path, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
}

function openIndexerResources(config: NormalizedConversationSearchConfig, options: ConversationIndexerOptions) {
  const db = options.db ?? openEmbeddingsDb(config.dbPath, dimensionsForModel(config.model));
  const provider = options.provider ?? createConversationEmbeddingProvider({ config });
  return {
    db,
    provider,
    close: () => {
      if (!options.db) db.close();
    },
  };
}

function defaultConversationRoots(): string[] {
  return [join(homedir(), '.claude', 'projects')];
}

function sessionIdFromPath(filePath: string): string {
  return basename(filePath).replace(/\.jsonl$/, '');
}

function projectIdFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]+/);
  const projectsIndex = parts.lastIndexOf('projects');
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) return parts[projectsIndex + 1]!;
  return 'unknown';
}
