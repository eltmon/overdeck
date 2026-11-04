/** PAN-4833 WI-8: `RtcDuplexWeb` over a fake browser data channel. */
import { describe, expect, it } from 'vitest';

import { RTC_HIGH_WATER_BYTES, RtcDuplexWeb } from '../rtc-duplex-web.js';

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = 'blob';
  readonly sent: Uint8Array[] = [];
  closeCalls = 0;

  send(data: Uint8Array): void {
    this.sent.push(Uint8Array.from(data));
  }

  close(): void {
    this.closeCalls++;
    this.readyState = 'closed';
  }
}

/** Let streamx run its queued work (it schedules on microtasks and ticks, never timers). */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function duplex(): { channel: FakeDataChannel; stream: RtcDuplexWeb } {
  const channel = new FakeDataChannel();
  const stream = new RtcDuplexWeb(channel as unknown as RTCDataChannel, '0123-4567-89ab-cdef-0123');
  return { channel, stream };
}

describe('RtcDuplexWeb', () => {
  it('configures the channel and names the peer', () => {
    const { channel, stream } = duplex();
    expect(channel.binaryType).toBe('arraybuffer');
    expect(channel.bufferedAmountLowThreshold).toBe(256 * 1024);
    expect(stream.remoteAddress).toBe('rtc:0123456789abcdef');
    stream.destroy();
  });

  it('sends a 40 KiB write as 16 KiB slices', async () => {
    const { channel, stream } = duplex();
    stream.write(new Uint8Array(40 * 1024).fill(7));
    await settle();
    expect(channel.sent.map((m) => m.byteLength)).toEqual([16_384, 16_384, 8_192]);
    expect(stream.bytesOut).toBe(40 * 1024);
    stream.destroy();
  });

  it('holds the write callback while bufferedAmount is high, until bufferedamountlow', async () => {
    const { channel, stream } = duplex();
    channel.bufferedAmount = 2 * RTC_HIGH_WATER_BYTES;
    stream.write(Uint8Array.of(1));
    stream.write(Uint8Array.of(2));
    await settle();
    // The first write's callback is pending, so the second has not reached the channel.
    expect(channel.sent).toEqual([Uint8Array.of(1)]);

    channel.bufferedAmount = 0;
    channel.dispatchEvent(new Event('bufferedamountlow'));
    await settle();
    expect(channel.sent).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
    stream.destroy();
  });

  it('reads an ArrayBuffer message as the same bytes', async () => {
    const { channel, stream } = duplex();
    const received: Uint8Array[] = [];
    stream.on('data', (chunk: unknown) => received.push(chunk as Uint8Array));
    channel.dispatchEvent(new MessageEvent('message', { data: Uint8Array.of(4, 5, 6).buffer }));
    await settle();
    expect(received.map((c) => Array.from(c))).toEqual([[4, 5, 6]]);
    expect(stream.bytesIn).toBe(3);
    stream.destroy();
  });

  it('ends and closes the stream when the channel closes', async () => {
    const { channel, stream } = duplex();
    const events: string[] = [];
    stream.on('data', () => {});
    stream.on('end', () => events.push('end'));
    stream.on('close', () => events.push('close'));
    channel.readyState = 'closed';
    channel.dispatchEvent(new Event('close'));
    await settle();
    expect(events).toEqual(['end', 'close']);
  });

  it('fails a write still waiting for low water when the channel closes', async () => {
    const { channel, stream } = duplex();
    const errors: Error[] = [];
    stream.on('error', (error: Error) => errors.push(error));
    channel.bufferedAmount = 2 * RTC_HIGH_WATER_BYTES;
    stream.write(Uint8Array.of(1));
    await settle();
    channel.readyState = 'closed';
    channel.dispatchEvent(new Event('close'));
    await settle();
    expect(errors.map((e) => e.message)).toEqual(['data channel is closed']);
    expect(stream.destroyed).toBe(true);
  });

  it('closes the channel once on destroy', async () => {
    const { channel, stream } = duplex();
    stream.destroy();
    stream.destroy();
    await settle();
    expect(channel.closeCalls).toBe(1);
  });

  it('fails a write once the channel has closed', async () => {
    const { channel, stream } = duplex();
    const errors: Error[] = [];
    stream.on('error', (error: Error) => errors.push(error));
    channel.close();
    stream.write(Uint8Array.of(1));
    await settle();
    expect(errors.map((e) => e.message)).toEqual(['data channel is closed']);
    expect(channel.sent).toEqual([]);
  });
});
