/**
 * Domain service wrappers — Effect services over existing lib modules (PAN-428 B5, PAN-433)
 *
 * EventStoreService: wraps the SQLite event store in Effect.
 * SnapshotService was removed in PAN-433 — replaced by ReadModelService (read-model.ts).
 *
 * The EventStoreServiceLive layer also wires event store → read model: every
 * appended event is pushed to ReadModelService.applyEvent() so the in-memory
 * projection stays current.
 */

import { Effect, Layer, Queue, Context, Stream } from 'effect';
import { initEventStore } from '../event-store.js';
import type { StoredEvent } from '../event-store.js';
import { ReadModelService } from '../read-model.js';
import { emitActivityDetailed } from '../../../lib/activity-logger.js';
import { randomUUID } from 'crypto';

// ─── EventStoreService ────────────────────────────────────────────────────────

export interface EventStoreServiceShape {
  /** Append a domain event; returns the assigned sequence number. */
  readonly append: (event: Record<string, unknown>) => Effect.Effect<number>;
  /** Return all stored events with sequence > fromSequence. */
  readonly readFrom: (fromSequence: number) => Effect.Effect<StoredEvent[]>;
  /** Return events of a given type, most recent first, capped at limit. */
  readonly queryByType: (type: string, limit?: number) => Effect.Effect<StoredEvent[]>;
  /** Return the latest sequence number (0 if empty). */
  readonly getLatestSequence: Effect.Effect<number>;
  /** Subscribe to live events as an Effect Stream. */
  readonly streamEvents: Stream.Stream<StoredEvent>;
}

export class EventStoreService extends Context.Service<
  EventStoreService,
  EventStoreServiceShape
>()('panopticon/dashboard/EventStoreService') {}

