import { EventEmitter } from 'node:events';

import {
  ChannelOpenError,
  type ChannelOpenErrorCode,
  type ClientSignaling,
  createMachineDialer,
  type DirectoryWebClient,
  type DirectoryWebState,
  type MachineDialer,
  type RtcDuplexWeb,
  type SecureChannel,
} from '@overdeck/anywhere-channel/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_PAN_VERSION } from '../config';
import { ConnectionError, createConnection, DIRECT_TIMEOUT_WITH_RELAY_MS, DIRECTORY_WAIT_MS, type ConnectionDirectory } from '../connection';
import { createRelayMeter, type RelayMeter } from '../relayMeter';
import type { PairedMachine } from '../types';

class FakeRaw extends EventEmitter {
  bytesIn = 0;
  bytesOut = 0;
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

type DialOpts = Parameters<MachineDialer['dialMachine']>[1];

function fakeDirectory(opts: { relayAllowed: boolean; online?: boolean; direct: 'ok' | 'fail'; relay?: 'ok' | 'fail' }) {
  const dials: DialOpts[] = [];
  const raws: FakeRaw[] = [];
  let relayStopped = false;
  const dialer: MachineDialer = {
    dialMachine: vi.fn(async (_env: string, dial: DialOpts) => {
      dials.push(dial);
      const outcome = dial.relay ? opts.relay ?? 'fail' : opts.direct;
      if (outcome === 'fail') throw new Error(`${dial.relay ? 'relay' : 'direct'} dial failed`);
      const raw = new FakeRaw();
      raws.push(raw);
      return raw as unknown as RtcDuplexWeb;
    }),
    close: vi.fn(),
    evict: vi.fn(),
    restartIce: vi.fn(async () => {}),
    onRecovered: vi.fn(() => () => {}),
  };
  const stateListeners = new Set<(state: DirectoryWebState) => void>();
  const client = {
    state: (opts.online === false ? 'connecting' : 'online') as DirectoryWebState,
    relayAllowed: opts.relayAllowed,
    onStateChange(listener: (state: DirectoryWebState) => void) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
  const setState = (state: DirectoryWebState): void => {
    client.state = state;
    for (const listener of [...stateListeners]) listener(state);
  };
  const directory: ConnectionDirectory = { client, dialer, relayStopped: () => relayStopped };
  return { directory, dials, raws, dialer, setState, stopRelay: () => (relayStopped = true) };
}

const MACHINE: PairedMachine = {
  environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b',
  label: 'desk',
  machineKeyHex: 'ab'.repeat(32),
  linkPublicKeyHex: 'cd'.repeat(32),
  linkSecretKeyHex: 'ef'.repeat(32),
  token: 'opt_test',
  tokenId: 'tok-1',
  pairedAt: '2026-11-03T00:00:00.000Z',
};

let meter: RelayMeter;
let sent: number[];

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  meter = createRelayMeter((bytes) => {
    sent.push(bytes);
    return true;
  });
});

afterEach(() => {
  meter.stop();
  vi.useRealTimers();
});

const rejection = (promise: Promise<unknown>): Promise<ConnectionError> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error as ConnectionError,
  );

describe('dialRaw', () => {
  it('uses the direct route and never asks for the relay when direct works', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'ok' });
    await createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials).toEqual([{ relay: false, timeoutMs: DIRECT_TIMEOUT_WITH_RELAY_MS }]);
  });

  it('uses the dialer default timeout for direct when the relay is not allowed', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    await createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials).toEqual([{ relay: false }]);
  });

  it('dials the relay after a direct failure when the relay is allowed', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    await createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials.map((d) => d.relay)).toEqual([false, true]);
  });

  it('fails with no-path and the FR-7 sentence when the relay is not allowed', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'fail' });
    const error = await rejection(createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk'));
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.kind).toBe('no-path');
    expect(error.message).toBe('No direct path to desk. Install Tailscale on it or use the relay plan.');
    expect(f.dials.map((d) => d.relay)).toEqual([false]);
  });

  it('does not dial the relay after relay-status stopped', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    f.stopRelay();
    const error = await rejection(createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk'));
    expect(error.kind).toBe('no-path');
    expect(f.dials).toEqual([{ relay: false }]);
  });

  it('refuses with directory-offline when the directory does not come online in time', async () => {
    const f = fakeDirectory({ relayAllowed: true, online: false, direct: 'ok' });
    const log = vi.fn();
    const pending = rejection(createConnection({ directory: f.directory, meter, log }).dialRaw(MACHINE.environmentId, 'desk'));
    await vi.advanceTimersByTimeAsync(DIRECTORY_WAIT_MS);
    const error = await pending;
    expect(error.kind).toBe('directory-offline');
    expect(error.message).toBe('Not connected to overdeck.ai.');
    expect(f.dials).toEqual([]);
    expect(log).toHaveBeenCalledWith(`link desk: directory not online after ${DIRECTORY_WAIT_MS} ms (connecting)`);
  });

  it('waits for a connecting directory and dials once it is online (PAN-5018)', async () => {
    const f = fakeDirectory({ relayAllowed: false, online: false, direct: 'ok' });
    const dialed = createConnection({ directory: f.directory, meter, log: vi.fn() }).dialRaw(MACHINE.environmentId, 'desk');
    await vi.advanceTimersByTimeAsync(DIRECTORY_WAIT_MS - 1);
    expect(f.dials).toEqual([]);
    f.setState('online');
    const raw = await dialed;
    expect(raw).toBe(f.raws[0]);
    expect(f.dials).toEqual([{ relay: false }]);
  });

  it('stops waiting at once when the directory refuses', async () => {
    const f = fakeDirectory({ relayAllowed: false, online: false, direct: 'ok' });
    const pending = rejection(createConnection({ directory: f.directory, meter, log: vi.fn() }).dialRaw(MACHINE.environmentId, 'desk'));
    f.setState('refused');
    expect((await pending).kind).toBe('directory-offline');
  });

  it('stops waiting when the dial is aborted', async () => {
    const f = fakeDirectory({ relayAllowed: false, online: false, direct: 'ok' });
    const controller = new AbortController();
    const pending = createConnection({ directory: f.directory, meter, log: vi.fn() })
      .dialRaw(MACHINE.environmentId, 'desk', { signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(f.dials).toEqual([]);
  });

  it('remembers the relay route until forgetRoutes', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    const connection = createConnection({ directory: f.directory, meter });
    await connection.dialRaw(MACHINE.environmentId, 'desk');
    await connection.dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials.map((d) => d.relay)).toEqual([false, true, true]);
    connection.forgetRoutes();
    expect(f.dialer.close).toHaveBeenCalled();
    await connection.dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials.map((d) => d.relay)).toEqual([false, true, true, false, true]);
  });
});

