/**
 * A browser `RTCDataChannel` as a `streamx` `Duplex` (PAN-4833 FR-6; pan-4823 W-WEB1 step 4), the
 * phone's counterpart of the server's `rtc-duplex.ts`, so the secure channel runs over a WebRTC
 * route exactly as it runs over TCP.
 *
 * Writes are split into messages of at most 16 KiB. While the channel's `bufferedAmount` is above
 * 1 MiB the write callback waits for `bufferedamountlow` (threshold 256 KiB), so a large upload
 * applies backpressure instead of filling memory. There is no half-close on a data channel: ending
 * or destroying the stream closes the channel, and a closed channel ends the stream (`end`, then `close`).
 */
import b4a from 'b4a';
import { Duplex } from 'streamx';

export const RTC_MAX_MESSAGE_BYTES = 16 * 1024;
export const RTC_HIGH_WATER_BYTES = 1024 * 1024;
export const RTC_LOW_WATER_BYTES = 256 * 1024;

type Callback = (error: Error | null) => void;

export class RtcDuplexWeb extends Duplex {
  /** `rtc:<first 16 hex of the peer id>`, so nothing treats it as an IP address. */
  readonly remoteAddress: string;
  /** Bytes received and sent on the data channel (ciphertext once the secure channel runs). */
  bytesIn = 0;
  bytesOut = 0;
  private channelClosed = false;
  /** The write callback waiting for `bufferedamountlow`, if any. */
  private waitingWrite: Callback | null = null;

  constructor(
    private readonly channel: RTCDataChannel,
    peerId: string,
  ) {
    super();
    this.remoteAddress = `rtc:${peerId.replace(/-/g, '').slice(0, 16)}`;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = RTC_LOW_WATER_BYTES;
    channel.addEventListener('message', (event: MessageEvent) => {
      if (this.channelClosed) return;
      const data: unknown = event.data;
      const bytes = typeof data === 'string' ? b4a.from(data, 'utf8') : new Uint8Array(data as ArrayBuffer);
      this.bytesIn += bytes.byteLength;
      this.push(bytes);
    });
    channel.addEventListener('close', () => this.onChannelClosed());
    if (channel.readyState === 'closed') queueMicrotask(() => this.onChannelClosed());
  }

  private onChannelClosed(): void {
    if (this.channelClosed) return;
    this.channelClosed = true;
    this.push(null);
    const waiting = this.takeWaitingWrite();
    // Ending both sides lets streamx emit 'end' and then close the stream; a write still waiting
    // for low water can never complete, so it fails (which destroys the stream) instead.
    if (waiting) waiting(new Error('data channel is closed'));
    else this.end(undefined);
  }

  override _read(cb: Callback): void {
    // Data arrives as channel messages; there is no way to pause the remote sender.
    cb(null);
  }

  override _write(data: unknown, cb: Callback): void {
    if (this.channelClosed || this.channel.readyState !== 'open') {
      cb(new Error('data channel is closed'));
      return;
    }
    const chunk = data as Uint8Array<ArrayBuffer>;
    try {
      for (let offset = 0; offset < chunk.byteLength; offset += RTC_MAX_MESSAGE_BYTES) {
        this.channel.send(chunk.subarray(offset, offset + RTC_MAX_MESSAGE_BYTES));
      }
      this.bytesOut += chunk.byteLength;
    } catch (error) {
      cb(error as Error);
      return;
    }
    if (this.channel.bufferedAmount <= RTC_HIGH_WATER_BYTES) {
      cb(null);
      return;
    }
    this.waitingWrite = cb;
    this.channel.addEventListener('bufferedamountlow', this.onLowWater);
  }

  private readonly onLowWater = (): void => {
    this.takeWaitingWrite()?.(null);
  };

  private takeWaitingWrite(): Callback | null {
    const waiting = this.waitingWrite;
    this.waitingWrite = null;
    this.channel.removeEventListener('bufferedamountlow', this.onLowWater);
    return waiting;
  }

  override _final(cb: Callback): void {
    this.closeChannel();
    cb(null);
  }

  override _destroy(cb: Callback): void {
    this.takeWaitingWrite();
    this.closeChannel();
    cb(null);
  }

  private closeChannel(): void {
    if (this.channel.readyState === 'closed' || this.channel.readyState === 'closing') return;
    try {
      this.channel.close();
    } catch {
      // Already closing.
    }
  }
}
