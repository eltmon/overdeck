import { Effect, Layer, Stream } from 'effect';
import * as SubscriptionRef from 'effect/SubscriptionRef';
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi';

import { EventBus, type StoredOverdeckEvent } from './infra.js';
import {
  IssuesApi,
  IssuesResolver,
  IssueWriter,
  IssuesResolverLive,
  IssueWriterLive,
} from './issues.js';
import {
  AgentsApi,
  AgentsResolver,
  AgentWriter,
  AgentsDomainLayer,
} from './agents.js';
import {
  MergeApi,
  MergeResolver,
  MergeWriter,
  MergeResolverLive,
  MergeWriterLive,
} from './merge.js';
import {
  SettingsApi,
  ConfigApi,
  SettingsResolver,
  SettingsWriter,
  ConfigResolver,
  SettingsResolverLive,
  SettingsWriterLive,
  ConfigResolverLive,
} from './control-settings.js';
import {
  Observability,
  ObservabilityRpcLive,
  DomainEvent,
  DashboardSnapshot,
  type ObservabilityServiceShape,
} from './observability.js';

// ── Unified HttpApi (all domain groups) ──────────────────────────────────────

export const FullOverdeckApi = HttpApi.make('overdeck')
  .add(IssuesApi)
  .add(AgentsApi)
  .add(MergeApi)
  .add(SettingsApi)
  .add(ConfigApi);

// ── Issues controller ────────────────────────────────────────────────────────

export const IssuesApiLive = HttpApiBuilder.group(FullOverdeckApi, 'issues', (h) =>
  h
    .handle('list',        ({ query })           => IssuesResolver.use((r) => r.list(query)))
    .handle('get',         ({ params })          => IssuesResolver.use((r) => r.get(params.id)))
    .handle('getPlan',     ({ params })          => IssuesResolver.use((r) => r.getPlan(params.id)))
    .handle('advance',     ({ params, payload }) =>
      IssueWriter.use((w) => w.advance(params.id, payload.to, payload.reason, payload.hint)))
    .handle('setBlockers', ({ params, payload }) =>
      IssueWriter.use((w) => w.setBlockers(params.id, payload.blockers, payload.reason)))
    .handle('setPr',       ({ params, payload }) =>
      IssueWriter.use((w) =>
        w.setPr(params.id, { url: payload.url, number: payload.number, headSha: payload.headSha }))),
);

// ── Agents controller ────────────────────────────────────────────────────────

export const AgentsApiLive = HttpApiBuilder.group(FullOverdeckApi, 'agents', (h) =>
  h
    .handle('list',           ({ query })           => AgentsResolver.use((r) => r.list(query)))
    .handle('get',            ({ params })          => AgentsResolver.use((r) => r.get(params.id)))
    .handle('isAlive',        ({ params })          => AgentsResolver.use((r) => r.isAlive(params.id)))
    .handle('runtime',        ({ params })          => AgentsResolver.use((r) => r.getRuntime(params.id)))
    .handle('health',         ({ params })          => AgentsResolver.use((r) => r.getHealthHistory(params.id)))
    .handle('spawn',          ({ payload })         => AgentWriter.use((w) => w.spawn(payload)))
    .handle('stop',           ({ params, payload }) =>
      AgentWriter.use((w) => w.stop(params.id, { suspend: payload.suspend })))
    .handle('resume',         ({ params, payload }) =>
      AgentWriter.use((w) => w.resume(params.id, payload)))
    .handle('pause',          ({ params, payload }) =>
      AgentWriter.use((w) => w.pause(params.id, payload.reason)))
    .handle('unpause',        ({ params })          => AgentWriter.use((w) => w.unpause(params.id)))
    .handle('untroubled',     ({ params })          => AgentWriter.use((w) => w.clearTroubled(params.id)))
    .handle('switchModel',    ({ params, payload }) =>
      AgentWriter.use((w) => w.switchModel(params.id, payload.model)))
    .handle('deliveryMethod', ({ params, payload }) =>
      AgentWriter.use((w) => w.setDeliveryMethod(params.id, payload.deliveryMethod)))
    .handle('heartbeat',      ({ params, payload }) =>
      AgentWriter.use((w) => w.recordHealth(params.id, payload))),
);

// ── Merge controller ─────────────────────────────────────────────────────────

export const MergeApiLive = HttpApiBuilder.group(FullOverdeckApi, 'merge', (h) =>
  h
    .handle('getMergeSet',        ({ params })          => MergeResolver.use((r) => r.getMergeSet(params.id)))
    .handle('listQueues',         ()                    => MergeResolver.use((r) => r.listQueues()))
    .handle('listAutoMerges',     ({ query })           => MergeResolver.use((r) => r.listAutoMerges(query)))
    .handle('listBlockers',       ()                    => MergeResolver.use((r) => r.listBlockers()))
    .handle('listUatGenerations', ({ query })           => MergeResolver.use((r) => r.listUatGenerations(query)))
    .handle('merge',              ({ params })          => MergeWriter.use((w) => w.merge(params.id)))
    .handle('approveForge',       ({ params })          => MergeWriter.use((w) => w.approveForge(params.id)))
    .handle('rebaseOntoMain',     ({ params })          => MergeWriter.use((w) => w.rebaseOntoMain(params.id)))
    .handle('mergeNext',          ({ payload })         => MergeWriter.use((w) => w.mergeNext(payload.projectKey)))
    .handle('scheduleAutoMerge',  ({ payload })         => MergeWriter.use((w) => w.scheduleAutoMerge(payload)))
    .handle('cancelAutoMerge',    ({ params, payload }) =>
      MergeWriter.use((w) => w.cancelAutoMerge(params.id, payload.cancelledBy)))
    .handle('assembleUat',        ()                    => MergeWriter.use((w) => w.assembleUat({ force: true })))
    .handle('startUatStack',      ({ params })          => MergeWriter.use((w) => w.startUatStack(params.name)))
    .handle('promoteUat',         ({ params })          => MergeWriter.use((w) => w.promoteUat(params.name))),
);

