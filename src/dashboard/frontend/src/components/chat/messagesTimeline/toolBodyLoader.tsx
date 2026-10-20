import { createContext, useContext, useEffect, useState } from 'react';
import { fetchWithTimeout } from '../../../lib/apiFetch';
import type { WorkLogEntry } from '../chat-types';

// ─── Omitted tool bodies (PAN-4558) ──────────────────────────────────────────
//
// The server replaces large tool results with a size hint (`resultBytes`,
// `bodyOmitted`). Expanding such a row fetches the full entry from the
// tool-body route of whichever transcript the timeline shows.

export interface ToolBodyLoader {
  /** Distinguishes transcripts so one entry id never resolves against another transcript. */
  key: string;
  load: (entryId: string) => Promise<WorkLogEntry>;
}

export const ToolBodyLoaderContext = createContext<ToolBodyLoader | null>(null);

/** A loader for `<basePath>/<toolUseId><query>`, the conversations or agents tool-body route. */
export function toolBodyLoaderFor(basePath: string, query = ''): ToolBodyLoader {
  return {
    key: `${basePath}${query}`,
    load: async (entryId) => {
      const response = await fetchWithTimeout(`${basePath}/${encodeURIComponent(entryId)}${query}`);
      if (!response.ok) throw new Error(`Failed to load tool output (${response.status})`);
      return (await response.json() as { entry: WorkLogEntry }).entry;
    },
  };
}

const TOOL_BODY_CACHE_MAX = 50;
const toolBodyCache = new Map<string, Promise<WorkLogEntry>>();

function loadCached(loader: ToolBodyLoader, entryId: string): Promise<WorkLogEntry> {
  const cacheKey = `${loader.key}\u0000${entryId}`;
  const cached = toolBodyCache.get(cacheKey);
  if (cached) return cached;
  const request = loader.load(entryId);
  request.catch(() => toolBodyCache.delete(cacheKey));
  toolBodyCache.set(cacheKey, request);
  if (toolBodyCache.size > TOOL_BODY_CACHE_MAX) {
    const oldest = toolBodyCache.keys().next().value;
    if (oldest !== undefined) toolBodyCache.delete(oldest);
  }
  return request;
}

/** Test seam: forget fetched bodies between tests. */
export function clearToolBodyCacheForTests(): void {
  toolBodyCache.clear();
}

type ToolBodyState = { id: string; status: 'loading' } | { id: string; status: 'loaded'; entry: WorkLogEntry } | { id: string; status: 'error' };

/**
 * The entry to render: the full body once an expanded `bodyOmitted` row has
 * loaded it, otherwise the row's own entry.
 */
export function useToolBody(entry: WorkLogEntry, expanded: boolean): { entry: WorkLogEntry; loading: boolean; failed: boolean } {
  const loader = useContext(ToolBodyLoaderContext);
  const needed = expanded && entry.bodyOmitted === true && loader !== null;
  const [state, setState] = useState<ToolBodyState | null>(null);

  useEffect(() => {
    if (!needed || !loader) return;
    let cancelled = false;
    setState((previous) => (previous?.id === entry.id && previous.status === 'loaded' ? previous : { id: entry.id, status: 'loading' }));
    loadCached(loader, entry.id).then(
      (full) => { if (!cancelled) setState({ id: entry.id, status: 'loaded', entry: full }); },
      () => { if (!cancelled) setState({ id: entry.id, status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [needed, loader, entry.id]);

  const current = needed && state?.id === entry.id ? state : null;
  return {
    entry: current?.status === 'loaded' ? current.entry : entry,
    loading: needed && (current === null || current.status === 'loading'),
    failed: current?.status === 'error',
  };
}
