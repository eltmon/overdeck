/**
 * Relay metering for channels the phone dials through TURN (PAN-4837 FR-7, fact 11). The phone is
 * the initiator of every channel to a machine and the responder never reports, so the phone reports
 * its own relay bytes as `relay-usage`: every 60 s and when a channel closes, as the machine's
 * `relay-client.ts` does.
 */
export const RELAY_REPORT_INTERVAL_MS = 60_000;
/** The directory accepts at most 1e9 bytes per report. */
export const MAX_REPORT_BYTES = 1_000_000_000;

/** A relayed raw duplex with its byte counters (an `RtcDuplexWeb`). */
export interface MeteredRaw {
  readonly bytesIn: number;
  readonly bytesOut: number;
  once(event: 'close', listener: () => void): unknown;
}

export interface RelayMeter {
  track(raw: MeteredRaw): void;
  /** Report what is left and stop the timer. */
  stop(): void;
}

interface Tracked {
  raw: MeteredRaw;
  reported: number;
}

export function createRelayMeter(
  send: (bytes: number) => boolean,
  { intervalMs = RELAY_REPORT_INTERVAL_MS }: { intervalMs?: number } = {},
): RelayMeter {
  const tracked = new Set<Tracked>();

  const sendBytes = (bytes: number): void => {
    for (let left = bytes; left > 0; left -= MAX_REPORT_BYTES) send(Math.min(left, MAX_REPORT_BYTES));
  };

  const take = (entry: Tracked): number => {
    const delta = entry.raw.bytesIn + entry.raw.bytesOut - entry.reported;
    if (delta <= 0) return 0;
    entry.reported += delta;
    return delta;
  };

  const report = (): void => {
    let total = 0;
    for (const entry of tracked) total += take(entry);
    if (total > 0) sendBytes(total);
  };

  const timer = setInterval(report, intervalMs);

  return {
    track(raw) {
      const entry: Tracked = { raw, reported: 0 };
      tracked.add(entry);
      raw.once('close', () => {
        tracked.delete(entry);
        const delta = take(entry);
        if (delta > 0) sendBytes(delta);
      });
    },
    stop() {
      clearInterval(timer);
      report();
      tracked.clear();
    },
  };
}
