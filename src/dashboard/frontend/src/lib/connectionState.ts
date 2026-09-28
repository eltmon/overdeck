/**
 * PAN-4279 · the connection store — the single source of truth for "can this
 * tab talk to the server right now, and how fresh is its data".
 *
 * Inputs are written by their owners: the App's `/api/version` poll and
 * EventRouter's `/api/health` probes write `serverReachable`, EventRouter
 * writes `streamLive`, the dashboard-lifecycle selector writes `restarting`,
 * and the snapshot cache / bootstrap write `hasSnapshot` + `lastLiveAt`. The
 * phase is derived, never stored, so it cannot drift from its inputs.
 *
 * Degraded mode (any phase other than `live`) never hides mounted content: the
 * one `DegradedModeBanner` reports it, and a full-page screen appears only when
 * the tab has no snapshot at all (`showFirstLoadScreen`).
 */
import { create } from 'zustand';

export type ConnectionPhase = 'live' | 'delayed' | 'unreachable' | 'restarting';

export interface ConnectionInputs {
  /** The server answers HTTP (reachability rule: see `probeServerHealth`). */
  serverReachable: boolean;
  /** The `/ws/rpc` domain stream has bootstrapped and is not reconnecting. */
  streamLive: boolean;
  /** A planned restart is in progress (`dashboardLifecycle.active`). */
  restarting: boolean;
  /** A cached snapshot was loaded or a bootstrap succeeded. */
  hasSnapshot: boolean;
  /** Epoch ms of the last live data (bootstrap / applied batch, else cache timestamp). */
  lastLiveAt: number | null;
}

interface ConnectionStore extends ConnectionInputs {
  reconnect: (() => void) | null;
  setServerReachable: (v: boolean) => void;
  /** `true` also sets `lastLiveAt = at ?? Date.now()` and `hasSnapshot = true`. */
  setStreamLive: (v: boolean, at?: number) => void;
  setRestarting: (v: boolean) => void;
  /** Records a cached snapshot; `lastLiveAt` keeps any newer live timestamp. */
  markSnapshotCached: (timestamp: number) => void;
  registerReconnect: (fn: (() => void) | null) => void;
  /** Runs the reconnect EventRouter registered, if any. */
  requestReconnect: () => void;
}

export const useConnectionState = create<ConnectionStore>((set, get) => ({
  serverReachable: true,
  streamLive: false,
  restarting: false,
  hasSnapshot: false,
  lastLiveAt: null,
  reconnect: null,
  setServerReachable: (serverReachable) => set({ serverReachable }),
  setStreamLive: (streamLive, at) =>
    set(streamLive ? { streamLive, hasSnapshot: true, lastLiveAt: at ?? Date.now() } : { streamLive }),
  setRestarting: (restarting) => set({ restarting }),
  markSnapshotCached: (timestamp) =>
    set((s) => ({ hasSnapshot: true, lastLiveAt: s.lastLiveAt ?? timestamp })),
  registerReconnect: (reconnect) => set({ reconnect }),
  requestReconnect: () => get().reconnect?.(),
}));

/** Precedence: restarting > unreachable > delayed > live. */
export function deriveConnectionPhase(s: ConnectionInputs): ConnectionPhase {
  if (s.restarting) return 'restarting';
  if (!s.serverReachable) return 'unreachable';
  if (!s.streamLive) return 'delayed';
  return 'live';
}

export function useConnectionPhase(): ConnectionPhase {
  return useConnectionState(deriveConnectionPhase);
}

/** Server writes are blocked when HTTP is down or a restart is in progress; `delayed` still writes. */
export function isWriteBlockedPhase(p: ConnectionPhase): boolean {
  return p === 'unreachable' || p === 'restarting';
}

/** Non-hook read for event handlers. */
export function isServerWriteBlocked(): boolean {
  return isWriteBlockedPhase(deriveConnectionPhase(useConnectionState.getState()));
}

export const OFFLINE_ACTION_REASON = "Can't reach the Overdeck server — available again when it reconnects.";

/** The full-page outage screen renders only when there is nothing cached to show. */
export function showFirstLoadScreen(s: ConnectionInputs): boolean {
  return !s.hasSnapshot && isWriteBlockedPhase(deriveConnectionPhase(s));
}

const HEALTH_PROBE_TIMEOUT_MS = 3_000;

/**
 * Reachable = the response body is JSON with a string `status` field, at any
 * HTTP status: `/api/health` answers 503 + JSON in its "incoherent" states and
 * the server is still up. A network error, a 3 s timeout, or a non-JSON body
 * (a proxy's 502/503/504 HTML page) is unreachable.
 */
export async function probeServerHealth(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  // A controller + setTimeout rather than AbortSignal.timeout: the timeout
  // must be a regular timer so fake-timer tests can drive it.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settle on timeout even if the fetch implementation ignores its signal.
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, HEALTH_PROBE_TIMEOUT_MS);
  });
  const probe = (async () => {
    try {
      const res = await fetchImpl('/api/health', { signal: controller.signal, cache: 'no-store' });
      const body: unknown = await res.json();
      return (
        typeof body === 'object' && body !== null && typeof (body as { status?: unknown }).status === 'string'
      );
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([probe, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
