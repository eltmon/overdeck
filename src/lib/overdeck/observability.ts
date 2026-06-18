import { Context, Effect, Layer, Schema, Stream } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { EventBus, type StoredOverdeckEvent } from './infra.js';
import { Issue } from './issues.js';
import { Agent } from './agents.js';

export const DomainEvent = Schema.Struct({
  sequence: Schema.Number,
  type: Schema.String,
  timestamp: Schema.Date,
  payload: Schema.Unknown,
});
export type DomainEvent = typeof DomainEvent.Type;

export const DashboardSnapshot = Schema.Struct({
  sequence: Schema.Number,
  generatedAt: Schema.Date,
  issues: Schema.optional(Schema.Array(Issue)),
  agents: Schema.optional(Schema.Array(Agent)),
});
export type DashboardSnapshot = typeof DashboardSnapshot.Type;

export const ReplayEventsInput = Schema.Struct({
  fromSequence: Schema.Number,
});
export type ReplayEventsInput = typeof ReplayEventsInput.Type;

export class ReplayGap extends Schema.TaggedErrorClass<ReplayGap>()(
  'ReplayGap',
  {
    requestedFromSequence: Schema.Number,
    oldestAvailableSequence: Schema.Number,
    message: Schema.String,
  },
) {}

export class SnapshotRequired extends Schema.TaggedErrorClass<SnapshotRequired>()(
  'SnapshotRequired',
  {
    requestedFromSequence: Schema.Number,
    snapshotSequence: Schema.Number,
    message: Schema.String,
  },
) {}

export const ReplayEventsError = Schema.Union([ReplayGap, SnapshotRequired]);
export type ReplayEventsError = typeof ReplayEventsError.Type;

export interface ObservabilityServiceShape {
  readonly getSnapshot: Effect.Effect<DashboardSnapshot>;
  readonly subscribeDomainEvents: Stream.Stream<DomainEvent>;
  readonly replayEvents: (fromSequence: number) => Effect.Effect<ReadonlyArray<DomainEvent>, ReplayEventsError>;
}

export class Observability extends Context.Service<Observability, ObservabilityServiceShape>()(
  'overdeck/Observability',
) {}

function toDomainEvent(event: StoredOverdeckEvent): DomainEvent {
  return {
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };
}

export interface ObservabilityLiveOptions {
  readonly oldestRetainedSequence?: number;
}

export function makeObservabilityLive(options: ObservabilityLiveOptions = {}): Layer.Layer<Observability, never, EventBus> {
  const oldestRetainedSequence = options.oldestRetainedSequence ?? 0;
  const minimumReplayFromSequence = Math.max(0, oldestRetainedSequence - 1);

  return Layer.effect(
    Observability,
    Effect.gen(function* () {
      const bus = yield* EventBus;

      return Observability.of({
        getSnapshot: bus.getLatestSequence.pipe(
          Effect.map((sequence) => ({
            sequence,
            generatedAt: new Date(),
          })),
        ),
        subscribeDomainEvents: bus.stream.pipe(Stream.map(toDomainEvent)),
        replayEvents: (fromSequence) =>
          fromSequence < minimumReplayFromSequence
            ? bus.getLatestSequence.pipe(
              Effect.flatMap((snapshotSequence) =>
                Effect.fail(new SnapshotRequired({
                  requestedFromSequence: fromSequence,
                  snapshotSequence,
                  message: 'Replay offset predates retained events; refresh the snapshot before replaying.',
                })),
              ),
            )
            : bus.readFrom(fromSequence).pipe(
              Effect.map((events) => events.map(toDomainEvent)),
            ),
      });
    }),
  );
}

export const ObservabilityLive = makeObservabilityLive();

export const GetSnapshotRpc = Rpc.make('pan.getSnapshot', {
  payload: Schema.Struct({}),
  success: DashboardSnapshot,
});

export const SubscribeDomainEventsRpc = Rpc.make('pan.subscribeDomainEvents', {
  payload: Schema.Struct({}),
  success: DomainEvent,
  stream: true,
});

export const ReplayEventsRpc = Rpc.make('pan.replayEvents', {
  payload: ReplayEventsInput,
  success: Schema.Array(DomainEvent),
  error: ReplayEventsError,
});

export const ObservabilityRpcGroup = RpcGroup.make(
  GetSnapshotRpc,
  SubscribeDomainEventsRpc,
  ReplayEventsRpc,
);
export type ObservabilityRpcGroup = typeof ObservabilityRpcGroup;

export const ObservabilityRpcLive = ObservabilityRpcGroup.toLayer(
  Effect.gen(function* () {
    const observability = yield* Observability;

    return ObservabilityRpcGroup.of({
      'pan.getSnapshot': () => observability.getSnapshot,
      'pan.subscribeDomainEvents': () => observability.subscribeDomainEvents,
      'pan.replayEvents': (input) => observability.replayEvents(input.fromSequence),
    });
  }),
);
