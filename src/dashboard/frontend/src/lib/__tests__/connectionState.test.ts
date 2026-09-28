import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveConnectionPhase,
  isServerWriteBlocked,
  isWriteBlockedPhase,
  probeServerHealth,
  showFirstLoadScreen,
  useConnectionState,
  type ConnectionInputs,
} from '../connectionState';

const base: ConnectionInputs = {
  serverReachable: true,
  streamLive: true,
  restarting: false,
  hasSnapshot: true,
  lastLiveAt: 1,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('deriveConnectionPhase', () => {
  it('is live when reachable and the stream is live', () => {
    expect(deriveConnectionPhase(base)).toBe('live');
  });

  it('is delayed when reachable but the stream is not live', () => {
    expect(deriveConnectionPhase({ ...base, streamLive: false })).toBe('delayed');
  });

  it('is unreachable when the server does not answer and no restart is running', () => {
    expect(deriveConnectionPhase({ ...base, serverReachable: false, restarting: false })).toBe('unreachable');
  });

  it('is restarting during a planned restart', () => {
    expect(deriveConnectionPhase({ ...base, restarting: true })).toBe('restarting');
  });

  it('prefers restarting over unreachable', () => {
    expect(deriveConnectionPhase({ ...base, serverReachable: false, restarting: true })).toBe('restarting');
  });
});

describe('write blocking', () => {
  beforeEach(() => {
    useConnectionState.setState({ ...base });
  });

  it('blocks writes only while unreachable or restarting', () => {
    expect(isWriteBlockedPhase('live')).toBe(false);
    expect(isWriteBlockedPhase('delayed')).toBe(false);
    expect(isWriteBlockedPhase('unreachable')).toBe(true);
    expect(isWriteBlockedPhase('restarting')).toBe(true);
  });

  it('reads the current store phase outside React', () => {
    expect(isServerWriteBlocked()).toBe(false);
    useConnectionState.getState().setServerReachable(false);
    expect(isServerWriteBlocked()).toBe(true);
  });
});

describe('store setters', () => {
  beforeEach(() => {
    useConnectionState.setState({
      serverReachable: true,
      streamLive: false,
      restarting: false,
      hasSnapshot: false,
      lastLiveAt: null,
      reconnect: null,
    });
  });

  it('setStreamLive(true) records the snapshot and freshness time', () => {
    useConnectionState.getState().setStreamLive(true, 5000);
    const s = useConnectionState.getState();
    expect(s.streamLive).toBe(true);
    expect(s.hasSnapshot).toBe(true);
    expect(s.lastLiveAt).toBe(5000);
    useConnectionState.getState().setStreamLive(false);
    expect(useConnectionState.getState().lastLiveAt).toBe(5000);
  });

  it('markSnapshotCached does not overwrite a live timestamp', () => {
    useConnectionState.getState().markSnapshotCached(100);
    expect(useConnectionState.getState()).toMatchObject({ hasSnapshot: true, lastLiveAt: 100 });
    useConnectionState.getState().setStreamLive(true, 900);
    useConnectionState.getState().markSnapshotCached(200);
    expect(useConnectionState.getState().lastLiveAt).toBe(900);
  });

  it('requestReconnect calls the registered function', () => {
    const fn = vi.fn();
    useConnectionState.getState().requestReconnect();
    useConnectionState.getState().registerReconnect(fn);
    useConnectionState.getState().requestReconnect();
    expect(fn).toHaveBeenCalledTimes(1);
    useConnectionState.getState().registerReconnect(null);
    useConnectionState.getState().requestReconnect();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('showFirstLoadScreen', () => {
  it('is false whenever a snapshot exists', () => {
    expect(showFirstLoadScreen({ ...base, serverReachable: false })).toBe(false);
    expect(showFirstLoadScreen({ ...base, restarting: true })).toBe(false);
    expect(showFirstLoadScreen({ ...base, streamLive: false })).toBe(false);
  });

  it('is true without a snapshot while unreachable or restarting', () => {
    expect(showFirstLoadScreen({ ...base, hasSnapshot: false, serverReachable: false })).toBe(true);
    expect(showFirstLoadScreen({ ...base, hasSnapshot: false, restarting: true })).toBe(true);
  });

  it('is false without a snapshot while live or delayed', () => {
    expect(showFirstLoadScreen({ ...base, hasSnapshot: false })).toBe(false);
    expect(showFirstLoadScreen({ ...base, hasSnapshot: false, streamLive: false })).toBe(false);
  });
});

describe('probeServerHealth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is reachable for a 200 JSON health body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 'ok' }));
    await expect(probeServerHealth(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal: expect.anything() }));
  });

  it('is reachable for a 503 JSON body in an incoherent state', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { status: 'incoherent' }));
    await expect(probeServerHealth(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
  });

  it('is unreachable for a 502 HTML proxy error page', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html><body>Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(probeServerHealth(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('is unreachable for JSON without a string status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 1 }));
    await expect(probeServerHealth(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('is unreachable when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(probeServerHealth(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('is unreachable after 3000 ms when fetch never settles', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    let settled: boolean | undefined;
    void probeServerHealth(fetchImpl as unknown as typeof fetch).then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
  });
});
