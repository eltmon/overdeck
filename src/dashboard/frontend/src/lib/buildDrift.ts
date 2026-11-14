/**
 * PAN-5236 — does this tab run older frontend code than its server?
 * Bundle commit: __OVERDECK_FRONTEND_BUILD_COMMIT__ (vite.config.ts, build only).
 * Server commit: GET /api/health `buildCommit`, fetched on each stream rising
 * edge of the connection store — never polled.
 */
import { create } from 'zustand';
import { useConnectionState } from './connectionState';

declare const __OVERDECK_FRONTEND_BUILD_COMMIT__: string | null | undefined;

export function bundleBuildCommit(): string | null {
  return typeof __OVERDECK_FRONTEND_BUILD_COMMIT__ === 'string' && __OVERDECK_FRONTEND_BUILD_COMMIT__.length > 0
    ? __OVERDECK_FRONTEND_BUILD_COMMIT__
    : null;
}

export function isBuildDrift(bundle: string | null, server: string | null): boolean {
  return bundle !== null && server !== null && bundle.length > 0 && server.length > 0 && bundle !== server;
}

export const BUILD_DRIFT_FETCH_TIMEOUT_MS = 3_000;

export async function fetchServerBuildCommit(
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; commit: string | null } | { ok: false }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false });
    }, BUILD_DRIFT_FETCH_TIMEOUT_MS);
  });
  const probe = (async (): Promise<{ ok: true; commit: string | null } | { ok: false }> => {
    try {
      const res = await fetchImpl('/api/health', { signal: controller.signal, cache: 'no-store' });
      const body: unknown = await res.json();
      if (typeof body !== 'object' || body === null) return { ok: false };
      const commit = (body as { buildCommit?: unknown }).buildCommit;
      return { ok: true, commit: typeof commit === 'string' && commit.length > 0 ? commit : null };
    } catch {
      return { ok: false };
    }
  })();
  try {
    return await Promise.race([probe, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

interface BuildDriftStore {
  serverCommit: string | null;
  setServerCommit: (commit: string | null) => void;
}

export const useBuildDrift = create<BuildDriftStore>((set) => ({
  serverCommit: null,
  setServerCommit: (serverCommit) => set({ serverCommit }),
}));

export const RELOADED_FOR_KEY = 'overdeck.build-drift.reloaded-for';

export function markReloadedFor(serverCommit: string): void {
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, serverCommit);
  } catch {
    // Storage unavailable
  }
}

export function reloadAlreadyTriedFor(serverCommit: string | null): boolean {
  if (serverCommit === null) return false;
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY) === serverCommit;
  } catch {
    return false;
  }
}

export function startBuildDriftWatch(fetchImpl: typeof fetch = fetch): () => void {
  let disposed = false;
  let inFlight = false;
  let pending = false;

  const check = async () => {
    if (disposed) return;
    if (inFlight) {
      // A rising edge arrived mid-check: run once more right after this one
      // finishes, so that edge's reconnect is not silently dropped.
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const result = await fetchServerBuildCommit(fetchImpl);
      if (disposed) return;
      if (result.ok) {
        useBuildDrift.getState().setServerCommit(result.commit);
      }
    } finally {
      inFlight = false;
      if (pending && !disposed) {
        pending = false;
        void check();
      }
    }
  };

  if (useConnectionState.getState().streamLive) {
    void check();
  }

  const unsubscribe = useConnectionState.subscribe((s, prev) => {
    if (s.streamLive && !prev.streamLive) void check();
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}
