import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRelayMeter, MAX_REPORT_BYTES, type RelayMeter } from '../relayMeter';

class FakeRaw extends EventEmitter {
  bytesIn = 0;
  bytesOut = 0;
}

let meter: RelayMeter | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  meter?.stop();
  meter = null;
  vi.useRealTimers();
});

describe('createRelayMeter', () => {
  it('reports the bytes moved since the last report every 60 s', async () => {
    const send = vi.fn(() => true);
    meter = createRelayMeter(send);
    const raw = new FakeRaw();
    meter.track(raw);
    raw.bytesIn = 1_000;
    raw.bytesOut = 500;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledWith(1_500);
    raw.bytesIn = 1_200;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenLastCalledWith(200);
  });

  it('reports the remainder when the channel closes and nothing after', async () => {
    const send = vi.fn(() => true);
    meter = createRelayMeter(send);
    const raw = new FakeRaw();
    meter.track(raw);
    raw.bytesOut = 700;
    raw.emit('close');
    expect(send).toHaveBeenCalledWith(700);
    raw.bytesOut = 900;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when no bytes moved', async () => {
    const send = vi.fn(() => true);
    meter = createRelayMeter(send);
    meter.track(new FakeRaw());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('splits a report above 1e9 bytes into directory-sized chunks', () => {
    const send = vi.fn(() => true);
    meter = createRelayMeter(send);
    const raw = new FakeRaw();
    meter.track(raw);
    raw.bytesIn = MAX_REPORT_BYTES + 5;
    raw.emit('close');
    expect(send.mock.calls).toEqual([[MAX_REPORT_BYTES], [5]]);
  });
});
