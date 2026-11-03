/**
 * PAN-2354: needs-you push — tell the operator's phone when an agent or
 * conversation asks a question, waits for approval, finishes or fails.
 *
 * Four sources feed one dispatcher (D-3):
 *   1. `agent.enrichment_changed` — agent questions (including `pan ask`
 *      decisions), plan approvals and permission prompts.
 *   2. The conversation pending-input feed, scanned every 5 s, but only while a
 *      push target exists (a Web Push subscription, a ready ntfy topic, or a
 *      phone with a push key while the directory is online).
 *   3. Instant wake: the AskUserQuestion hook heartbeat and
 *      `conversation.permission_changed` (waiting) call `wakeNeedsYouPush()`,
 *      which after a 500 ms debounce scans conversations and polls enrichment.
 *   4. Edge events: `agent.heartbeat_dead` and selected `pipeline.journal`
 *      entries (finished / failed).
 *
 * Providers: Web Push, optional ntfy, and the Overdeck app (`native`, PAN-4843).
 *
 * Runs in the primary dashboard only; a peer would send every push twice.
 * Nothing here throws into the event-store subscriber.
 */
import { loadConfigSync } from '../../../lib/config-yaml.js';
import type { PushEventKind } from '../../../lib/config-yaml/push-config.js';
import {
  edgeNotificationFromEvent,
  pendingItemsFromConversationRow,
  pendingItemsFromEnrichment,
  type ConversationRowLike,
  type EnrichmentPayloadLike,
} from '../../../lib/push/classify.js';
import { createNeedsYouDispatcher, type DispatcherStats, type NeedsYouDispatcher } from '../../../lib/push/dispatcher.js';
import { createNativePushProvider, nativePushPhones } from '../../../lib/push/native-provider.js';
import { createNtfyProvider } from '../../../lib/push/ntfy-provider.js';
import { listPushSubscriptions } from '../../../lib/push/subscription-store.js';
import type { ProviderSendOutcome, PushProvider } from '../../../lib/push/types.js';
import { createWebPushProvider } from '../../../lib/push/webpush-provider.js';
import { getEventStore, type EventStore, type Unsubscribe } from '../event-store.js';
import { pollEnrichmentNow } from './agent-enrichment-service.js';
import { currentDirectoryClient } from './directory-client.js';

export const CONVERSATION_SCAN_INTERVAL_MS = 5_000;
export const WAKE_DEBOUNCE_MS = 500;

export interface PushStatus {
  enabled: boolean;
  events: PushEventKind[];
  includePreview: boolean;
  webpush: {
    subscriptions: Array<{
      id: string;
      label: string;
      host: string;
      createdAt: string;
      lastSuccessAt: string | null;
      failureCount: number;
      thisDevice: boolean;
    }>;
  };
  ntfy: { state: 'off' | 'misconfigured' | 'ready'; reason?: string; host?: string; topicHint?: string };
  native: { phones: number; directoryOnline: boolean };
  stats: DispatcherStats;
}

interface ServiceState {
  dispatcher: NeedsYouDispatcher;
  readConversationFeed: () => Promise<{ body: unknown; status?: number }>;
  unsubscribe: Unsubscribe;
  scanTimer: ReturnType<typeof setInterval>;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  scanInFlight: boolean;
  conversationSubjects: Set<string>;
}

let state: ServiceState | null = null;

const readPushConfig = () => loadConfigSync().config.push;

export function defaultProviders(): PushProvider[] {
  return [createWebPushProvider(), createNtfyProvider(), createNativePushProvider({ directory: currentDirectoryClient })];
}

const EMPTY_STATS: DispatcherStats = { sent: 0, dropped: 0, rateLimited: 0, lastError: null, byProvider: {} };

async function scanConversations(): Promise<void> {
  const current = state;
  if (current === null || current.scanInFlight) return;
  current.scanInFlight = true;
  try {
    if (!(await current.dispatcher.hasTargets())) return;
    const result = await current.readConversationFeed();
    if (result.status !== undefined || !Array.isArray(result.body)) return;
    const seen = new Set<string>();
    for (const row of result.body as ConversationRowLike[]) {
      if (!row || typeof row.name !== 'string') continue;
      const { subject, items } = pendingItemsFromConversationRow(row);
      seen.add(subject);
      current.dispatcher.observeSubject(subject, items);
    }
    // Answered items clear, so the next question in that conversation notifies.
    for (const subject of current.conversationSubjects) {
      if (!seen.has(subject)) current.dispatcher.observeSubject(subject, []);
    }
    current.conversationSubjects = seen;
  } catch (error) {
    console.warn('[push] conversation scan failed:', error instanceof Error ? error.message : error);
  } finally {
    current.scanInFlight = false;
  }
}

