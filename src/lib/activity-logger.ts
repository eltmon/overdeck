/**
 * Shared activity logger — emits activity.entry events to the SQLite event store.
 *
 * Replaces flat-file logActivity() in the ship-role merge path and provides a unified
 * activity logging API for all Overdeck components (roles, cloister, dashboard).
 *
 * Activity entries are persisted to the event store and flow through:
 *   event store → PubSub → WebSocket → EventRouter → Zustand store → ActivityPanel
 *
 * Usage:
 *   import { emitActivityEntry } from '../lib/activity-logger.js';
 *   emitActivityEntry({ source: 'ship', level: 'info', message: '...', issueId: 'PAN-123' });
 */

import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import type { DomainEvent } from '@overdeck/contracts';
import type { Role } from './agents.js';

export type ActivityLevel = 'info' | 'warn' | 'error' | 'success';
export type ActivityStatus = 'accepted' | 'running' | 'completed' | 'failed';
export type ActivitySource =
  | Role
  | 'cloister'
  | 'dashboard'
  | 'supervisor'
  | 'planning-agent'
  | 'work-agent'
  | 'review-specialist'
  | 'test-specialist'
  | 'merge-agent'
  | 'tts-summarizer'
  | 'deploy-script'
  | 'plan-finalize'
  | 'complete-planning'
  | 'start-agent';

export interface EmitActivityOptions {
  id?: string;
  source: ActivitySource;
  level: ActivityLevel;
  status?: ActivityStatus;
  command?: string;
  message: string;
  details?: string;
  output?: string;
  issueId?: string;
  /** Dashboard route the feed navigates to on click (e.g. /conv/<name>, /flywheel). */
  link?: string;
  /** PAN-1862 (FR-12): also fire a desktop notification for this entry. */
  desktop?: boolean;
}

export interface EmitDetailedOptions {
  source: string;
  level: ActivityLevel;
  message: string;
  details?: string;
  issueId?: string;
  triggeringEvent?: string;
}

export interface EmitTtsOptions {
  utterance: string;
  priority?: number; // 0=error (interrupt), 1=warn/success, 2=info
  issueId?: string;
  source?: ActivitySource;
  eventType?: string;
}

interface ActivityEventStore {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  appendAsync(event: Omit<DomainEvent, 'sequence'>): Promise<number>;
  /**
   * PAN-3092: at-most-once append, settled. Both production providers implement
   * it — the in-process SQLite store transactionally, the deacon-child client by
   * awaiting that same transaction over HTTP. Optional only so narrow test
   * doubles and early-boot stubs still satisfy the interface; when it is absent
   * `emitActivityEntryOnce` reports `unconfirmed` rather than claiming success.
   */
  appendOnce?(
    event: Omit<DomainEvent, 'sequence'>,
    idempotencyKey: string,
  ): { outcome: 'appended' | 'duplicate' } | Promise<'appended' | 'duplicate' | 'failed'>;
}

let activityEventStoreProvider: (() => ActivityEventStore) | null = null;

export function setActivityEventStoreProvider(provider: (() => ActivityEventStore) | null): void {
  activityEventStoreProvider = provider;
}

function getActivityEventStore(): ActivityEventStore | null {
  if (!activityEventStoreProvider) return null;
  try {
    return activityEventStoreProvider();
  } catch {
    return null;
  }
}

async function persistActivityEvent(event: Omit<DomainEvent, 'sequence'>): Promise<void> {
  const store = getActivityEventStore();
  if (!store) throw new Error('Activity event store is not initialized.');
  await store.appendAsync(event);
}

function appendActivityEventAsync(event: Omit<DomainEvent, 'sequence'>): void {
  void persistActivityEvent(event).catch(() => undefined);
}

function appendActivityEvent(event: Omit<DomainEvent, 'sequence'>): void {
  const store = getActivityEventStore();
  if (!store) return;
  try {
    store.append(event);
  } catch {
    // Non-fatal — event store may not be initialized during early boot
  }
}

