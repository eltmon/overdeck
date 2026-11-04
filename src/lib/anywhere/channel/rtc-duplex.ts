/**
 * A WebRTC data channel as a Node `Duplex` (PRD PAN-2356 WI-10, D-2356-11), so the secure channel
 * (`openChannelOverTransport`, `acceptChannel`) runs over a `direct` or `relay` route exactly as it
 * runs over TCP.
 *
 * Writes are split into messages of at most 16 KiB. While the channel's `bufferedAmount` is above
 * 1 MiB the write callback waits for `bufferedamountlow` (threshold 256 KiB), so a large response
 * applies backpressure instead of filling memory. There is no half-close on a data channel: ending
 * or destroying the stream closes the channel, and a closed channel ends and closes the stream.
 */
import { Duplex } from 'node:stream';
import type { RTCDataChannel } from 'werift';

export const RTC_MAX_MESSAGE_BYTES = 16 * 1024;
export const RTC_HIGH_WATER_BYTES = 1024 * 1024;
export const RTC_LOW_WATER_BYTES = 256 * 1024;

export class RtcDuplex extends Duplex {
  /** `rtc:<first 16 hex of the peer environment id>`, so nothing treats it as an IP address. */
  readonly remoteAddress: string;
  /** Bytes received and sent on the data channel (ciphertext once the secure channel runs; relay metering). */
  bytesIn = 0;
  bytesOut = 0;
  private channelClosed = false;

  constructor(
    private readonly channel: RTCDataChannel,
    peerEnvironmentId: string,
  ) {
    super({ allowHalfOpen: false });
    this.remoteAddress = `rtc:${peerEnvironmentId.replace(/-/g, '').slice(0, 16)}`;
    channel.bufferedAmountLowThreshold = RTC_LOW_WATER_BYTES;
    channel.onMessage.subscribe((data) => {
      if (this.channelClosed) return;
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
      this.bytesIn += bytes.byteLength;
      this.push(bytes);
    });
    channel.stateChanged.subscribe((state) => {
      if (state === 'closed') this.onChannelClosed();
    });
    if (channel.readyState === 'closed') queueMicrotask(() => this.onChannelClosed());
  }

  private onChannelClosed(): void {
    if (this.channelClosed) return;
    this.channelClosed = true;
    this.push(null);
    this.destroy();
  }

  override _read(): void {
    // Data arrives as channel messages; there is no way to pause the remote sender.
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.channelClosed || this.channel.readyState !== 'open') {
      callback(new Error('data channel is closed'));
      return;
    }
    try {
      for (let offset = 0; offset < chunk.byteLength; offset += RTC_MAX_MESSAGE_BYTES) {
        this.channel.send(chunk.subarray(offset, offset + RTC_MAX_MESSAGE_BYTES));
      }
      this.bytesOut += chunk.byteLength;
    } catch (error) {
      callback(error as Error);
      return;
    }
    if (this.channel.bufferedAmount <= RTC_HIGH_WATER_BYTES) {
      callback();
      return;
    }
    const { unSubscribe } = this.channel.bufferedAmountLow.subscribe(() => {
      unSubscribe();
      callback();
    });
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closeChannel();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.closeChannel();
    callback(error);
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
