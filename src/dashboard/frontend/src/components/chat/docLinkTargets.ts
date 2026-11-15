/**
 * The existence cache behind a Markdown preview's document-relative links
 * (PAN-5337, WI-3, D5).
 *
 * A preview with many links to the same folder must send one `listDir` per
 * folder, not one per link: the module-level cache below is keyed by
 * `rootId + '\0' + parentDir` and holds the in-flight or settled promise for
 * 10 seconds, so concurrently mounting links for the same folder share it.
 */

import { listDir } from '../explorer/explorer-rpc';
import { docDirOf } from '../../lib/markdownDocLinks';
import { useEffect, useState } from 'react';
import type { ExplorerListDirResult } from '@overdeck/contracts';

export type DocLinkTargetState = 'loading' | 'file' | 'dir' | 'missing' | 'unknown';

const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  promise: Promise<ExplorerListDirResult>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(rootId: string, parentDir: string): string {
  return `${rootId}\0${parentDir}`;
}

function listDirCached(rootId: string, parentDir: string): Promise<ExplorerListDirResult> {
  const key = cacheKey(rootId, parentDir);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.timestamp < CACHE_TTL_MS) return existing.promise;
  const promise = listDir(rootId, parentDir);
  cache.set(key, { promise, timestamp: Date.now() });
  return promise;
}

function stateFromListing(path: string, result: ExplorerListDirResult): DocLinkTargetState {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const entry = result.entries.find((candidate) => candidate.path === path || candidate.name === basename);
  if (entry) return entry.kind === 'dir' ? 'dir' : 'file';
  return result.truncated ? 'unknown' : 'missing';
}

/** Clears the cache; tests only. */
export function clearDocLinkTargetCache(): void {
  cache.clear();
}

/** Whether `path` (root-relative, inside `rootId`) is a file, a folder, or missing. */
export function useDocLinkTarget(rootId: string, path: string): DocLinkTargetState {
  const [state, setState] = useState<DocLinkTargetState>(() => (path === '' ? 'dir' : 'loading'));

  useEffect(() => {
    if (path === '') {
      setState('dir');
      return;
    }
    setState('loading');
    let cancelled = false;
    void listDirCached(rootId, docDirOf(path))
      .then((result) => {
        if (!cancelled) setState(stateFromListing(path, result));
      })
      .catch(() => {
        if (!cancelled) setState('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [rootId, path]);

  return state;
}