/** Map a domain event to a detailed activity log entry. Returns null for uninteresting events. */
function mapDomainEventToDetailed(event: StoredEvent): {
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  issueId?: string;
  triggeringEvent: string;
} | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const issueId = (p['issueId'] as string) ?? undefined;

  switch (event.type) {
    case 'agent.created':
      return { source: 'cloister', level: 'info', message: `Agent created for ${p['agentId']}`, issueId, triggeringEvent: event.type };
    case 'agent.started':
      return { source: 'cloister', level: 'info', message: `Agent started: ${p['agentId']}`, issueId, triggeringEvent: event.type };
    case 'agent.stopped':
      return { source: 'cloister', level: 'info', message: `Agent stopped: ${p['agentId']}`, issueId, triggeringEvent: event.type };
    case 'agent.status_changed': {
      const prev = p['previousStatus'] ? ` (was ${p['previousStatus']})` : '';
      return { source: 'cloister', level: 'info', message: `Agent ${p['agentId']} status → ${p['status']}${prev}`, issueId, triggeringEvent: event.type };
    }
    case 'agent.enrichment_changed': {
      const parts: string[] = [];
      if (p['agentPhase']) parts.push(`phase=${p['agentPhase']}`);
      if (p['resolution']) parts.push(`resolution=${p['resolution']}`);
      if (p['hasPendingQuestion']) parts.push(`questions=${p['pendingQuestionCount']}`);
      if (parts.length === 0) return null;
      return { source: 'cloister', level: 'info', message: `Agent ${p['agentId']} enrichment: ${parts.join(', ')}`, issueId, triggeringEvent: event.type };
    }
    case 'planning.started':
      return { source: 'planning', level: 'info', message: `Planning started: ${p['sessionName']}`, issueId, triggeringEvent: event.type };
    case 'planning.failed':
      return { source: 'planning', level: 'error', message: `Planning failed: ${p['error']}`, issueId, triggeringEvent: event.type };
    case 'planning.sync':
      return { source: 'planning', level: 'info', message: `Planning sync: ${p['status']}${p['progress'] !== undefined ? ` (${p['progress']}%)` : ''}`, issueId, triggeringEvent: event.type };
    case 'plan.item_status_changed':
      return { source: 'plan', level: 'info', message: `Plan item ${p['itemId']} → ${p['status']}`, issueId, triggeringEvent: event.type };
    case 'plan.subitem_status_changed':
      return { source: 'plan', level: 'info', message: `Plan sub-item ${p['subItemId']} → ${p['status']}`, issueId, triggeringEvent: event.type };
    case 'plan.items_unblocked': {
      const items = p['items'] as string[] | undefined;
      if (!items || items.length === 0) return null;
      return { source: 'plan', level: 'success', message: `${items.length} plan item(s) unblocked`, issueId, triggeringEvent: event.type };
    }
    case 'pipeline.status_changed':
      return { source: 'pipeline', level: 'info', message: `Pipeline status updated for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'review.status_changed':
      return { source: 'review', level: 'info', message: `Review status updated for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'pipeline.verification-started':
      return { source: 'verification', level: 'info', message: `Verification started for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'pipeline.verification-failed':
      return { source: 'verification', level: 'error', message: `Verification failed for ${issueId}${p['failedCheck'] ? `: ${p['failedCheck']}` : ''}`, issueId, triggeringEvent: event.type };
    case 'pipeline.review-started':
      return { source: 'review-specialist', level: 'info', message: `Review specialist started for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'pipeline.review-completed':
      return { source: 'review-specialist', level: p['passed'] ? 'success' : 'error', message: `Review ${p['passed'] ? 'passed' : 'failed'} for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'pipeline.test-started':
      return { source: 'test-specialist', level: 'info', message: `Test specialist started for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'pipeline.test-completed':
      return { source: 'test-specialist', level: p['passed'] ? 'success' : 'error', message: `Tests ${p['passed'] ? 'passed' : 'failed'} for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'specialist.started': {
      const spec = p['specialist'] as Record<string, unknown> | undefined;
      return { source: 'cloister', level: 'info', message: `Specialist ${spec?.['name'] ?? '?'} started${spec?.['currentIssue'] ? ` for ${spec['currentIssue']}` : ''}`, issueId, triggeringEvent: event.type };
    }
    case 'specialist.completed':
      return { source: 'cloister', level: 'success', message: `Specialist ${p['name']} completed`, issueId, triggeringEvent: event.type };
    case 'specialist.failed':
      return { source: 'cloister', level: 'error', message: `Specialist ${p['name']} failed: ${p['error']}`, issueId, triggeringEvent: event.type };
    case 'workspace.created':
      return { source: 'workspace', level: 'info', message: `Workspace created at ${p['workspacePath']}`, issueId, triggeringEvent: event.type };
    case 'workspace.wipe_started':
      return { source: 'workspace', level: 'warn', message: `Deep-wipe started for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'workspace.destroyed':
      return { source: 'workspace', level: 'info', message: `Workspace destroyed for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'workspace.deleted':
      return { source: 'workspace', level: 'info', message: `Workspace deleted for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'workspace.aborted':
      return { source: 'workspace', level: 'warn', message: `Workspace aborted for ${issueId}`, issueId, triggeringEvent: event.type };
    case 'issue.statusChanged':
      return { source: 'tracker', level: 'info', message: `Issue ${p['issueId']} status → ${p['canonicalStatus']}`, issueId: p['issueId'] as string, triggeringEvent: event.type };
    case 'dashboard.lifecycle_started':
      return { source: 'dashboard', level: 'info', message: `Dashboard lifecycle started: ${p['reason']}`, issueId, triggeringEvent: event.type };
    case 'dashboard.lifecycle_completed':
      return { source: 'dashboard', level: 'success', message: `Dashboard lifecycle completed: ${p['reason']}`, issueId, triggeringEvent: event.type };
    case 'dashboard.lifecycle_failed':
      return { source: 'dashboard', level: 'error', message: `Dashboard lifecycle failed: ${p['reason']} — ${p['error']}`, issueId, triggeringEvent: event.type };
    case 'merge.ready':
      return { source: 'merge-agent', level: 'success', message: `Issue ${issueId} ready for merge`, issueId, triggeringEvent: event.type };
    case 'system.health_severity_changed':
      return {
        source: 'system-health',
        level: p['severity'] === 'critical' ? 'error' : p['severity'] === 'warning' ? 'warn' : 'info',
        message: `System health ${p['previousSeverity']} → ${p['severity']}`,
        issueId,
        triggeringEvent: event.type,
      };
    case 'cost.event_recorded':
      return { source: 'costs', level: 'info', message: `Cost event: $${(p['cost'] as number)?.toFixed?.(2) ?? p['cost']} for ${p['agentId']}`, issueId, triggeringEvent: event.type };
    default:
      return null;
  }
}

export const EventStoreServiceLive = Layer.effect(
  EventStoreService,
  Effect.gen(function* () {
    const store = yield* Effect.promise(() => initEventStore());
    const readModel = yield* ReadModelService;

    // Wire event store → read model: every appended event updates the projection.
    // The EventEmitter subscription is sync, so applyEvent runs inline on append.
    store.subscribe((event) => {
      readModel.applyEvent({
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: event.payload,
      } as any);
    });

    // Auto-emit detailed activity entries for state-change domain events.
    // Skip activity.* events to avoid infinite loops.
    store.subscribe((event) => {
      if (event.type.startsWith('activity.')) return;
      const detailed = mapDomainEventToDetailed(event);
      if (detailed) emitActivityDetailed(detailed);
    });

    const streamEvents = Stream.callback<StoredEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          store.subscribe((event) => Queue.offerUnsafe(queue, event)),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    );

    return {
      append: (event) => Effect.sync(() => store.append(event as never)),
      readFrom: (fromSequence) => Effect.sync(() => store.readFrom(fromSequence)),
      queryByType: (type, limit) => Effect.sync(() => store.queryByType(type, limit)),
      getLatestSequence: Effect.sync(() => store.getLatestSequence()),
      streamEvents,
    };
  }),
);
