/**
 * PAN-2356 WI-17: relay usage reports, the stop at the cap and entitlement. Fake timers, a stub
 * directory and fake metered transports (no I/O).
 */
import { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_CAP_MESSAGE, type DirectoryToMachineFrame, type MachineToDirectoryFrame, type RelayStatus } from '@overdeck/contracts';

import { type MeteredTransport, RELAY_PLAN_MESSAGE, RELAY_REPORT_INTERVAL_MS, RelayClient, type RelayDirectory } from '../relay-client.js';

type Handler = (frame: DirectoryToMachineFrame) => void;

function stubDirectory(options: { relayAllowed: boolean }) {
  const sent: MachineToDirectoryFrame[] = [];
  const handlers = new Map<string, Set<Handler>>();
  let status: RelayStatus | null = { month: '2026-11', bytesUsed: 0, capBytes: 50_000_000_000, stopped: false };
  const directory: RelayDirectory = {
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    on: (type, handler) => {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler as Handler);
      return () => set.delete(handler as Handler);
    },
    relayEntitled: () => options.relayAllowed,
    relayStatus: () => status,
  };
  const deliver = (frame: DirectoryToMachineFrame) => {
    if (frame.type === 'relay-status') status = { month: frame.month, bytesUsed: frame.bytesUsed, capBytes: frame.capBytes, stopped: frame.stopped };
    for (const handler of handlers.get(frame.type) ?? []) handler(frame);
  };
  return { directory, sent, deliver };
}

function fakeTransport(): MeteredTransport {
  const raw = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } }) as MeteredTransport;
  raw.bytesIn = 0;
  raw.bytesOut = 0;
  return raw;
}

const usage = (sent: MachineToDirectoryFrame[]) => sent.filter((f) => f.type === 'relay-usage').map((f) => (f as { bytes: number }).bytes);

let client: RelayClient | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  client?.stop();
  client = null;
  vi.useRealTimers();
});

describe('RelayClient (PAN-2356 WI-17)', () => {
  it('reports the bytes moved since the last report every 60 s, and the remainder on close', async () => {
    const stub = stubDirectory({ relayAllowed: true });
    client = new RelayClient(stub.directory);
    client.start();
    const raw = fakeTransport();
    client.track(raw);

    raw.bytesOut = 600;
    raw.bytesIn = 400;
    await vi.advanceTimersByTimeAsync(RELAY_REPORT_INTERVAL_MS);
    expect(usage(stub.sent)).toEqual([1000]);

    raw.bytesOut += 300;
    raw.bytesIn += 200;
    await vi.advanceTimersByTimeAsync(RELAY_REPORT_INTERVAL_MS);
    expect(usage(stub.sent)).toEqual([1000, 500]);

    await vi.advanceTimersByTimeAsync(RELAY_REPORT_INTERVAL_MS);
    expect(usage(stub.sent)).toEqual([1000, 500]);

    raw.bytesOut += 25;
    raw.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(usage(stub.sent)).toEqual([1000, 500, 25]);
    expect(client.relayStatus().using).toBe(false);
  });

  it('closes every tracked relay channel when the directory says the allowance is used', async () => {
    const stub = stubDirectory({ relayAllowed: true });
    client = new RelayClient(stub.directory);
    client.start();
    const one = fakeTransport();
    const two = fakeTransport();
    client.track(one);
    client.track(two);
    expect(client.relayStatus().using).toBe(true);
    expect(client.relayEntitled()).toBe(true);

    stub.deliver({ type: 'relay-status', month: '2026-11', bytesUsed: 50_000_000_000, capBytes: 50_000_000_000, stopped: true });
    expect(one.destroyed && two.destroyed).toBe(true);
    expect(client.relayEntitled()).toBe(false);
    expect(client.refusal()).toBe(RELAY_CAP_MESSAGE);
  });

  it('is not entitled on a plan without the relay', () => {
    const stub = stubDirectory({ relayAllowed: false });
    client = new RelayClient(stub.directory);
    expect(client.relayEntitled()).toBe(false);
    expect(client.refusal()).toBe(RELAY_PLAN_MESSAGE);
  });
});

describe('RelayClient telemetry (PAN-5016 WI-8)', () => {
  it('feeds each report with new bytes to onRelayBytes once, alongside one relay-usage frame', () => {
    const stub = stubDirectory({ relayAllowed: true });
    const onRelayBytes = vi.fn();
    client = new RelayClient(stub.directory, onRelayBytes);
    const raw = fakeTransport();
    client.track(raw);
    raw.bytesIn = 1500;
    raw.bytesOut = 500;

    client.report();
    expect(onRelayBytes.mock.calls).toEqual([[2000]]);
    expect(usage(stub.sent)).toEqual([2000]);

    client.report();
    expect(onRelayBytes).toHaveBeenCalledTimes(1);
    expect(usage(stub.sent)).toEqual([2000]);
  });

  it('still sends the frame when onRelayBytes throws', () => {
    const stub = stubDirectory({ relayAllowed: true });
    client = new RelayClient(stub.directory, () => { throw new Error('telemetry down'); });
    const raw = fakeTransport();
    client.track(raw);
    raw.bytesIn = 1500;
    raw.bytesOut = 500;

    expect(() => client!.report()).not.toThrow();
    expect(usage(stub.sent)).toEqual([2000]);
  });
});
