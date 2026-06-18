import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { getConversationSearchConfigSync, type NormalizedConversationSearchConfig } from '../config-yaml.js';
import { dimensionsForModel, openEmbeddingsDb, type EmbeddingsDbHandle } from '../overdeck/conversations-search.js';
import { chunkConversationJsonl, getLastCompleteJsonlOffset, type ConversationChunkRecord } from './chunker.js';
import { createConversationEmbeddingProvider, type ConversationEmbeddingCostEstimate, type ConversationEmbeddingProvider } from './embedding-provider.js';

export interface ConversationIndexProgress {
  filesScanned: number;
  filesIndexed: number;
  chunksIndexed: number;
  currentFile?: string;
}

export interface ConversationIndexerOptions {
  config?: NormalizedConversationSearchConfig;
  db?: EmbeddingsDbHandle;
  provider?: ConversationEmbeddingProvider;
  roots?: string[];
  now?: () => string;
  signal?: AbortSignal;
  /** Invoked once per file (before it is embedded) and once at completion, for live progress UIs. */
  onProgress?: (progress: ConversationIndexProgress) => void;
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
  const provider = options.provider ?? createConversationEmbeddingProvider({ config });
  if (!provider.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: provider.unavailableReason ?? 'embedding provider unavailable' };

  throwIfAborted(options.signal);
  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots(), options.signal);
  const result: ConversationIndexResult = { ...EMPTY_RESULT, filesScanned: files.length, errors: [] };

  const owned = openIndexerResources(config, { ...options, provider });
  if (!owned.db.available) {
    owned.close();
    return { ...result, disabled: true, unavailableReason: owned.db.unavailableReason ?? 'embeddings DB unavailable' };
  }

  try {
    let processed = 0;
    for (const filePath of files) {
      throwIfAborted(options.signal);
      options.onProgress?.({ filesScanned: files.length, filesIndexed: processed, chunksIndexed: result.chunksIndexed, currentFile: basename(filePath) });
      const fileResult = await indexConversationFile({ ...options, config, db: owned.db, provider: owned.provider, filePath });
      result.filesIndexed += fileResult.filesIndexed;
      result.chunksIndexed += fileResult.chunksIndexed;
      result.chunksSkipped += fileResult.chunksSkipped;
      result.errors.push(...fileResult.errors);
      processed += 1;
    }
    options.onProgress?.({ filesScanned: files.length, filesIndexed: processed, chunksIndexed: result.chunksIndexed });
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
  const provider = options.provider ?? createConversationEmbeddingProvider({ config });
  if (!provider.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: provider.unavailableReason ?? 'embedding provider unavailable' };

  throwIfAborted(options.signal);
  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots(), options.signal);
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
    for (const filePath of files) {
      throwIfAborted(options.signal);
      db.setCursor(filePath, 0);
    }
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
  if (!provider.enabled) {
    return { ...empty, filesScanned: 0, chunksEstimated: 0, disabled: true, unavailableReason: provider.unavailableReason ?? 'embedding provider unavailable' };
  }

  throwIfAborted(options.signal);
  const files = await discoverConversationJsonlFiles(options.roots ?? defaultConversationRoots(), options.signal);
  let tokenCount = 0;
  let estimatedUsd = 0;
  let chunksEstimated = 0;
  let filesScanned = 0;
  for (const filePath of files) {
    try {
      for await (const chunk of chunkConversationJsonl({
        filePath,
        sessionId: sessionIdFromPath(filePath),
        projectId: projectIdFromPath(filePath),
        fromOffset: 0,
        signal: options.signal,
      })) {
        const estimate = provider.estimateCost([chunk.text]);
        tokenCount += estimate.tokenCount;
        estimatedUsd += estimate.estimatedUsd;
        chunksEstimated += 1;
      }
      filesScanned += 1;
    } catch {
      // Skip files that fail to parse (malformed JSONL, permission errors, etc.)
    }
  }
  return { ...empty, tokenCount, estimatedUsd, filesScanned, chunksEstimated, disabled: false };
}

export async function indexConversationFile(
  options: IndexConversationFileOptions,
): Promise<ConversationIndexResult> {
  const config = options.config ?? getConversationSearchConfigSync();
  if (!config.enabled) return { ...EMPTY_RESULT, disabled: true, unavailableReason: 'conversationSearch is disabled' };

  const owned = openIndexerResources(config, options);
  const result: ConversationIndexResult = { ...EMPTY_RESULT, filesScanned: 1, errors: [] };
  if (!owned.provider.enabled) {
    owned.close();
    return { ...result, disabled: true, unavailableReason: owned.provider.unavailableReason ?? 'embedding provider unavailable' };
  }
  if (!owned.db.available) {
    owned.close();
    return { ...result, disabled: true, unavailableReason: owned.db.unavailableReason ?? 'embeddings DB unavailable' };
  }

  try {
    throwIfAborted(options.signal);
    const stat = await fs.stat(options.filePath);
    const fromOffset = options.fullReindex ? 0 : owned.db.getCursor(options.filePath);
    if (fromOffset >= stat.size) {
      result.chunksSkipped += 1;
      return result;
    }

    const lastCompleteOffset = await getLastCompleteJsonlOffset(options.filePath, fromOffset, stat.size, options.signal);
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
      signal: options.signal,
    })) {
      batch.push(chunk);
      if (batch.length >= batchSize) {
        throwIfAborted(options.signal);
        await indexBatch({ batch, db: owned.db, provider: owned.provider, filePath: options.filePath, now: options.now, result, signal: options.signal });
        batch = [];
      }
    }

    if (batch.length > 0) {
      throwIfAborted(options.signal);
      await indexBatch({ batch, db: owned.db, provider: owned.provider, filePath: options.filePath, now: options.now, result, signal: options.signal });
    }

    if (result.chunksIndexed === 0) {
      result.chunksSkipped += 1;
    }
    owned.db.setCursor(options.filePath, lastCompleteOffset);
    result.filesIndexed = result.chunksIndexed > 0 ? 1 : 0;
    return result;
  } catch (error) {
    if (isAbortError(error)) throw error;
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
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  const texts = input.batch.map((chunk) => chunk.text);
  const embedded = input.signal ? await input.provider.embed(texts, { signal: input.signal }) : await input.provider.embed(texts);
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

async function discoverConversationJsonlFiles(roots: string[], signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) await collectJsonlFiles(root, files, signal);
  return files.sort();
}

async function collectJsonlFiles(dir: string, files: string[], signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    throwIfAborted(signal);
    if (entry.isDirectory()) await collectJsonlFiles(path, files, signal);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error('Conversation search indexing aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
