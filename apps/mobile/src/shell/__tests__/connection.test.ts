import { EventEmitter } from 'node:events';

import { ChannelOpenError, type ChannelOpenErrorCode, type MachineDialer, type RtcDuplexWeb } from '@overdeck/anywhere-channel/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_PAN_VERSION } from '../config';
import { ConnectionError, createConnection, DIRECT_TIMEOUT_WITH_RELAY_MS, type ConnectionDirectory } from '../connection';
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
  };
  const directory: ConnectionDirectory = {
    client: { state: opts.online === false ? 'connecting' : 'online', relayAllowed: opts.relayAllowed },
    dialer,
    relayStopped: () => relayStopped,
  };
  return { directory, dials, raws, dialer, stopRelay: () => (relayStopped = true) };
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

  it('refuses with directory-offline while the directory is not online', async () => {
    const f = fakeDirectory({ relayAllowed: true, online: false, direct: 'ok' });
    const error = await rejection(createConnection({ directory: f.directory, meter }).dialRaw(MACHINE.environmentId, 'desk'));
    expect(error.kind).toBe('directory-offline');
    expect(error.message).toBe('Not connected to overdeck.ai.');
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
