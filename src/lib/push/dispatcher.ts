/**
 * PAN-2354: the needs-you dispatcher.
 *
 * - Rising edge (D-4): each subject keeps its set of pending keys; a key
 *   notifies once, when it first appears, and is forgotten when it goes away
 *   so the next prompt notifies again. `auq:` and `plan:` keys carry globally
 *   unique toolUseIds, so one already active under another subject (a
 *   conversation seen both as an enrichment agent and as a feed row) is not
 *   sent twice. `perm:` keys are per subject.
 * - Startup priming: an item asked more than 60 s before the dispatcher
 *   started is recorded silently, so a restart never replays old questions.
 * - Edge notifications dedup by tag for 24 h (at most 500 tags).
 * - The `events` filter and `enabled` come from config at each dispatch.
 * - Rate limit (D-9): at most 6 per rolling 60 s; the rest are counted and one
 *   summary goes out when the window closes.
 * - Fan-out never throws into the caller; provider errors land in `stats()`.
 */
import type { NormalizedPushConfig, PushEventKind } from '../config-yaml/push-config.js';
import { toNotification, type EdgeNotification, type PendingItem } from './classify.js';
import type { NeedsYouNotification, ProviderSendOutcome, PushProvider } from './types.js';

export const RATE_LIMIT_MAX = 6;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const PRIMING_GRACE_MS = 60_000;
const EDGE_TAG_TTL_MS = 24 * 60 * 60 * 1000;
const EDGE_TAG_MAX = 500;

export interface DispatcherStats {
  sent: number;
  dropped: number;
  rateLimited: number;
  lastError: string | null;
  byProvider: Record<string, { ok: number; failed: number }>;
}

export interface NeedsYouDispatcher {
  observeSubject(subject: string, items: PendingItem[]): void;
  observeEdge(notification: EdgeNotification): void;
  /** Bypasses dedup, config and the rate limit (the operator's Send test). */
  sendNow(notification: NeedsYouNotification): Promise<ProviderSendOutcome[]>;
  hasTargets(): Promise<boolean>;
  stats(): DispatcherStats;
  dispose(): void;
}

