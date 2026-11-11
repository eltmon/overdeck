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
 * - PAN-5111 history: every delivered push that reached at least one target is
 *   recorded through the injected `PushHistorySink`, with outcome codes only
 *   (never provider detail). When a pushed `auq:`/`plan:`/`perm:` key leaves the
 *   pending set (its last owner drops it), the resolution is recorded
 *   `RESOLVE_GRACE_MS` later: `answered` when `wasAnswered` finds an operator
 *   answer note in the answer window (delivery to departure plus the grace,
 *   closed early by a re-push of the same key), else `resolved-without-answer`.
 *   `dispose()` records pending resolutions at once.
 * - Adoption (D-8): a primed key re-adopts the newest unresolved history entry
 *   for it, so a departure after a restart still resolves that entry.
 * - `observeSubject(…, { notify: false })` records departures only: new keys are
 *   neither pushed nor registered (D-8a, used while there is no push target).
 */
import { randomUUID } from 'node:crypto';
import type { NormalizedPushConfig, PushEventKind } from '../config-yaml/push-config.js';
import { toNotification, type EdgeNotification, type PendingItem } from './classify.js';
import type {
  NeedsYouNotification,
  ProviderSendOutcome,
  PushDelivery,
  PushHistorySink,
  PushProvider,
} from './types.js';

export const RATE_LIMIT_MAX = 6;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const PRIMING_GRACE_MS = 60_000;
const EDGE_TAG_TTL_MS = 24 * 60 * 60 * 1000;
const EDGE_TAG_MAX = 500;
/** D-7: how long a departed key waits before its resolution is recorded. */
export const RESOLVE_GRACE_MS = 10_000;

export interface DispatcherStats {
  sent: number;
  dropped: number;
  rateLimited: number;
  lastError: string | null;
  byProvider: Record<string, { ok: number; failed: number }>;
}

export interface NeedsYouDispatcher {
  /** `notify: false` records departures only; new keys are neither pushed nor registered (D-8a). */
  observeSubject(subject: string, items: PendingItem[], opts?: { notify?: boolean }): void;
  observeEdge(notification: EdgeNotification): void;
  /** Bypasses dedup, config and the rate limit (the operator's Send test). */
  sendNow(notification: NeedsYouNotification): Promise<ProviderSendOutcome[]>;
  hasTargets(): Promise<boolean>;
  stats(): DispatcherStats;
  /** PAN-5111: ids of history entries whose key is pending or awaiting its resolution. */
  trackedIds(): ReadonlySet<string>;
  /** PAN-5111: true when `key` is pending for `subject` now (any subject for `auq:`/`plan:`). */
  isPending(subject: string, key: string): boolean;
  /** PAN-5111: true when any tracked entry belongs to a `conv:` subject. */
  tracksConversations(): boolean;
  dispose(): void;
}

interface TrackedEntry {
  id: string;
  key: string;
  subject: string;
  deliveredAt: number;
}

interface ScheduledResolution {
  entry: TrackedEntry;
  tk: string;
  windowEnd: number;
  timer: ReturnType<typeof setTimeout>;
}

