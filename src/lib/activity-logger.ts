/**
 * Shared activity logger — emits activity.entry events to the SQLite event store.
 *
 * Replaces flat-file logActivity() in merge-agent.ts and provides a unified
 * activity logging API for all Panopticon components (merge-agent, cloister,
 * specialists, dashboard).
 *
 * Activity entries are persisted to the event store and flow through:
 *   event store → PubSub → WebSocket → EventRouter → Zustand store → ActivityPanel
 *
 * Usage:
 *   import { emitActivityEntry } from '../lib/activity-logger.js';
 *   emitActivityEntry({ source: 'merge-agent', level: 'info', message: '...', issueId: 'PAN-123' });
 */

import { randomUUID } from 'crypto';
import { getEventStore } from '../dashboard/server/event-store.js';
import type { DomainEvent } from '@panopticon/contracts';

export type ActivityLevel = 'info' | 'warn' | 'error' | 'success';
export type ActivitySource = 'merge-agent' | 'cloister' | 'review-specialist' | 'test-specialist' | 'dashboard' | 'deploy-script';

export interface EmitActivityOptions {
  source: ActivitySource;
  level: ActivityLevel;
  message: string;
  details?: string;
  issueId?: string;
}

/**
 * Emit an activity.entry domain event to the SQLite event store.
 * Non-blocking — throws silently if event store is not yet initialized.
 *
 * The event is persisted to SQLite immediately and PubSub notifies all
 * WebSocket subscribers so the ActivityPanel updates in real-time.
 */
export function emitActivityEntry(options: EmitActivityOptions): void {
  try {
    const store = getEventStore();
    const entry = {
      type: 'activity.entry' as const,
      timestamp: new Date().toISOString(),
      payload: {
        id: randomUUID(),
        source: options.source,
        level: options.level,
        message: options.message,
        details: options.details ?? undefined,
        issueId: options.issueId ?? undefined,
      },
    };
    store.append(entry);
  } catch {
    // Non-fatal — event store may not be initialized during early boot
  }
}

/**
 * Emit a dashboard lifecycle event (started, completed, failed).
 * Used by pending-lifecycle.ts and merge-agent.ts.
 */
export function emitDashboardLifecycle(
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
    const store = getEventStore();
    let event: Omit<DomainEvent, 'sequence'>;

    if (status === 'started') {
      event = {
        type: 'dashboard.lifecycle_started' as const,
        timestamp: new Date().toISOString(),
        payload: {
          reason: options.reason,
          issueId: options.issueId ?? undefined,
          trigger: options.trigger ?? 'unknown',
        },
      };
    } else if (status === 'completed') {
      event = {
        type: 'dashboard.lifecycle_completed' as const,
        timestamp: new Date().toISOString(),
        payload: {
          reason: options.reason,
          issueId: options.issueId ?? undefined,
          durationMs: options.durationMs ?? 0,
        },
      };
    } else {
      event = {
        type: 'dashboard.lifecycle_failed' as const,
        timestamp: new Date().toISOString(),
        payload: {
          reason: options.reason,
          issueId: options.issueId ?? undefined,
          error: options.error ?? 'unknown error',
        },
      };
    }

    store.append(event);
  } catch {
    // Non-fatal
  }
}
