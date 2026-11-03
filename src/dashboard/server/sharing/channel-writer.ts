/**
 * Sends one Shared Sessions data channel's envelopes in order (PRD PAN-4474 WI-4).
 *
 * Each envelope is encoded with `encodeSharedMessage`, so an envelope longer than
 * `SHARE_MAX_MESSAGE_CHARS` goes out as fragments. While the channel's `bufferedAmount` is above
 * 1 MiB the writer waits for `bufferedAmountLow` (threshold 256 KiB), the same backpressure as
 * Anywhere's `rtc-duplex.ts`. A writer whose queue passes 64 Mi characters closes itself and calls
 * `onOverflow` once (NFR-5); a channel whose `send` throws closes the writer. Nothing here logs.
 */
import { encodeSharedMessage, type SharedEnvelope } from '@overdeck/contracts';

export const WRITER_HIGH_WATER_BYTES = 1024 * 1024;
export const WRITER_LOW_WATER_BYTES = 256 * 1024;
export const WRITER_MAX_QUEUED_CHARS = 64 * 1024 * 1024;

/** The part of a werift RTCDataChannel the writer uses; tests supply a fake. */
export interface WritableDataChannel {
  readonly readyState: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string): void;
  readonly bufferedAmountLow: { subscribe(listener: () => void): { unSubscribe(): void } };
}

export class ChannelWriter {
  private readonly queue: string[] = [];
  private queuedChars = 0;
  private chunkId = 0;
  private waiting: { unSubscribe(): void } | null = null;
  private closed = false;

  constructor(
    private readonly channel: WritableDataChannel,
    private readonly onOverflow: () => void,
  ) {
    channel.bufferedAmountLowThreshold = WRITER_LOW_WATER_BYTES;
  }

  /** Encodes and queues one envelope; throws RangeError when it is over SHARE_MAX_ENVELOPE_CHARS. */
  send(envelope: SharedEnvelope): void {
    if (this.closed) return;
    const parts = encodeSharedMessage(envelope, ++this.chunkId);
    for (const part of parts) {
      this.queue.push(part);
      this.queuedChars += part.length;
    }
    if (this.queuedChars > WRITER_MAX_QUEUED_CHARS) {
      this.close();
      this.onOverflow();
      return;
    }
    this.flush();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.queuedChars = 0;
    this.waiting?.unSubscribe();
    this.waiting = null;
  }

  private flush(): void {
    if (this.waiting !== null) return;
    while (!this.closed && this.queue.length > 0 && this.channel.readyState === 'open') {
      if (this.channel.bufferedAmount > WRITER_HIGH_WATER_BYTES) {
        const subscription = this.channel.bufferedAmountLow.subscribe(() => {
          subscription.unSubscribe();
          if (this.waiting !== subscription) return;
          this.waiting = null;
          this.flush();
        });
        this.waiting = subscription;
        return;
      }
      const part = this.queue.shift() as string;
      this.queuedChars -= part.length;
      try {
        this.channel.send(part);
      } catch {
        this.close();
        return;
      }
    }
  }
}
