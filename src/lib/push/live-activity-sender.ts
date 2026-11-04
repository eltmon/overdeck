/**
 * PAN-4839: the machine half of the counts-only Live Activity. Every
 * `LIVE_ACTIVITY_POLL_MS` it reads this machine's two counts and, when they are
 * due, sends one `push-activity` frame per paired phone to the overdeck.ai
 * directory, which sums the machines' reports and pushes them to APNs.
 *
 * A Live Activity is drawn by iOS with no app code in between, so it cannot be
 * end-to-end encrypted (OD-1): the frame carries the phone's clientId and the
 * two counts, nothing else.
 *
 * Throttle (D-6): a change goes out at most every `LIVE_ACTIVITY_MIN_INTERVAL_MS`
 * (the first tick after the window sends the latest counts); unchanged counts
 * are re-sent every `LIVE_ACTIVITY_KEEPALIVE_MS` so the directory's report stays
 * fresh. A phone paired since the last send gets the counts at the next tick.
 */
import { ACTIVITY_COUNT_MAX, type LiveActivityCounts } from '@overdeck/contracts';
import type { PushDirectoryPort } from './native-provider.js';

export const LIVE_ACTIVITY_POLL_MS = 5_000;
export const LIVE_ACTIVITY_MIN_INTERVAL_MS = 15_000;
export const LIVE_ACTIVITY_KEEPALIVE_MS = 300_000;

export interface LiveActivitySenderDeps {
  counts(): Promise<LiveActivityCounts>;
  /** clientIds of active phone records. */
  phones(): string[];
  directory(): Pick<PushDirectoryPort, 'isOnline' | 'send'> | null;
  now?: () => number;
}

export interface LiveActivitySender {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n), 0), ACTIVITY_COUNT_MAX);
}

export function createLiveActivitySender(deps: LiveActivitySenderDeps): LiveActivitySender {
  const now = deps.now ?? Date.now;
  let lastSent: LiveActivityCounts | null = null;
  let lastSentAt = 0;
  let sentTo = new Set<string>();
  let countsFailed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  /** Sends the counts to each phone; returns the phones whose `send` was accepted. */
  function sendTo(port: Pick<PushDirectoryPort, 'send'>, phones: readonly string[], counts: LiveActivityCounts): string[] {
    return phones.filter((to) => port.send({ type: 'push-activity', to, needsYou: counts.needsYou, running: counts.running }));
  }

  async function tick(): Promise<void> {
    const phones = deps.phones();
    const port = deps.directory();
    if (phones.length === 0 || port === null || !port.isOnline()) {
      // The next online tick sends at once: the directory may have lost our report meanwhile.
      lastSent = null;
      sentTo = new Set();
      return;
    }
    let raw: LiveActivityCounts;
    try {
      raw = await deps.counts();
      countsFailed = false;
    } catch (error) {
      if (!countsFailed) console.warn(`[live-activity] counts failed: ${error instanceof Error ? error.message : String(error)}`);
      countsFailed = true;
      return;
    }
    const counts: LiveActivityCounts = { needsYou: clampCount(raw.needsYou), running: clampCount(raw.running) };
    const at = now();
    const changed = lastSent === null || lastSent.needsYou !== counts.needsYou || lastSent.running !== counts.running;
    const elapsed = at - lastSentAt;
    const due = lastSent === null || (changed ? elapsed >= LIVE_ACTIVITY_MIN_INTERVAL_MS : elapsed >= LIVE_ACTIVITY_KEEPALIVE_MS);
    if (!due) {
      // A phone paired since the last send gets the counts now; the others wait for their window.
      const newcomers = phones.filter((to) => !sentTo.has(to));
      for (const to of sendTo(port, newcomers, counts)) sentTo.add(to);
      return;
    }
    const accepted = sendTo(port, phones, counts);
    if (accepted.length === 0) return;
    lastSent = counts;
    lastSentAt = at;
    sentTo = new Set(accepted);
  }

  return {
    tick,
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        void tick().finally(() => {
          inFlight = false;
        });
      }, LIVE_ACTIVITY_POLL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