// ── Settings / Config controllers ────────────────────────────────────────────

export const SettingsApiLive = HttpApiBuilder.group(FullOverdeckApi, 'settings', (h) =>
  h
    .handle('getDeaconPause',     () =>
      SettingsResolver.use((r) => r.isDeaconPaused().pipe(Effect.map((paused) => ({ paused })))))
    .handle('getFlywheelConfig',  () => SettingsResolver.use((r) => r.getFlywheelConfig()))
    .handle('getFlywheelRuntime', () => SettingsResolver.use((r) => r.getFlywheelRuntime()))
    .handle('getPolicy',          ({ params }) => SettingsResolver.use((r) => r.getPolicy(params.id)))
    .handle('setDeaconPause',     ({ payload }) =>
      SettingsWriter.use((w) => w.setDeaconPaused(payload.paused).pipe(Effect.as({ paused: payload.paused }))))
    .handle('setFlywheelConfig',  ({ payload }) => SettingsWriter.use((w) => w.setFlywheelConfig(payload)))
    .handle('setDeaconIgnored',   ({ params, payload }) =>
      SettingsWriter.use((w) => w.setDeaconIgnored(params.id, payload.ignored, payload.reason)))
    .handle('setAutoMerge',       ({ params, payload }) =>
      SettingsWriter.use((w) => w.setAutoMerge(params.id, payload.autoMerge))),
);

export const ConfigApiLive = HttpApiBuilder.group(FullOverdeckApi, 'config', (h) =>
  h
    .handle('getProject',   ({ params }) => ConfigResolver.use((r) => r.getProject(params.key)))
    .handle('listProjects', ()           => ConfigResolver.use((r) => r.listProjects())),
);

// ── EventBus-driven read-model (no store polling) ────────────────────────────

function toDomainEvent(event: StoredOverdeckEvent): DomainEvent {
  return {
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };
}

/**
 * EventBus-driven Observability — seeds a SubscriptionRef<DashboardSnapshot>
 * from resolvers on boot, then refreshes it on each EventBus event without
 * polling the DB. `getSnapshot` reads from the in-memory ref: no DB call.
 */
export const BootstrapObservabilityLive = Layer.effect(
  Observability,
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const issuesResolver = yield* IssuesResolver;
    const agentsResolver = yield* AgentsResolver;

    // Seed the initial snapshot by calling resolvers once (one-time DB read).
    const initialSeq = yield* bus.getLatestSequence;
    const initialIssues = yield* issuesResolver.list({});
    const initialAgents = yield* agentsResolver.list({});
    const ref = yield* SubscriptionRef.make<DashboardSnapshot>({
      sequence: initialSeq,
      generatedAt: new Date(),
      issues: [...initialIssues],
      agents: [...initialAgents],
    });

    // EventBus-driven refresh: on each domain event, pull fresh resolver data.
    yield* bus.stream.pipe(
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          const issues = yield* issuesResolver.list({});
          const agents = yield* agentsResolver.list({});
          yield* SubscriptionRef.set(ref, {
            sequence: event.sequence,
            generatedAt: new Date(),
            issues: [...issues],
            agents: [...agents],
          });
        }),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );

    const service: ObservabilityServiceShape = {
      getSnapshot: SubscriptionRef.get(ref),
      subscribeDomainEvents: bus.stream.pipe(Stream.map(toDomainEvent)),
      replayEvents: (fromSequence) =>
        bus.readFrom(fromSequence).pipe(
          Effect.map((events) => events.map(toDomainEvent)),
        ),
    };
    return Observability.of(service);
  }),
);

// ── OverdeckDomainLayer — fully wired server bootstrap ────────────────────────
//
// Layer composition:
//   DomainResolversAndWriters — pure domain layers (no cross-domain deps)
//   WiredObservabilityLive    — BootstrapObservabilityLive + domain resolvers
//   WiredRpcLive              — ObservabilityRpcLive + wired observability
//
// Each inner composition uses Layer.provide so Effect's reference-based
// memoization builds each sub-layer exactly once across all consumers.

const DomainResolversAndWriters = Layer.mergeAll(
  IssuesResolverLive,
  IssueWriterLive,
  AgentsDomainLayer,
  MergeResolverLive,
  MergeWriterLive,
  SettingsResolverLive,
  SettingsWriterLive,
  ConfigResolverLive,
);

const WiredObservabilityLive = BootstrapObservabilityLive.pipe(
  Layer.provide(DomainResolversAndWriters),
);

const WiredRpcLive = ObservabilityRpcLive.pipe(
  Layer.provide(WiredObservabilityLive),
);

export const OverdeckDomainLayer = Layer.mergeAll(
  DomainResolversAndWriters,
  WiredObservabilityLive,
  WiredRpcLive,
);