describe('relay metering', () => {
  it('reports relayed bytes after 60 s and the remainder on close', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    await createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk');
    const raw = f.raws[0]!;
    raw.bytesIn = 4_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([4_000]);
    raw.bytesOut = 250;
    raw.destroy();
    expect(sent).toEqual([4_000, 250]);
  });

  it('reports nothing for direct dials', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'ok' });
    await createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk');
    f.raws[0]!.bytesIn = 9_000;
    await vi.advanceTimersByTimeAsync(60_000);
    f.raws[0]!.destroy();
    expect(sent).toEqual([]);
  });
});

describe('openLink', () => {
  it.each<[ChannelOpenErrorCode, string, string]>([
    ['unknown-peer', 'removed', 'This phone was removed from desk. Pair again.'],
    ['pairing-refused', 'pairing-refused', 'This pairing code expired or was already used. Create a new one on desk.'],
    ['identity-refused', 'identity', 'desk did not prove the identity in the pairing code. Pair again from its Settings.'],
    ['unsupported', 'outdated', `Update Overdeck on desk to use the app (pan ${MIN_PAN_VERSION} or later).`],
    ['timeout', 'other', 'Could not open a secure channel to desk.'],
  ])('maps ChannelOpenError %s to %s and closes the raw channel', async (code, kind, text) => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const open = vi.fn(async () => {
      throw new ChannelOpenError(code, 'refused');
    });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: open });
    const error = await rejection(connection.openLink(MACHINE));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(text);
    expect(f.raws[0]!.destroyed).toBe(true);
  });

  it('opens a link channel with the machine record keys and pinned machine key', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const stream = { marker: 'plaintext' };
    const open = vi.fn(async () => ({ stream, channel: { mode: 'link', remoteKeyHex: MACHINE.machineKeyHex, pairingId: null } }));
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: open as never });
    await expect(connection.openLink(MACHINE)).resolves.toBe(stream);
    const [, options, label] = open.mock.calls[0] as unknown as [unknown, { mode: string; remoteKeyHex: string; localKey: { publicKey: Uint8Array; secretKey: Uint8Array } }, string];
    expect(options.mode).toBe('link');
    expect(options.remoteKeyHex).toBe(MACHINE.machineKeyHex);
    expect(options.localKey.publicKey).toEqual(new Uint8Array(32).fill(0xcd));
    expect(options.localKey.secretKey).toEqual(new Uint8Array(32).fill(0xef));
    expect(label).toBe('desk');
  });
});

describe('failure logging (PAN-5018 FR-1)', () => {
  it('logs the direct and relay failures with their messages', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'fail' });
    const log = vi.fn();
    const connection = createConnection({ directory: f.directory, meter, log });
    const error = await rejection(connection.openLink(MACHINE));
    expect(error.message).toBe('Could not reach desk directly or through the relay.');
    const lines = log.mock.calls.map(([line]) => line as string);
    expect(lines).toEqual(['link desk: direct dial failed: direct dial failed', 'link desk: relay dial failed: relay dial failed']);
  });

  it('logs the ChannelOpenError code when the secure open fails', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const log = vi.fn();
    const open = vi.fn(async () => {
      throw new ChannelOpenError('timeout', 'no handshake reply');
    });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: open, log });
    await rejection(connection.openLink(MACHINE));
    expect(log).toHaveBeenCalledWith('link desk: secure open failed over direct (timeout): no handshake reply');
  });

  it('names the relay route when the secure open over the relay fails', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    const log = vi.fn();
    const open = vi.fn(async () => {
      throw new ChannelOpenError('protocol', 'bad frame');
    });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: open, log });
    await rejection(connection.openLink(MACHINE));
    expect(log).toHaveBeenLastCalledWith('link desk: secure open failed over relay (protocol): bad frame');
  });
});