/**
 * Emit an activity.entry domain event to the SQLite event store and wait until
 * it is durable. Reusing an id records a newer state transition for the same
 * logical activity.
 */
export async function emitActivityEntryDurable(options: EmitActivityOptions): Promise<void> {
  await persistActivityEvent(buildActivityEntryEvent(options));
}

function buildActivityEntryEvent(options: EmitActivityOptions): Omit<DomainEvent, 'sequence'> {
  return {
    type: 'activity.entry' as const,
    timestamp: new Date().toISOString(),
    payload: {
      id: options.id ?? randomUUID(),
      source: options.source,
      level: options.level,
      status: options.status,
      command: options.command,
      message: options.message,
      details: options.details,
      output: options.output,
      issueId: options.issueId,
      link: options.link,
      desktop: options.desktop,
    },
  } as Omit<DomainEvent, 'sequence'>;
}

/**
 * Outcome of an idempotent activity emit.
 *
 * `unconfirmed` is deliberately distinct from `appended`: it means the wired
 * store offers no settled at-most-once path, so the event was handed off
 * best-effort and may repeat or may never land. Callers that need a delivery
 * guarantee must not treat it as success.
 */
export type ActivityEmitOutcome = 'appended' | 'duplicate' | 'unconfirmed' | 'failed';

/**
 * PAN-3092: emit an activity entry AT MOST ONCE for a given id, and tell the
 * caller what actually happened to it.
 *
 * Reusing an id is not enough on its own: the reducer replaces the visible row,
 * but a second `activity.entry` event is still appended, re-published to every
 * connected client, and re-dated to the front of the feed — a repeat warning.
 * The claim and the append therefore happen inside one store transaction, so
 * concurrent callers cannot both observe absence and append.
 *
 * The outcome is reported only after that transaction settles. `appendAsync`
 * cannot be used for this: in the deacon child it resolves on local enqueue
 * before any HTTP request, and in the in-process store a failed batch resolves
 * with sequence 0 rather than rejecting — both would report success for an
 * event that never persisted.
 */
export async function emitActivityEntryOnce(
  options: EmitActivityOptions & { id: string },
): Promise<ActivityEmitOutcome> {
  const store = getActivityEventStore();
  if (!store) return 'failed';
  const event = buildActivityEntryEvent(options);
  if (!store.appendOnce) {
    // No settled path available (narrow test double / early-boot stub). Hand it
    // off best-effort, but never call that a guarantee.
    try {
      await persistActivityEvent(event);
      return 'unconfirmed';
    } catch {
      return 'failed';
    }
  }
  try {
    const result = await store.appendOnce(event, options.id);
    return typeof result === 'string' ? result : result.outcome;
  } catch {
    return 'failed';
  }
}

/**
 * Emit an activity.entry domain event without blocking the caller. Failures are
 * non-fatal because this path is also used during early dashboard boot.
 */
export function emitActivityEntrySync(options: EmitActivityOptions): void {
  void emitActivityEntryDurable(options).catch(() => undefined);
}

/**
 * Emit a detailed activity log entry — auto-generated from domain state changes.
 * Use for fine-grained visibility into agent lifecycle, plan changes, pipeline transitions.
 */
export function emitActivityDetailedSync(options: EmitDetailedOptions): void {
  appendActivityEventAsync({
    type: 'activity.detailed' as const,
    timestamp: new Date().toISOString(),
    payload: {
      id: randomUUID(),
      source: options.source,
      level: options.level,
      message: options.message,
      details: options.details,
      issueId: options.issueId,
      triggeringEvent: options.triggeringEvent,
    },
  });
}

function normalizeForSpeech(utterance: string): string {
  return utterance.replace(/\b([A-Z]{2,})-(\d+)/g, (_match, prefix, num) =>
    `${prefix.toLowerCase()} ${num}`
  );
}

/**
 * Emit a TTS activity log entry — upleveled utterance for text-to-speech.
 * Keep utterances short (<140 chars), human-friendly, and speakable.
 */
