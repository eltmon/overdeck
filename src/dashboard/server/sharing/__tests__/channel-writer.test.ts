import { SHARE_MAX_ENVELOPE_CHARS, SHARE_MAX_MESSAGE_CHARS, type SharedEnvelope } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ChannelWriter,
  WRITER_HIGH_WATER_BYTES,
  WRITER_LOW_WATER_BYTES,
  type WritableDataChannel,
} from '../channel-writer.js';

class FakeChannel implements WritableDataChannel {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly sent: string[] = [];
  throwOnSend = false;
  private listeners = new Set<() => void>();

  readonly bufferedAmountLow = {
    subscribe: (listener: () => void) => {
      this.listeners.add(listener);
      return { unSubscribe: () => void this.listeners.delete(listener) };
    },
  };

  send(data: string): void {
    if (this.throwOnSend) throw new Error('channel closed');
    this.sent.push(data);
  }

  fireLow(): void {
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

function envelope(text: string, seq = 1): SharedEnvelope {
  return { v: 1, ch: 'conversation', streamId: 'conv-a', seq, t: 1, payload: { kind: 'append', message: { text } } };
}

describe('ChannelWriter', () => {
  it('sets the low-water threshold to 256 KiB', () => {
    const channel = new FakeChannel();
    new ChannelWriter(channel, () => undefined);
    expect(channel.bufferedAmountLowThreshold).toBe(WRITER_LOW_WATER_BYTES);
  });

  it('sends a small envelope as one message', () => {
    const channel = new FakeChannel();
    new ChannelWriter(channel, () => undefined).send(envelope('hi'));
    expect(channel.sent).toEqual([JSON.stringify(envelope('hi'))]);
  });

  it('sends a long envelope as ordered fragments with one chunk id', () => {
    const channel = new FakeChannel();
    new ChannelWriter(channel, () => undefined).send(envelope('a'.repeat(100_000)));
    const fragments = channel.sent.map((part) => JSON.parse(part) as { chunk: { id: number; index: number; count: number } });
    expect(fragments.length).toBe(Math.ceil(JSON.stringify(envelope('a'.repeat(100_000))).length / SHARE_MAX_MESSAGE_CHARS));
    expect(fragments.map((fragment) => fragment.chunk.index)).toEqual(fragments.map((_, index) => index));
    expect(new Set(fragments.map((fragment) => fragment.chunk.id)).size).toBe(1);
  });

  it('waits above the high-water mark and drains in order on bufferedAmountLow', () => {
    const channel = new FakeChannel();
    channel.bufferedAmount = WRITER_HIGH_WATER_BYTES + 1;
    const writer = new ChannelWriter(channel, () => undefined);
    writer.send(envelope('one', 1));
    writer.send(envelope('two', 2));
    expect(channel.sent).toEqual([]);
    expect(channel.listenerCount()).toBe(1);
    channel.bufferedAmount = 0;
    channel.fireLow();
    expect(channel.sent).toEqual([JSON.stringify(envelope('one', 1)), JSON.stringify(envelope('two', 2))]);
    expect(channel.listenerCount()).toBe(0);
  });

  it('calls onOverflow once past 64 Mi queued characters and ignores later sends', () => {
    const channel = new FakeChannel();
    channel.bufferedAmount = WRITER_HIGH_WATER_BYTES + 1;
    const onOverflow = vi.fn();
    const writer = new ChannelWriter(channel, onOverflow);
    const big = 'a'.repeat(30 * 1024 * 1024);
    writer.send(envelope(big, 1));
    writer.send(envelope(big, 2));
    expect(onOverflow).not.toHaveBeenCalled();
    writer.send(envelope(big, 3));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    writer.send(envelope(big, 4));
    channel.bufferedAmount = 0;
    channel.fireLow();
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(channel.sent).toEqual([]);
    expect(channel.listenerCount()).toBe(0);
  });

  it('closes when the channel send throws', () => {
    const channel = new FakeChannel();
    const writer = new ChannelWriter(channel, () => undefined);
    channel.throwOnSend = true;
    writer.send(envelope('one'));
    channel.throwOnSend = false;
    writer.send(envelope('two'));
    expect(channel.sent).toEqual([]);
  });

  it('throws RangeError for an over-limit envelope and queues nothing', () => {
    const channel = new FakeChannel();
    const writer = new ChannelWriter(channel, () => undefined);
    expect(() => writer.send(envelope('a'.repeat(SHARE_MAX_ENVELOPE_CHARS)))).toThrow(RangeError);
    writer.send(envelope('ok'));
    expect(channel.sent).toEqual([JSON.stringify(envelope('ok'))]);
  });
});