/** Debounced (500 ms): scan conversations and poll enrichment now. */
export function wakeNeedsYouPush(_reason: string): void {
  const current = state;
  if (current === null || current.wakeTimer !== null) return;
  current.wakeTimer = setTimeout(() => {
    current.wakeTimer = null;
    void scanConversations();
    pollEnrichmentNow();
  }, WAKE_DEBOUNCE_MS);
}

export function startNeedsYouPushService(deps: {
  readConversationFeed: () => Promise<{ body: unknown; status?: number }>;
  store?: Pick<EventStore, 'subscribe'>;
  providers?: PushProvider[];
}): void {
  if (state !== null) return;
  const dispatcher = createNeedsYouDispatcher({ providers: deps.providers ?? defaultProviders(), readConfig: readPushConfig });
  const store = deps.store ?? getEventStore();

  const unsubscribe = store.subscribe((event) => {
    try {
      if (event.type === 'agent.enrichment_changed') {
        const { subject, items } = pendingItemsFromEnrichment(event.payload as EnrichmentPayloadLike);
        dispatcher.observeSubject(subject, items);
      } else if (event.type === 'agent.heartbeat_dead' || event.type === 'pipeline.journal') {
        const edge = edgeNotificationFromEvent(event);
        if (edge) dispatcher.observeEdge(edge);
      } else if (event.type === 'conversation.permission_changed') {
        if ((event.payload as { waiting?: unknown }).waiting === true) wakeNeedsYouPush('permission');
      }
    } catch (error) {
      console.warn('[push] event handling failed:', error instanceof Error ? error.message : error);
    }
  });

  state = {
    dispatcher,
    readConversationFeed: deps.readConversationFeed,
    unsubscribe,
    scanTimer: setInterval(() => { void scanConversations(); }, CONVERSATION_SCAN_INTERVAL_MS),
    wakeTimer: null,
    scanInFlight: false,
    conversationSubjects: new Set(),
  };
}

export function stopNeedsYouPushService(): void {
  const current = state;
  if (current === null) return;
  state = null;
  current.unsubscribe();
  clearInterval(current.scanTimer);
  if (current.wakeTimer !== null) clearTimeout(current.wakeTimer);
  current.dispatcher.dispose();
}

/** Send a test notification to every target, bypassing dedup and the rate limit. */
export function sendTestPush(): Promise<ProviderSendOutcome[]> {
  const dispatcher = state?.dispatcher ?? createNeedsYouDispatcher({ providers: defaultProviders(), readConfig: readPushConfig });
  return dispatcher.sendNow({
    kind: 'test',
    tag: 'test',
    title: 'Overdeck test notification',
    publicTitle: 'Overdeck test notification',
    body: 'Push works on this device.',
    url: '/m',
    issueId: null,
    ts: new Date().toISOString(),
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

/**
 * Status for the Settings panel. Never carries secret material (NFR-4): no
 * subscription keys or full endpoints, no ntfy token, and only a topic hint.
 */
export async function getNeedsYouPushStatus(callerDeviceId: string | null = null): Promise<PushStatus> {
  const cfg = readPushConfig();
  const records = await listPushSubscriptions();
  const ntfy: PushStatus['ntfy'] = cfg.ntfy.state === 'ready'
    ? { state: 'ready', host: hostOf(cfg.ntfy.url), topicHint: `${cfg.ntfy.topic.slice(0, 4)}…` }
    : cfg.ntfy.state === 'misconfigured'
      ? { state: 'misconfigured', reason: cfg.ntfy.reason }
      : { state: 'off' };
  return {
    enabled: cfg.enabled,
    events: [...cfg.events],
    includePreview: cfg.includePreview,
    webpush: {
      subscriptions: records.map(record => ({
        id: record.id,
        label: record.label,
        host: hostOf(record.endpoint),
        createdAt: record.createdAt,
        lastSuccessAt: record.lastSuccessAt,
        failureCount: record.failureCount,
        thisDevice: callerDeviceId !== null && record.credentialId === callerDeviceId,
      })),
    },
    ntfy,
    native: { phones: nativePushPhones().length, directoryOnline: currentDirectoryClient()?.isOnline() ?? false },
    stats: state?.dispatcher.stats() ?? EMPTY_STATS,
  };
}
