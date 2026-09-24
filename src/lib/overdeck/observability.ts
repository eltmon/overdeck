import { Context, Effect, Schema, Stream } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

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

export interface ObservabilityLiveOptions {
  readonly oldestRetainedSequence?: number;
}

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
