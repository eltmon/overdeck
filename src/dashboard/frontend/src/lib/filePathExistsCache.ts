/**
 * filePathExistsCache (PAN-1457)
 *
 * Module-level LRU cache for the results of the resolveFilePathExists RPC.
 * Used by useFilePathExists to avoid round-tripping the server for the same
 * path during a single session. Chips render to the same set of paths many
 * times across the conversation transcript, so the hit rate is high.
 *
 * Cache policy:
 *   - exists results: 5-minute TTL (paths that resolve rarely disappear)
 *   - missing results: 30-second TTL (the user might create the file)
 *   - 5000-entry cap with LRU eviction (least-recently-used dropped first)
 */

const HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 30 * 1000;
const MAX_ENTRIES = 5000;

export type FilePathExistsKind = 'file' | 'dir' | null;

interface CacheEntry {
  exists: boolean;
  kind: FilePathExistsKind;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(cwd: string, path: string): string {
  return `${cwd}\0${path}`;
}

export function getCachedExists(
  cwd: string,
  path: string,
): { exists: boolean; kind: FilePathExistsKind } | null {
  const key = cacheKey(cwd, path);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // LRU touch: move to end so it's not evicted next.
  cache.delete(key);
  cache.set(key, entry);
  return { exists: entry.exists, kind: entry.kind };
}

export function setCachedExists(
  cwd: string,
  path: string,
  exists: boolean,
  kind: FilePathExistsKind,
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const ttl = exists ? HIT_TTL_MS : MISS_TTL_MS;
  cache.set(cacheKey(cwd, path), {
    exists,
    kind,
    expiresAt: Date.now() + ttl,
  });
}

/** Test helper — clears the cache so tests don't leak state between cases. */
export function _resetFilePathExistsCacheForTests(): void {
  cache.clear();
}
