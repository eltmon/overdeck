/**
 * The relay add-on on this machine (PRD PAN-2356 WI-17, D-2356-12, FR-21).
 *
 * Every `relay` data channel this machine dials (it is the initiator, so it fetched the TURN
 * credentials) is tracked. Every 60 s, and when a channel closes, the client reports the bytes
 * moved since the last report as `relay-usage`; the responder never reports, so each channel is
 * counted once. When the directory says the month's allowance is used (`relay-status stopped`),
 * every tracked channel is closed and no new relay dial is made, so the link supervisor falls back
 * to whatever else answers.
 */
import type { Duplex } from 'node:stream';
import { RELAY_CAP_MESSAGE, type DirectoryToMachineFrame, type MachineToDirectoryFrame, type RelayStatus } from '@overdeck/contracts';

export const RELAY_REPORT_INTERVAL_MS = 60_000;
/** The directory accepts at most 1e9 bytes per report. */
export const MAX_REPORT_BYTES = 1_000_000_000;
export const RELAY_PLAN_MESSAGE = 'The relay needs the relay plan';

/** A relay data channel's raw transport with its byte counters (an `RtcDuplex`). */
export type MeteredTransport = Duplex & { bytesIn: number; bytesOut: number };

export interface RelayDirectory {
  send(frame: MachineToDirectoryFrame): boolean;
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void): () => void;
  /** The account's plan includes the relay, as the last `welcome` said. */
  relayEntitled(): boolean;
  /** The directory's last relay status. */
  relayStatus(): RelayStatus | null;
}

interface Tracked {
  raw: MeteredTransport;
  reported: number;
}

export class RelayClient {
  private readonly tracked = new Set<Tracked>();
  private timer: NodeJS.Timeout | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly directory: RelayDirectory) {}

  start(): void {
    this.offs.push(
      this.directory.on('relay-status', (frame) => {
        if (frame.stopped) this.closeAll();
      }),
    );
    this.timer = setInterval(() => this.report(), RELAY_REPORT_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.offs.splice(0)) off();
    this.report();
    this.tracked.clear();
  }

  /** The plan includes the relay and this month's allowance is not used up. */
  relayEntitled(): boolean {
    return this.directory.relayEntitled() && this.directory.relayStatus()?.stopped !== true;
  }

  /** Why a relay dial is refused now, or null when it may go ahead. */
  refusal(): string | null {
    if (!this.directory.relayEntitled()) return RELAY_PLAN_MESSAGE;
    if (this.directory.relayStatus()?.stopped === true) return RELAY_CAP_MESSAGE;
    return null;
  }

  /** The directory's relay status and whether a relay channel is open now. */
  relayStatus(): { status: RelayStatus | null; using: boolean } {
    const using = [...this.tracked].some((t) => !t.raw.destroyed);
    return { status: this.directory.relayStatus(), using };
  }

  /** Meter one relay channel this machine dialed. */
  track(raw: MeteredTransport): void {
    const entry: Tracked = { raw, reported: 0 };
    this.tracked.add(entry);
    raw.once('close', () => {
      this.reportOne(entry);
      this.tracked.delete(entry);
    });
  }

  private unreported(entry: Tracked): number {
    return entry.raw.bytesIn + entry.raw.bytesOut - entry.reported;
  }

  private send(bytes: number): void {
    for (let left = bytes; left > 0; left -= MAX_REPORT_BYTES) {
      this.directory.send({ type: 'relay-usage', bytes: Math.min(left, MAX_REPORT_BYTES) });
    }
  }

  private reportOne(entry: Tracked): void {
    const delta = this.unreported(entry);
    if (delta <= 0) return;
    entry.reported += delta;
    this.send(delta);
  }

  /** One report with the bytes every tracked channel moved since the last one. */
  report(): void {
    let total = 0;
    for (const entry of this.tracked) {
      const delta = this.unreported(entry);
      if (delta <= 0) continue;
      entry.reported += delta;
      total += delta;
    }
    if (total > 0) this.send(total);
  }

  private closeAll(): void {
    for (const entry of [...this.tracked]) entry.raw.destroy();
  }
}

let current: RelayClient | null = null;

export function setRelayClient(client: RelayClient | null): void {
  current = client;
}

export function currentRelayClient(): RelayClient | null {
  return current;
}