export function emitActivityTtsSync(options: EmitTtsOptions): void {
  appendActivityEventAsync({
    type: 'activity.tts' as const,
    timestamp: new Date().toISOString(),
    payload: {
      id: randomUUID(),
      utterance: normalizeForSpeech(options.utterance),
      priority: options.priority ?? 2,
      issueId: options.issueId,
      source: options.source,
      eventType: options.eventType,
    },
  });
}

/**
 * Emit a dashboard lifecycle event (started, completed, failed).
 * Used by pending-lifecycle.ts and the ship-role merge path.
 */
export function emitDashboardLifecycleSync(
  status: 'started' | 'completed' | 'failed',
  options: {
    reason: string;
    issueId?: string;
    trigger?: string;
    durationMs?: number;
    error?: string;
  },
): void {
  try {
    const timestamp = new Date().toISOString();
    let event: Omit<DomainEvent, 'sequence'>;
    let activity: EmitActivityOptions;
    const source: ActivitySource = options.trigger === 'deploy-script' ? 'deploy-script' : 'dashboard';
    const issue = options.issueId ? ` for ${options.issueId}` : '';

    if (status === 'started') {
      const trigger = options.trigger ?? 'unknown';
      event = {
        type: 'dashboard.lifecycle_started' as const,
        timestamp,
        payload: {
          reason: options.reason,
          issueId: options.issueId,
          trigger,
        },
      };
      activity = {
        source,
        level: 'info',
        message: `Dashboard restart started via ${trigger}${issue} (${options.reason})`,
        issueId: options.issueId,
      };
    } else if (status === 'completed') {
      const seconds = ((options.durationMs ?? 0) / 1000).toFixed(1);
      event = {
        type: 'dashboard.lifecycle_completed' as const,
        timestamp,
        payload: {
          reason: options.reason,
          issueId: options.issueId,
          durationMs: options.durationMs ?? 0,
        },
      };
      activity = {
        source,
        level: 'success',
        message: `Dashboard restart completed${issue} (${seconds}s, ${options.reason})`,
        issueId: options.issueId,
      };
    } else {
      event = {
        type: 'dashboard.lifecycle_failed' as const,
        timestamp,
        payload: {
          reason: options.reason,
          issueId: options.issueId,
          error: options.error ?? 'unknown error',
        },
      };
      activity = {
        source,
        level: 'error',
        message: `Dashboard restart failed${issue} (${options.reason})`,
        details: options.error ?? 'unknown error',
        issueId: options.issueId,
      };
    }

    appendActivityEvent(event);
    appendActivityEvent({
      type: 'activity.entry' as const,
      timestamp,
      payload: {
        id: randomUUID(),
        source: activity.source,
        level: activity.level,
        message: activity.message,
        details: activity.details,
        issueId: activity.issueId,
        link: activity.link,
      },
    });
  } catch {
    // Non-fatal
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native emit of an activity.entry domain event. Non-failing — the
 * underlying append is fire-and-forget and silently swallows any event-store
 * errors to match the Promise contract.
 */
export const emitActivityEntry = (
  options: EmitActivityOptions,
): Effect.Effect<void> => Effect.sync(() => emitActivityEntrySync(options));

/** Effect-native variant of emitActivityDetailed. */
export const emitActivityDetailed = (
  options: EmitDetailedOptions,
): Effect.Effect<void> => Effect.sync(() => emitActivityDetailedSync(options));

/** Effect-native variant of emitActivityTts. */
export const emitActivityTts = (
  options: EmitTtsOptions,
): Effect.Effect<void> => Effect.sync(() => emitActivityTtsSync(options));

/** Effect-native variant of emitDashboardLifecycle. */
export const emitDashboardLifecycle = (
  status: 'started' | 'completed' | 'failed',
  options: {
    reason: string;
    issueId?: string;
    trigger?: string;
    durationMs?: number;
    error?: string;
  },
): Effect.Effect<void> => Effect.sync(() => emitDashboardLifecycleSync(status, options));
