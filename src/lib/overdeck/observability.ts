import { Context, Effect, Layer, Schema, Stream } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { EventBus, type StoredOverdeckEvent } from './infra.js';

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
});
export type DashboardSnapshot = typeof DashboardSnapshot.Type;

export const ReplayEventsInput = Schema.Struct({
  fromSequence: Schema.Number,
});
export type ReplayEventsInput = typeof ReplayEventsInput.Type;

export interface ObservabilityServiceShape {
  readonly getSnapshot: Effect.Effect<DashboardSnapshot>;
  readonly subscribeDomainEvents: Stream.Stream<DomainEvent>;
  readonly replayEvents: (fromSequence: number) => Effect.Effect<ReadonlyArray<DomainEvent>>;
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

export const ObservabilityLive = Layer.effect(
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
      replayEvents: (fromSequence) => bus.readFrom(fromSequence).pipe(
        Effect.map((events) => events.map(toDomainEvent)),
      ),
    });
  }),
);

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