describe('debug error codes and eviction (PAN-5018 FR-2, FR-3)', () => {
  const failingOpen = (code: ChannelOpenErrorCode) =>
    vi.fn(async () => {
      throw new ChannelOpenError(code, 'refused');
    });

  it('appends the code to the text when showErrorCodes is on', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: failingOpen('timeout'), log: vi.fn(), showErrorCodes: true });
    const error = await rejection(connection.openLink(MACHINE));
    expect(error.message).toBe('Could not open a secure channel to desk. (timeout)');
  });

  it('keeps the text unchanged when showErrorCodes is off', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: failingOpen('timeout'), log: vi.fn(), showErrorCodes: false });
    const error = await rejection(connection.openLink(MACHINE));
    expect(error.message).toBe('Could not open a secure channel to desk.');
  });

  it('closes the peer connection under the channel after a handshake timeout', async () => {
    const f = fakeDirectory({ relayAllowed: true, direct: 'fail', relay: 'ok' });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: failingOpen('timeout'), log: vi.fn() });
    await rejection(connection.openLink(MACHINE));
    expect(f.dialer.evict).toHaveBeenCalledWith(f.raws[0], 'secure open timeout');
    expect(f.dialer.close).not.toHaveBeenCalled();
    expect(f.dials.map((d) => d.relay)).toEqual([false, true]);
    await connection.dialRaw(MACHINE.environmentId, 'desk');
    expect(f.dials.map((d) => d.relay)).toEqual([false, true, false, true]);
  });

  it('closes the peer connections after a protocol failure while pairing', async () => {
    const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
    const connection = createConnection({ directory: f.directory, meter, openSecureChannel: failingOpen('protocol'), log: vi.fn() });
    const localKey = { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) };
    await rejection(connection.openPairing(MACHINE.environmentId, 'desk', 'odp_test', localKey));
    expect(f.dialer.evict).toHaveBeenCalledWith(f.raws[0], 'secure open protocol');
  });

  it.each<ChannelOpenErrorCode>(['unknown-peer', 'pairing-refused', 'identity-refused', 'unsupported', 'busy'])(
    'keeps the peer connection after %s',
    async (code) => {
      const f = fakeDirectory({ relayAllowed: false, direct: 'ok' });
      const connection = createConnection({ directory: f.directory, meter, openSecureChannel: failingOpen(code), log: vi.fn() });
      await rejection(connection.openLink(MACHINE));
      expect(f.dialer.evict).not.toHaveBeenCalled();
      expect(f.dialer.close).not.toHaveBeenCalled();
    },
  );
});

/** A data channel that opens on the next microtask. */
class OpeningChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = 'open';
      this.dispatchEvent(new Event('open'));
    });
  }
  send(): void {}
  close(): void {
    this.readyState = 'closed';
  }
}

class StubPeerConnection extends EventTarget {
  static instances: StubPeerConnection[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  constructor() {
    super();
    StubPeerConnection.instances.push(this);
  }
  createDataChannel(): OpeningChannel {
    return new OpeningChannel();
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0' };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }
  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

describe('eviction against the real dialer (PAN-5046 FR-3)', () => {
  it('a timeout on a raw channel from a replaced connection does not close the current one', async () => {
    StubPeerConnection.instances = [];
    const signaling = { send: () => true, on: () => () => {}, iceServers: async () => [] } as unknown as ClientSignaling;
    const dialer = createMachineDialer(signaling, { RTCPeerConnection: StubPeerConnection as unknown as typeof RTCPeerConnection, log: () => {} });
    const client = { state: 'online', relayAllowed: false, onStateChange: () => () => {} } as unknown as DirectoryWebClient;
    let failStale: (error: Error) => void = () => {};
    const open = vi.fn((raw: RtcDuplexWeb): Promise<SecureChannel> => {
      // Closing a connection ends its raw channels with an error.
      raw.on('error', () => {});
      if (open.mock.calls.length === 1) return new Promise((_resolve, reject) => (failStale = reject));
      return Promise.resolve({ stream: raw, channel: {} } as unknown as SecureChannel);
    });
    const connection = createConnection({ directory: { client, dialer, relayStopped: () => false }, meter, openSecureChannel: open, log: vi.fn() });

    const stale = rejection(connection.openLink(MACHINE));
    await vi.advanceTimersByTimeAsync(0);
    // Resume closes the first connection while its handshake is still running.
    connection.forgetRoutes();
    await connection.openLink(MACHINE);
    const [replaced, current] = StubPeerConnection.instances;
    expect(replaced!.closed).toBe(true);

    failStale(new ChannelOpenError('timeout', 'no handshake reply'));
    await stale;
    expect(current!.closed).toBe(false);
    dialer.close();
  });
});
