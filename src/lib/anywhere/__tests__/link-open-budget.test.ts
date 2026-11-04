/**
 * PAN-4885: `openLinkSocket` gives the secure-channel open its own `LINK_OPEN_MS`
 * (10 s) budget, separate from `LINK_WAIT_MS` (2.5 s), which only bounds the wait
 * for a `connecting` link to come online.
 */
import { withDeadline } from '@overdeck/anywhere-channel';
import type { Duplex } from 'node:stream';
import { duplexPair } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../channel/open.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel/open.js')>()),
  openChannel: vi.fn(),
}));

import { openChannel } from '../channel/open.js';
import { _resetLinkClientForTests, LINK_OPEN_MS, LINK_WAIT_MS, LinkUnavailableError, openLinkSocket, type LinkRouteSource } from '../link-client.js';

/** A route source whose link is already online with a trusted route. */
function onlineSource(): LinkRouteSource {
  return {
    routeFor: () => ({ state: 'online', url: 'wss://pan-workspaces.fly.dev/ws/link?fly-instance=x', machineKey: 'ab'.repeat(32), token: `odk_${'7'.repeat(64)}`, label: 'peer' }),
    waitOnline: async () => true,
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
  };
}

/**
 * Makes the mocked `openChannel` run the real deadline logic with no I/O: the
 * pending "handshake" rejects as soon as `withDeadline`'s own timer aborts the
 * signal, exactly as the real transport/handshake promise would once its
 * socket is destroyed on abort.
 */
function slowOpen(delayMs: number): void {
  vi.mocked(openChannel).mockImplementation((url, opts) =>
    withDeadline<Duplex, Duplex>(url, opts, (signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(duplexPair()[0]), delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    })));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(openChannel).mockReset();
  _resetLinkClientForTests();
});

describe('link open budget (PAN-4885)', () => {
  it('opens an online link with LINK_OPEN_MS, not LINK_WAIT_MS', async () => {
    expect(LINK_OPEN_MS).toBe(10_000);
    expect(LINK_WAIT_MS).toBe(2_500);
    vi.mocked(openChannel).mockResolvedValue(duplexPair()[0] as never);
    const source = onlineSource();

    await openLinkSocket('env-peer', { routeSource: source });

    expect(openChannel).toHaveBeenCalledTimes(1);
    expect(openChannel).toHaveBeenCalledWith(
      'wss://pan-workspaces.fly.dev/ws/link?fly-instance=x',
      expect.objectContaining({ mode: 'link', timeoutMs: LINK_OPEN_MS }),
    );
  });

  it('an open that takes 3 s on an online link resolves', async () => {
    slowOpen(3_000);
    const source = onlineSource();

    const result = openLinkSocket('env-peer', { routeSource: source });
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toBeDefined();
  });

  it('an open still pending at LINK_OPEN_MS rejects with a timeout naming 10000 ms', async () => {
    slowOpen(60_000);
    const source = onlineSource();

    const result = openLinkSocket('env-peer', { routeSource: source });
    const assertion = expect(result).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringMatching(/did not open within 10000 ms$/),
    });
    await vi.advanceTimersByTimeAsync(LINK_OPEN_MS);

    await assertion;
  });

  it('a connecting link waits LINK_WAIT_MS, then opens with LINK_OPEN_MS', async () => {
    vi.mocked(openChannel).mockResolvedValue(duplexPair()[0] as never);
    const online = onlineSource();
    let state: 'connecting' | 'online' = 'connecting';
    const waitOnline = vi.fn(async () => {
      state = 'online';
      return true;
    });
    const source: LinkRouteSource = {
      ...online,
      routeFor: () => ({ ...online.routeFor('env-peer')!, state }),
      waitOnline,
    };

    await openLinkSocket('env-peer', { routeSource: source });

    expect(waitOnline).toHaveBeenCalledWith('env-peer', LINK_WAIT_MS);
    expect(openChannel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeoutMs: LINK_OPEN_MS }));
  });

  it('a connecting link that never comes online rejects as unreachable without opening', async () => {
    const online = onlineSource();
    const source: LinkRouteSource = {
      ...online,
      routeFor: () => ({ ...online.routeFor('env-peer')!, state: 'connecting' }),
      waitOnline: async () => false,
    };

    await expect(openLinkSocket('env-peer', { routeSource: source })).rejects.toMatchObject({ code: 'machine-unreachable' } satisfies Partial<LinkUnavailableError>);
    expect(openChannel).not.toHaveBeenCalled();
  });

  it('an offline link fails at once without opening', async () => {
    const source: LinkRouteSource = {
      routeFor: () => ({ state: 'offline', url: null, machineKey: 'ab'.repeat(32), token: 'odk_x', label: 'peer' }),
      waitOnline: async () => false,
      localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    };

    await expect(openLinkSocket('env-peer', { routeSource: source })).rejects.toMatchObject({ code: 'machine-offline' });
    expect(openChannel).not.toHaveBeenCalled();
  });
});
