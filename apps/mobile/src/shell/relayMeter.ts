/**
 * Relay metering for channels the phone dials through TURN (PAN-4837 FR-7, fact 11). The phone is
 * the initiator of every channel to a machine and the responder never reports, so the phone reports
 * its own relay bytes as `relay-usage`: every 60 s and when a channel closes, as the machine's
 * `relay-client.ts` does. Bytes count as reported only once the directory socket accepts the frame.
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

  /** Bytes taken from channels but not yet accepted by the directory socket. */
  let unsent = 0;

  /** Send what is owed; a send the socket refuses (it is reconnecting) keeps the rest for the next report. */
  const flush = (): void => {
    while (unsent > 0) {
      const chunk = Math.min(unsent, MAX_REPORT_BYTES);
      if (!send(chunk)) return;
      unsent -= chunk;
    }
  };

  const take = (entry: Tracked): void => {
    const delta = entry.raw.bytesIn + entry.raw.bytesOut - entry.reported;
    if (delta <= 0) return;
    entry.reported += delta;
    unsent += delta;
  };

  const report = (): void => {
    for (const entry of tracked) take(entry);
    flush();
  };

  const timer = setInterval(report, intervalMs);

  return {
    track(raw) {
      const entry: Tracked = { raw, reported: 0 };
      tracked.add(entry);
      raw.once('close', () => {
        tracked.delete(entry);
        take(entry);
        flush();
      });
    },
    stop() {
      clearInterval(timer);
      report();
      tracked.clear();
    },
  };
}
