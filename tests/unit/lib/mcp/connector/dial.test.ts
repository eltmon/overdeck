import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { DirectoryMachine, SignalData } from '@overdeck/contracts';
import { RELAY_CAP_MESSAGE } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ConnectorDirectoryPort,
  type ConnectorTransport,
  connectorSignalingPort,
  createConnectorRtc,
  createRelayMeter,
  RELAY_PLAN_MESSAGE,
} from '../../../../../src/lib/mcp/connector/dial.js';

const MACHINE: DirectoryMachine = {
  environmentId: 'env-1',
  label: 'studio',
  publicKeyHex: 'ab'.repeat(32),
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

type Handler = (frame: never) => void;

class FakeDirectory {
  state: ConnectorDirectoryPort['state'] = 'online';
  machines: readonly DirectoryMachine[] = [MACHINE];
  relayAllowed = true;
  sendOk = true;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly handlers = new Map<string, Set<Handler>>();

  send = (frame: object): boolean => {
    if (!this.sendOk) return false;
    this.sent.push(frame as Record<string, unknown>);
    return true;
  };

  on = (type: string, handler: Handler): (() => void) => {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  };

  iceServers = async (_relay: boolean) => [{ urls: ['stun:stun.example:3478'] as readonly string[] }];

  emit(type: string, frame: Record<string, unknown>): void {
    for (const handler of this.handlers.get(type) ?? []) (handler as (frame: unknown) => void)({ type, ...frame });
  }

  port(): ConnectorDirectoryPort {
    return this as unknown as ConnectorDirectoryPort;
  }
}

class MeteredDuplex extends PassThrough {
  bytesIn = 0;
  bytesOut = 0;
}

function stubTransport() {
  const raws: MeteredDuplex[] = [];
  const transport = {
    dial: vi.fn(async () => {
      const raw = new MeteredDuplex();
      raws.push(raw);
      return raw;
    }),
    abortSession: vi.fn(),
    close: vi.fn(),
  };
  return { transport, raws, factory: () => transport as unknown as ConnectorTransport };
}

const SIGNAL: SignalData = { kind: 'offer', sdp: 'v=0' } as unknown as SignalData;

let directory: FakeDirectory;

beforeEach(() => {
  vi.useFakeTimers();
  directory = new FakeDirectory();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectorSignalingPort', () => {
  it('sends link signal frames and copies ICE server urls', async () => {
    const port = connectorSignalingPort(directory.port());
    port.send('env-1', 'sess-1', 'approval', true, SIGNAL);
    expect(directory.sent).toEqual([{ type: 'signal', to: 'env-1', session: 'sess-1', purpose: 'link', relay: true, data: SIGNAL }]);
    expect(await port.iceServers(false)).toEqual([{ urls: ['stun:stun.example:3478'] }]);
  });

  it('hands incoming signal frames to the handler', () => {
    const port = connectorSignalingPort(directory.port());
    const seen: unknown[] = [];
    port.onSignal((...args) => seen.push(args));
    directory.emit('signal', { from: 'env-1', session: 's', purpose: 'link', relay: false, data: SIGNAL });
    expect(seen).toEqual([['env-1', 's', 'link', false, SIGNAL]]);
  });
});

describe('createConnectorRtc', () => {
  it('aborts the session the directory reports peer_offline for', () => {
    const { transport, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    directory.emit('error', { code: 'peer_offline', message: 'offline', session: 'sess-9' });
    expect(transport.abortSession).toHaveBeenCalledWith('sess-9');
    rtc.stop();
  });

  it('dials direct and relay routes for the paired machine', async () => {
    const { transport, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    const signal = new AbortController().signal;
    await rtc.dialer('rtc://env-1', signal);
    await rtc.dialer('rtc+turn://env-1', signal);
    expect(transport.dial.mock.calls).toEqual([
      ['env-1', { relay: false, purpose: 'link', signal }],
      ['env-1', { relay: true, purpose: 'link', signal }],
    ]);
    rtc.stop();
    expect(transport.close).toHaveBeenCalled();
  });

  it('refuses a relay dial without the relay plan', async () => {
    directory.relayAllowed = false;
    const { transport, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    await expect(rtc.dialer('rtc+turn://env-1', new AbortController().signal)).rejects.toThrow(RELAY_PLAN_MESSAGE);
    expect(transport.dial).not.toHaveBeenCalled();
    expect(rtc.relayRefusal()).toBe(RELAY_PLAN_MESSAGE);
    rtc.stop();
  });

  it('refuses dials when the directory or the machine is offline', async () => {
    const { transport, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    directory.machines = [{ ...MACHINE, online: false }];
    await expect(rtc.dialer('rtc://env-1', new AbortController().signal)).rejects.toThrow('not online');
    directory.state = 'connecting';
    await expect(rtc.dialer('rtc://env-1', new AbortController().signal)).rejects.toThrow('Not connected');
    expect(transport.dial).not.toHaveBeenCalled();
    rtc.stop();
  });

  it('closes relay channels and refuses relay dials once the relay is stopped', async () => {
    const { raws, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    await rtc.dialer('rtc+turn://env-1', new AbortController().signal);
    await rtc.dialer('rtc://env-1', new AbortController().signal);
    directory.emit('relay-status', { month: '2026-11', bytesUsed: 10, capBytes: 10, stopped: true });
    expect(raws[0]?.destroyed).toBe(true);
    expect(raws[1]?.destroyed).toBe(false);
    await expect(rtc.dialer('rtc+turn://env-1', new AbortController().signal)).rejects.toThrow(RELAY_CAP_MESSAGE);
    rtc.stop();
  });

  it('meters relay bytes as relay-usage frames', async () => {
    const { raws, factory } = stubTransport();
    const rtc = createConnectorRtc(directory.port(), { transport: factory });
    await rtc.dialer('rtc+turn://env-1', new AbortController().signal);
    const raw = raws[0] as MeteredDuplex;
    raw.bytesIn = 300;
    raw.bytesOut = 200;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(directory.sent).toEqual([{ type: 'relay-usage', bytes: 500 }]);
    rtc.stop();
  });
});

describe('createRelayMeter', () => {
  function fakeRaw(): EventEmitter & { bytesIn: number; bytesOut: number } {
    return Object.assign(new EventEmitter(), { bytesIn: 0, bytesOut: 0 });
  }

  it('splits large deltas into 1e9-byte frames every 60 s', async () => {
    const sent: number[] = [];
    const meter = createRelayMeter((bytes) => {
      sent.push(bytes);
      return true;
    });
    const raw = fakeRaw();
    meter.track(raw);
    raw.bytesIn = 2_000_000_000;
    raw.bytesOut = 500_000_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([1_000_000_000, 1_000_000_000, 500_000_000]);
    meter.stop();
  });

  it('reports on close and keeps bytes the socket refused', async () => {
    const sent: number[] = [];
    let accept = false;
    const meter = createRelayMeter((bytes) => {
      if (!accept) return false;
      sent.push(bytes);
      return true;
    });
    const raw = fakeRaw();
    meter.track(raw);
    raw.bytesIn = 40;
    raw.emit('close');
    expect(sent).toEqual([]);
    accept = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([40]);
    meter.stop();
  });

  it('sends only the delta since the last report', async () => {
    const sent: number[] = [];
    const meter = createRelayMeter((bytes) => {
      sent.push(bytes);
      return true;
    });
    const raw = fakeRaw();
    meter.track(raw);
    raw.bytesOut = 10;
    await vi.advanceTimersByTimeAsync(60_000);
    raw.bytesOut = 25;
    raw.emit('close');
    expect(sent).toEqual([10, 15]);
    meter.stop();
  });
});