function isGloballyUniqueKey(key: string): boolean {
  return key.startsWith('auq:') || key.startsWith('plan:');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createNeedsYouDispatcher(deps: {
  providers: PushProvider[];
  readConfig: () => NormalizedPushConfig;
  now?: () => number;
  startedAt?: number;
}): NeedsYouDispatcher {
  const now = deps.now ?? Date.now;
  const startedAt = deps.startedAt ?? now();
  const subjectKeys = new Map<string, Set<string>>();
  const keyOwners = new Map<string, Set<string>>();
  const edgeTags = new Map<string, number>();
  let windowSends: number[] = [];
  let pendingSummary = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  const stats: DispatcherStats = { sent: 0, dropped: 0, rateLimited: 0, lastError: null, byProvider: {} };

  function providerStats(name: string): { ok: number; failed: number } {
    stats.byProvider[name] ??= { ok: 0, failed: 0 };
    return stats.byProvider[name];
  }

  async function fanOut(n: NeedsYouNotification): Promise<ProviderSendOutcome[]> {
    const settled = await Promise.allSettled(deps.providers.map(provider => provider.send(n)));
    const all: ProviderSendOutcome[] = [];
    let anyOk = false;
    let anyFailed = false;
    settled.forEach((result, index) => {
      const name = deps.providers[index]?.name ?? 'unknown';
      const counters = providerStats(name);
      if (result.status === 'rejected') {
        counters.failed++;
        anyFailed = true;
        stats.lastError = `${name}: ${errorMessage(result.reason)}`;
        return;
      }
      for (const outcome of result.value) {
        all.push(outcome);
        if (outcome.ok) {
          counters.ok++;
          anyOk = true;
        } else {
          counters.failed++;
          anyFailed = true;
          stats.lastError = `${name}: ${outcome.reason}${outcome.status ? ` (${outcome.status})` : ''}`;
        }
      }
    });
    if (anyFailed && !anyOk) stats.dropped++;
    return all;
  }

  function deliver(n: NeedsYouNotification): void {
    stats.sent++;
    fanOut(n).catch((error: unknown) => {
      stats.lastError = errorMessage(error);
    });
  }

  function scheduleSummary(): void {
    if (summaryTimer !== null) return;
    const oldest = windowSends[0] ?? now();
    const delay = Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - now());
    summaryTimer = setTimeout(() => {
      summaryTimer = null;
      const count = pendingSummary;
      pendingSummary = 0;
      if (count === 0) return;
      windowSends.push(now());
      deliver({
        kind: 'summary',
        tag: 'summary',
        title: `${count} more items need you`,
        publicTitle: `${count} more items need you`,
        body: 'Open Overdeck to see them.',
        url: '/m',
        issueId: null,
        ts: new Date(now()).toISOString(),
      });
    }, delay);
  }

  function dispatch(n: NeedsYouNotification): void {
    try {
      const cfg = deps.readConfig();
      if (!cfg.enabled) return;
      if (!cfg.events.includes(n.kind as PushEventKind)) return;
      const t = now();
      windowSends = windowSends.filter(sentAt => sentAt > t - RATE_LIMIT_WINDOW_MS);
      if (windowSends.length >= RATE_LIMIT_MAX) {
        stats.rateLimited++;
        pendingSummary++;
        scheduleSummary();
        return;
      }
      windowSends.push(t);
      deliver(n);
    } catch (error) {
      stats.lastError = errorMessage(error);
    }
  }

  function primed(item: PendingItem): boolean {
    if (item.askedAt === null) return false;
    const askedAt = Date.parse(item.askedAt);
    return Number.isFinite(askedAt) && askedAt < startedAt - PRIMING_GRACE_MS;
  }

  return {
    observeSubject(subject, items) {
      try {
        const previous = subjectKeys.get(subject) ?? new Set<string>();
        const next = new Set(items.map(item => item.key));
        let includePreview: boolean | null = null;

        for (const item of items) {
          if (previous.has(item.key)) continue;
          const owners = keyOwners.get(item.key);
          const activeElsewhere = isGloballyUniqueKey(item.key) && owners !== undefined && owners.size > 0;
          if (activeElsewhere || primed(item)) continue;
          includePreview ??= deps.readConfig().includePreview;
          dispatch(toNotification(item, { includePreview, now: new Date(now()).toISOString() }));
        }

        for (const key of previous) {
          if (next.has(key)) continue;
          const owners = keyOwners.get(key);
          owners?.delete(subject);
          if (owners?.size === 0) keyOwners.delete(key);
        }
        for (const key of next) {
          if (!isGloballyUniqueKey(key)) continue;
          const owners = keyOwners.get(key) ?? new Set<string>();
          owners.add(subject);
          keyOwners.set(key, owners);
        }
        if (next.size === 0) subjectKeys.delete(subject);
        else subjectKeys.set(subject, next);
      } catch (error) {
        stats.lastError = errorMessage(error);
      }
    },

    observeEdge(notification) {
      const t = now();
      for (const [tag, seenAt] of edgeTags) {
        if (seenAt > t - EDGE_TAG_TTL_MS) break;
        edgeTags.delete(tag);
      }
      if (edgeTags.has(notification.tag)) return;
      edgeTags.set(notification.tag, t);
      while (edgeTags.size > EDGE_TAG_MAX) {
        const oldest = edgeTags.keys().next().value;
        if (oldest === undefined) break;
        edgeTags.delete(oldest);
      }
      dispatch({ ...notification, ts: new Date(t).toISOString() });
    },

    sendNow(notification) {
      stats.sent++;
      return fanOut(notification);
    },

    async hasTargets() {
      try {
        if (!deps.readConfig().enabled) return false;
        const results = await Promise.allSettled(deps.providers.map(provider => provider.hasTargets()));
        return results.some(result => result.status === 'fulfilled' && result.value);
      } catch (error) {
        stats.lastError = errorMessage(error);
        return false;
      }
    },

    stats() {
      return { ...stats, byProvider: Object.fromEntries(Object.entries(stats.byProvider).map(([k, v]) => [k, { ...v }])) };
    },

    dispose() {
      if (summaryTimer !== null) clearTimeout(summaryTimer);
      summaryTimer = null;
    },
  };
}
