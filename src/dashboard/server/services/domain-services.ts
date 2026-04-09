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

import { Effect, Layer, Queue, ServiceMap, Stream } from 'effect';
import { initEventStore } from '../event-store.js';
import type { StoredEvent } from '../event-store.js';
import { ReadModelService } from '../read-model.js';

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

export class EventStoreService extends ServiceMap.Service<
  EventStoreService,
  EventStoreServiceShape
>()('panopticon/dashboard/EventStoreService') {}

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