function isGloballyUniqueKey(key: string): boolean {
  return key.startsWith('auq:') || key.startsWith('plan:');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One outcome as stored: reason and status only, never `detail` (D-4). */
function storedDelivery(provider: string, outcome: ProviderSendOutcome): PushDelivery {
  if (outcome.ok) return { provider, target: outcome.target, ok: true };
  const delivery: PushDelivery = { provider, target: outcome.target, ok: false, reason: outcome.reason };
  if (outcome.status !== undefined) delivery.status = outcome.status;
  return delivery;
}

function trackKey(subject: string, key: string): string {
  return isGloballyUniqueKey(key) ? key : `${subject}\u0000${key}`;
}

export function createNeedsYouDispatcher(deps: {
  providers: PushProvider[];
  readConfig: () => NormalizedPushConfig;
  now?: () => number;
  startedAt?: number;
  /** PAN-5111: where delivered pushes and resolutions are recorded. */
  history?: PushHistorySink;
  /** D-7: true when the operator answered `key` through Overdeck inside [fromMs, toMs]. */
  wasAnswered?: (key: string, fromMs: number, toMs: number) => boolean;
  newId?: () => string;
}): NeedsYouDispatcher {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const startedAt = deps.startedAt ?? now();
  const subjectKeys = new Map<string, Set<string>>();
  const keyOwners = new Map<string, Set<string>>();
  const edgeTags = new Map<string, number>();
  let windowSends: number[] = [];
  let pendingSummary = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  const stats: DispatcherStats = { sent: 0, dropped: 0, rateLimited: 0, lastError: null, byProvider: {} };
  /** trackKey → the history entry of the latest delivered (or adopted) push of that key. */
  const tracked = new Map<string, TrackedEntry>();
  /** entry id → its pending resolution. */
  const scheduled = new Map<string, ScheduledResolution>();

  function providerStats(name: string): { ok: number; failed: number } {
    stats.byProvider[name] ??= { ok: 0, failed: 0 };
    return stats.byProvider[name];
  }

  async function fanOut(n: NeedsYouNotification): Promise<{ outcomes: ProviderSendOutcome[]; deliveries: PushDelivery[] }> {
    const settled = await Promise.allSettled(deps.providers.map(provider => provider.send(n)));
    const all: ProviderSendOutcome[] = [];
    const deliveries: PushDelivery[] = [];
    let anyOk = false;
    let anyFailed = false;
    settled.forEach((result, index) => {
      const name = deps.providers[index]?.name ?? 'unknown';
      const counters = providerStats(name);
      if (result.status === 'rejected') {
        counters.failed++;
        anyFailed = true;
        stats.lastError = `${name}: ${errorMessage(result.reason)}`;
        // The rejection message stays out of history (D-4).
        deliveries.push({ provider: name, target: name, ok: false, reason: 'error' });
        return;
      }
      for (const outcome of result.value) {
        all.push(outcome);
        deliveries.push(storedDelivery(name, outcome));
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
    return { outcomes: all, deliveries };
  }

  function recordSent(id: string, n: NeedsYouNotification, subject: string | null, deliveries: PushDelivery[]): void {
    if (deliveries.length === 0) {
      // No target was reached, so nothing was sent (D-4): forget the entry.
      for (const [tk, entry] of tracked) if (entry.id === id) tracked.delete(tk);
      const pending = scheduled.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        scheduled.delete(id);
      }
      return;
    }
    try {
      deps.history?.recordSent({
        id,
        ts: n.ts,
        kind: n.kind,
        category: n.category,
        key: n.tag,
        subject,
        title: n.title,
        issueId: n.issueId,
        url: n.url,
        deliveries,
      });
    } catch (error) {
      stats.lastError = errorMessage(error);
    }
  }

  function deliver(n: NeedsYouNotification, subject: string | null): string {
    const id = newId();
    stats.sent++;
    fanOut(n)
      .then(({ deliveries }) => recordSent(id, n, subject, deliveries))
      .catch((error: unknown) => {
        stats.lastError = errorMessage(error);
      });
    return id;
  }

  function resolveNow(id: string): void {
    const pending = scheduled.get(id);
    if (!pending) return;
    scheduled.delete(id);
    const { entry, tk, windowEnd } = pending;
    if (tracked.get(tk)?.id === id) tracked.delete(tk);
    try {
      const answered = deps.wasAnswered?.(entry.key, entry.deliveredAt, windowEnd) === true;
      deps.history?.recordResolution({
        id,
        ts: new Date(now()).toISOString(),
        outcome: answered ? 'answered' : 'resolved-without-answer',
      });
    } catch (error) {
      stats.lastError = errorMessage(error);
    }
  }

  function scheduleResolve(tk: string): void {
    const entry = tracked.get(tk);
    if (!entry || scheduled.has(entry.id)) return;
    const timer = setTimeout(() => resolveNow(entry.id), RESOLVE_GRACE_MS);
    scheduled.set(entry.id, { entry, tk, windowEnd: now() + RESOLVE_GRACE_MS, timer });
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
        category: 'summary',
        tag: 'summary',
        title: `${count} more items need you`,
        publicTitle: `${count} more items need you`,
        body: 'Open Overdeck to see them.',
        url: '/m',
        issueId: null,
        ts: new Date(now()).toISOString(),
      }, null);
    }, delay);
  }

  /** Returns the delivered entry id, or null when nothing was delivered. */
  function dispatch(n: NeedsYouNotification, subject: string | null): string | null {
    try {
      const cfg = deps.readConfig();
      if (!cfg.enabled) return null;
      if (!cfg.events.includes(n.kind as PushEventKind)) return null;
      const t = now();
      windowSends = windowSends.filter(sentAt => sentAt > t - RATE_LIMIT_WINDOW_MS);
      if (windowSends.length >= RATE_LIMIT_MAX) {
        stats.rateLimited++;
        pendingSummary++;
        scheduleSummary();
        return null;
      }
      windowSends.push(t);
      return deliver(n, subject);
    } catch (error) {
      stats.lastError = errorMessage(error);
      return null;
    }
  }

  function primed(item: PendingItem): boolean {
    if (item.askedAt === null) return false;
    const askedAt = Date.parse(item.askedAt);
    return Number.isFinite(askedAt) && askedAt < startedAt - PRIMING_GRACE_MS;
  }

  return {
    observeSubject(subject, items, opts) {
      try {
        const notify = opts?.notify !== false;
        const previous = subjectKeys.get(subject) ?? new Set<string>();
        const incoming = new Set(items.map(item => item.key));
        // Without notify, new keys are not registered: they push later, once a target exists.
        const next = notify ? incoming : new Set([...previous].filter(key => incoming.has(key)));
        let includePreview: boolean | null = null;

        for (const item of notify ? items : []) {
          if (previous.has(item.key)) continue;
          const owners = keyOwners.get(item.key);
          const activeElsewhere = isGloballyUniqueKey(item.key) && owners !== undefined && owners.size > 0;
          if (activeElsewhere) continue;
          const tk = trackKey(subject, item.key);
          if (primed(item)) {
            // D-8: re-adopt the open history entry this key was pushed under before a restart.
            if (tracked.has(tk)) continue;
            const open = deps.history?.openEntryIdFor(subject, item.key) ?? null;
            if (open) {
              const deliveredAt = Date.parse(open.ts);
              tracked.set(tk, { id: open.id, key: item.key, subject, deliveredAt: Number.isFinite(deliveredAt) ? deliveredAt : now() });
            }
            continue;
          }
          includePreview ??= deps.readConfig().includePreview;
          const id = dispatch(toNotification(item, { includePreview, now: new Date(now()).toISOString() }), subject);
          if (id === null) continue;
          const t = now();
          // D-7: a re-push of the same key closes the earlier entry's answer window.
          for (const pending of scheduled.values()) {
            if (pending.tk === tk) pending.windowEnd = Math.min(pending.windowEnd, t);
          }
          tracked.set(tk, { id, key: item.key, subject, deliveredAt: t });
        }

        for (const key of previous) {
          if (next.has(key)) continue;
          const owners = keyOwners.get(key);
          owners?.delete(subject);
          if (owners?.size === 0) keyOwners.delete(key);
          if (!isGloballyUniqueKey(key)) scheduleResolve(trackKey(subject, key));
          else if (!keyOwners.has(key)) scheduleResolve(key);
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
      dispatch({ ...notification, ts: new Date(t).toISOString() }, null);
    },

    async sendNow(notification) {
      const id = newId();
      stats.sent++;
      const { outcomes, deliveries } = await fanOut(notification);
      recordSent(id, notification, null, deliveries);
      return outcomes;
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

    trackedIds() {
      const ids = new Set<string>();
      for (const entry of tracked.values()) ids.add(entry.id);
      for (const id of scheduled.keys()) ids.add(id);
      return ids;
    },

    isPending(subject, key) {
      if (isGloballyUniqueKey(key)) return keyOwners.has(key);
      return subjectKeys.get(subject)?.has(key) === true;
    },

    tracksConversations() {
      for (const entry of tracked.values()) if (entry.subject.startsWith('conv:')) return true;
      for (const pending of scheduled.values()) if (pending.entry.subject.startsWith('conv:')) return true;
      return false;
    },

    dispose() {
      for (const [id, pending] of [...scheduled]) {
        clearTimeout(pending.timer);
        resolveNow(id);
      }
      if (summaryTimer !== null) clearTimeout(summaryTimer);
      summaryTimer = null;
    },
  };
}
