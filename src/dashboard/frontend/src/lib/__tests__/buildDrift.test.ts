import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RELOADED_FOR_KEY,
  fetchServerBuildCommit,
  isBuildDrift,
  markReloadedFor,
  reloadAlreadyTriedFor,
  startBuildDriftWatch,
  useBuildDrift,
} from '../buildDrift';
import { useConnectionState } from '../connectionState';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  useConnectionState.setState({ streamLive: false });
  useBuildDrift.setState({ serverCommit: null });
  sessionStorage.clear();
});

describe('isBuildDrift', () => {
  it('is true only for two different non-empty commits', () => {
    expect(isBuildDrift('a', 'b')).toBe(true);
    expect(isBuildDrift('a', 'a')).toBe(false);
    expect(isBuildDrift(null, 'b')).toBe(false);
    expect(isBuildDrift('a', null)).toBe(false);
    expect(isBuildDrift('', 'b')).toBe(false);
  });
});

describe('fetchServerBuildCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves ok with the commit when present', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', buildCommit: 'abc' }));
    await expect(fetchServerBuildCommit(fetchImpl)).resolves.toEqual({ ok: true, commit: 'abc' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
  });

  it('resolves ok with a null commit when the body omits buildCommit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }));
    await expect(fetchServerBuildCommit(fetchImpl)).resolves.toEqual({ ok: true, commit: null });
  });

  it('resolves not-ok when the fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(fetchServerBuildCommit(fetchImpl)).resolves.toEqual({ ok: false });
  });

  it('resolves not-ok after the timeout when the fetch never settles', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const result = fetchServerBuildCommit(fetchImpl);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toEqual({ ok: false });
  });
});

describe('startBuildDriftWatch', () => {
  it('does not fetch while streamLive stays false', () => {
    const fetchImpl = vi.fn();
    const stop = startBuildDriftWatch(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    stop();
  });

  it('fetches once on a rising edge and stores the commit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', buildCommit: 'srv1' }));
    const stop = startBuildDriftWatch(fetchImpl);
    useConnectionState.setState({ streamLive: true });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useBuildDrift.getState().serverCommit).toBe('srv1'));
    stop();
  });

  it('does not fetch again on true -> true', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', buildCommit: 'srv1' }));
    useConnectionState.setState({ streamLive: true });
    const stop = startBuildDriftWatch(fetchImpl);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    useConnectionState.setState({ streamLive: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
  });

  it('fetches again after true -> false -> true', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', buildCommit: 'srv1' }));
    const stop = startBuildDriftWatch(fetchImpl);
    useConnectionState.setState({ streamLive: true });
    await vi.waitFor(() => expect(useBuildDrift.getState().serverCommit).toBe('srv1'));
    useConnectionState.setState({ streamLive: false });
    useConnectionState.setState({ streamLive: true });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    stop();
  });

  it('runs a queued check once the in-flight one finishes, for a rising edge that arrived mid-check', async () => {
    let resolveFirst: (() => void) | undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = () => resolve(jsonResponse({ status: 'ok', buildCommit: 'srv1' }));
          }),
      )
      .mockImplementation(async () => jsonResponse({ status: 'ok', buildCommit: 'srv2' }));

    const stop = startBuildDriftWatch(fetchImpl);
    useConnectionState.setState({ streamLive: true });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    // A reconnect wobble while the first check is still in flight: queued, not dropped.
    useConnectionState.setState({ streamLive: false });
    useConnectionState.setState({ streamLive: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useBuildDrift.getState().serverCommit).toBe('srv2'));
    stop();
  });

  it('keeps the previous serverCommit when a check fails', async () => {
    useBuildDrift.setState({ serverCommit: 'keep-me' });
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const stop = startBuildDriftWatch(fetchImpl);
    useConnectionState.setState({ streamLive: true });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(useBuildDrift.getState().serverCommit).toBe('keep-me');
    stop();
  });

  it('fetches nothing on a rising edge after unsubscribe', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok', buildCommit: 'srv1' }));
    const stop = startBuildDriftWatch(fetchImpl);
    stop();
    useConnectionState.setState({ streamLive: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('markReloadedFor / reloadAlreadyTriedFor', () => {
  it('round-trips through sessionStorage', () => {
    markReloadedFor('srv1');
    expect(reloadAlreadyTriedFor('srv1')).toBe(true);
    expect(reloadAlreadyTriedFor('other')).toBe(false);
  });

  it('returns false when sessionStorage throws', () => {
    sessionStorage.setItem(RELOADED_FOR_KEY, 'srv1');
    // happy-dom's Storage caches a bound copy of getItem as an own property on
    // first access, which shadows a Storage.prototype spy once another test in
    // this file has already read from sessionStorage — spy the instance instead.
    const spy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(reloadAlreadyTriedFor('srv1')).toBe(false);
    spy.mockRestore();
  });
});
