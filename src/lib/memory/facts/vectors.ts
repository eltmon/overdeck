/**
 * Content-hash vector cache for curated memory facts (PAN-5358 FR-11). One
 * global file keyed by sha256 of each fact's embedding text, so the same
 * text reuses its vector across edits, renames, and stores. The dashboard
 * server never imports this module's default embed path at the top level
 * (NFR-1); prompt-time ranking only ever reads the cache (readFactVectors*),
 * never embeds.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfigSync, type NormalizedDocsConfig } from '../../config-yaml.js';
import { bufferToFloat32Array, embedText, float32ArrayToBuffer } from '../../docs/index-builder.js';
import { getOverdeckHome } from '../../paths.js';
import { isActiveFact, readMemoryFactsSync, type MemoryFact, type MemoryFactScope } from './store.js';

export const FACT_VECTOR_REFRESH_TIMEOUT_MS = 30_000;

export type DocsEmbeddingConfig = NormalizedDocsConfig['embedding'];

const CACHE_VERSION = 1;
const FACT_EMBEDDING_TEXT_MAX_CHARS = 2000;

export function factVectorCachePath(): string {
  return join(getOverdeckHome(), 'cache', 'memory-fact-vectors.json');
}

export function factEmbeddingText(fact: MemoryFact): string {
  return [fact.title, fact.description, fact.tags.join(', '), fact.body].join('\n').slice(0, FACT_EMBEDDING_TEXT_MAX_CHARS);
}

export function factContentHash(fact: MemoryFact): string {
  return createHash('sha256').update(factEmbeddingText(fact)).digest('hex');
}

interface FactVectorCacheFile {
  version: number;
  provider: string;
  model: string;
  dimensions: number;
  vectors: Record<string, string>;
}

function isFactVectorCacheFile(value: unknown): value is FactVectorCacheFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === CACHE_VERSION
    && typeof candidate.provider === 'string'
    && typeof candidate.model === 'string'
    && typeof candidate.dimensions === 'number'
    && typeof candidate.vectors === 'object' && candidate.vectors !== null;
}

let memoizedRaw: { key: string; raw: FactVectorCacheFile | null } | null = null;

/** Parses the cache file at most once per `${path}:${mtimeMs}:${size}` (NFR-2). */
function readCacheFileRaw(): FactVectorCacheFile | null {
  const path = factVectorCachePath();
  if (!existsSync(path)) {
    memoizedRaw = { key: `${path}:missing`, raw: null };
    return null;
  }

  const stats = statSync(path);
  const key = `${path}:${stats.mtimeMs}:${stats.size}`;
  if (memoizedRaw && memoizedRaw.key === key) return memoizedRaw.raw;

  let raw: FactVectorCacheFile | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (isFactVectorCacheFile(parsed)) raw = parsed;
  } catch {
    raw = null;
  }
  memoizedRaw = { key, raw };
  return raw;
}

/** Hash → vector, filtered to the given config; empty when the cache is missing, corrupt, or built for a different provider/model/dimensions. */
export async function readFactVectors(config: DocsEmbeddingConfig): Promise<Map<string, Float32Array>> {
  const raw = readCacheFileRaw();
  const map = new Map<string, Float32Array>();
  if (!raw) return map;
  if (raw.provider !== config.provider || raw.model !== config.model || raw.dimensions !== config.dimensions) return map;

  for (const [hash, base64] of Object.entries(raw.vectors)) {
    try {
      map.set(hash, bufferToFloat32Array(Buffer.from(base64, 'base64'), config.dimensions));
    } catch {
      // A corrupt single entry never invalidates the rest of the cache.
    }
  }
  return map;
}

/** fact.file → vector, for the facts that have one. */
export async function readFactVectorsForFacts(
  facts: readonly MemoryFact[],
  config: DocsEmbeddingConfig,
): Promise<Map<string, Float32Array>> {
  const byHash = await readFactVectors(config);
  const byFile = new Map<string, Float32Array>();
  for (const fact of facts) {
    const vector = byHash.get(factContentHash(fact));
    if (vector) byFile.set(fact.file, vector);
  }
  return byFile;
}

async function writeCacheAtomic(file: FactVectorCacheFile): Promise<void> {
  const path = factVectorCachePath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(file), 'utf8');
  await rename(tmpPath, path);
}

/** Embeds only facts whose content hash is missing from the cache; keeps every other entry, never prunes. */
export async function refreshFactVectors(input: {
  facts: readonly MemoryFact[];
  config: DocsEmbeddingConfig;
  embed?: (text: string) => Promise<Float32Array>;
}): Promise<{ embedded: number; reused: number }> {
  const embed = input.embed ?? ((text: string) => embedText(text, input.config));
  const vectors = new Map(await readFactVectors(input.config));

  let embedded = 0;
  let reused = 0;
  for (const fact of input.facts) {
    const hash = factContentHash(fact);
    if (vectors.has(hash)) {
      reused += 1;
      continue;
    }
    vectors.set(hash, await embed(factEmbeddingText(fact)));
    embedded += 1;
  }

  await writeCacheAtomic({
    version: CACHE_VERSION,
    provider: input.config.provider,
    model: input.config.model,
    dimensions: input.config.dimensions,
    vectors: Object.fromEntries(
      Array.from(vectors.entries(), ([hash, vector]) => [hash, float32ArrayToBuffer(vector).toString('base64')]),
    ),
  });

  return { embedded, reused };
}

class FactVectorRefreshTimeoutError extends Error {
  constructor() {
    super('fact vector refresh timed out');
  }
}

/**
 * Reads each store's active facts and refreshes their vectors, bounded by
 * `timeoutMs`. Never throws: any failure (embedding error, timeout, a store
 * read error) comes back as `{ ok: false, reason, timedOut }` so a caller
 * (the CLI, `pan memory reindex`) can report it without failing its own
 * command.
 */
export async function refreshStoreVectorsBestEffort(input: {
  stores: ReadonlyArray<{ dir: string; scope: MemoryFactScope }>;
  config?: DocsEmbeddingConfig;
  refresh?: typeof refreshFactVectors;
  timeoutMs?: number;
}): Promise<{ ok: true; embedded: number; reused: number } | { ok: false; reason: string; timedOut: boolean }> {
  const config = input.config ?? loadConfigSync().config.docs.embedding;
  const refresh = input.refresh ?? refreshFactVectors;
  const timeoutMs = input.timeoutMs ?? FACT_VECTOR_REFRESH_TIMEOUT_MS;

  const facts: MemoryFact[] = [];
  for (const store of input.stores) {
    try {
      const { facts: storeFacts } = readMemoryFactsSync(store.dir, store.scope);
      for (const fact of storeFacts) {
        if (isActiveFact(fact)) facts.push(fact);
      }
    } catch {
      // Best-effort per store: a broken store contributes zero facts.
    }
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      refresh({ facts, config }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new FactVectorRefreshTimeoutError()), timeoutMs);
      }),
    ]);
    return { ok: true, embedded: result.embedded, reused: result.reused };
  } catch (error) {
    const timedOut = error instanceof FactVectorRefreshTimeoutError;
    return {
      ok: false,
      reason: timedOut ? `timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error),
      timedOut,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
