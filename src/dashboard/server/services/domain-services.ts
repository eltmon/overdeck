/**
 * Domain service wrappers — Effect services over existing lib modules (PAN-428 B5)
 *
 * These services wrap synchronous lib functions in Effect, making them available
 * via dependency injection in RPC handlers and route modules.
 */

import { Effect, Layer, Queue, ServiceMap, Stream } from 'effect';
import { initEventStore } from '../event-store.js';
import type { StoredEvent } from '../event-store.js';
import type { AgentSnapshot, DashboardSnapshot, ReviewStatusSnapshot, SpecialistSnapshot } from '@panopticon/contracts';

// ─── EventStoreService ────────────────────────────────────────────────────────

export interface EventStoreServiceShape {
  /** Append a domain event; returns the assigned sequence number. */
  readonly append: (event: Record<string, unknown>) => Effect.Effect<number>;
  /** Return all stored events with sequence > fromSequence. */
  readonly readFrom: (fromSequence: number) => Effect.Effect<StoredEvent[]>;
  /** Return the latest sequence number (0 if empty). */
  readonly getLatestSequence: Effect.Effect<number>;
  /** Subscribe to live events as an Effect Stream. */
  readonly streamEvents: Stream.Stream<StoredEvent>;
}

export class EventStoreService extends ServiceMap.Service<
  EventStoreService,
  EventStoreServiceShape
>()('panopticon/dashboard/EventStoreService') {}

export const EventStoreServiceLive = Layer.effect(
  EventStoreService,
  Effect.gen(function* () {
    // initEventStore() uses async dynamic imports for dual-runtime DB support
    const store = yield* Effect.promise(() => initEventStore());

    // Use Stream.callback with Queue.offerUnsafe — the EventEmitter callback is sync,
    // so we use offerUnsafe to push to the Effect queue without spawning fibers.
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
      getLatestSequence: Effect.sync(() => store.getLatestSequence()),
      streamEvents,
    };
  }),
);

// ─── SnapshotService ──────────────────────────────────────────────────────────

export interface SnapshotServiceShape {
  /** Build the current DashboardSnapshot from lib state. */
  readonly getSnapshot: Effect.Effect<DashboardSnapshot>;
}

export class SnapshotService extends ServiceMap.Service<
  SnapshotService,
  SnapshotServiceShape
>()('panopticon/dashboard/SnapshotService') {}

export const SnapshotServiceLive = Layer.effect(
  SnapshotService,
  Effect.gen(function* () {
    const eventStoreService = yield* EventStoreService;

    const getSnapshot: Effect.Effect<DashboardSnapshot> = Effect.gen(function* () {
      // Import existing lib modules lazily to avoid circular import issues
      const [{ listRunningAgents }, { getAllSpecialists, getSpecialistState }, { loadReviewStatuses }] =
        yield* Effect.all([
          Effect.promise(() => import('../../../lib/agents.js')),
          Effect.promise(() => import('../../../lib/cloister/specialists.js')),
          Effect.promise(() => import('../../../lib/review-status.js')),
        ]);

      const sequence = yield* eventStoreService.getLatestSequence;
      const timestamp = new Date().toISOString();

      // ── Agents ──────────────────────────────────────────────────────────────
      const running = listRunningAgents();
      const agents: AgentSnapshot[] = running.map((a) => ({
        id: a.id,
        issueId: a.issueId,
        workspace: a.workspace,
        runtime: a.runtime,
        model: a.model,
        status: a.status as AgentSnapshot['status'],
        startedAt: a.startedAt,
        lastActivity: a.lastActivity,
        branch: a.branch,
        costSoFar: a.costSoFar,
        sessionId: a.sessionId,
        phase: a.phase as AgentSnapshot['phase'],
      }));

      // ── Specialists ──────────────────────────────────────────────────────────
      const allSpecs = getAllSpecialists();
      const specialists: SpecialistSnapshot[] = allSpecs.map((s) => {
        const state = getSpecialistState(s.name);
        return {
          name: s.name as SpecialistSnapshot['name'],
          state: state as SpecialistSnapshot['state'],
          isRunning: (state as string) === 'active',
          lastWake: s.lastWake,
        };
      });

      // ── Review statuses ──────────────────────────────────────────────────────
      const statusMap = loadReviewStatuses();
      const reviewStatuses: ReviewStatusSnapshot[] = Object.values(statusMap).map((rs) => ({
        issueId: rs.issueId,
        reviewStatus: rs.reviewStatus as ReviewStatusSnapshot['reviewStatus'],
        testStatus: rs.testStatus as ReviewStatusSnapshot['testStatus'],
        mergeStatus: rs.mergeStatus as ReviewStatusSnapshot['mergeStatus'],
        readyForMerge: rs.reviewStatus === 'passed' && rs.testStatus === 'passed',
        updatedAt: new Date().toISOString(),
        prUrl: rs.prUrl,
      }));

      // ── Issues from IssueDataService cache (lazy import to avoid circular deps) ─
      const { getSharedIssueService, startSharedIssueService } =
        yield* Effect.promise(() => import('./issue-service-singleton.js'));
      startSharedIssueService(); // non-blocking start
      // JSON round-trip strips undefined values which Effect Schema/RPC can't serialize
      const rawIssues = getSharedIssueService().getIssues();
      const issues = JSON.parse(JSON.stringify(rawIssues));

      return { sequence, agents, specialists, reviewStatuses, issues, timestamp };
    });

    return { getSnapshot };
  }),
);
