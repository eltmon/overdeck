import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Context, Effect, Layer, Schema } from 'effect';
import { and, eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { Db, EventBus, Records, Tmux } from './infra.js';
import { IssueId } from './issues.js';
import { getOverdeckDatabaseSync } from './infra.js';
import { getPanopticonHome } from '../paths.js';
import type { AgentState } from '../agents.js';

// ── Local table definitions (mirrors overdeck-schema.ts — no FK/index annotations here) ─

const overdeckAgents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  workspace: text('workspace').notNull(),
  sessionId: text('session_id'),
  harness: text('harness').notNull(),
  model: text('model').notNull(),
  hostOverride: text('host_override'),
  deliveryMethod: text('delivery_method'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  lastResumeAt: integer('last_resume_at', { mode: 'timestamp' }),
  stoppedByUser: integer('stopped_by_user', { mode: 'boolean' }),
  kickoffDelivered: integer('kickoff_delivered', { mode: 'boolean' }),
  paused: integer('paused', { mode: 'boolean' }),
  pausedReason: text('paused_reason'),
  troubled: integer('troubled', { mode: 'boolean' }),
  channelsEnabled: integer('channels_enabled', { mode: 'boolean' }),
  consecutiveFailures: integer('consecutive_failures').default(0),
  firstFailureInRunAt: integer('first_failure_in_run_at', { mode: 'timestamp' }),
  lastFailureNextRetryAt: integer('last_failure_next_retry_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

const overdeckHealthEvents = sqliteTable('health_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  state: text('state').notNull(),
  source: text('source'),
  metadata: text('metadata', { mode: 'json' }),
});

// ── Branded id + literal unions ────────────────────────────────────────────────

export const AgentId = Schema.String.pipe(Schema.brand('AgentId'));
export type AgentId = typeof AgentId.Type;

export const Role = Schema.Literals(['work', 'review', 'plan', 'ship']);
export type Role = typeof Role.Type;

export const Status = Schema.Literals(['starting', 'running', 'idle', 'stopped', 'crashed']);
export type Status = typeof Status.Type;

export const DeliveryMethod = Schema.Literals(['auto', 'supervisor', 'channels', 'tmux']);
export type DeliveryMethod = typeof DeliveryMethod.Type;

// ── The Agent entity — 18-field NEED set (agents-state-audit) ─────────────────

export const Agent = Schema.Struct({
  id: AgentId,
  issueId: IssueId,
  role: Role,
  status: Status,
  workspace: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  harness: Schema.String,
  model: Schema.String,
  hostOverride: Schema.NullOr(Schema.String),
  deliveryMethod: Schema.NullOr(DeliveryMethod),
  startedAt: Schema.NullOr(Schema.Date),
  lastResumeAt: Schema.NullOr(Schema.Date),
  stoppedByUser: Schema.NullOr(Schema.Boolean),
  kickoffDelivered: Schema.NullOr(Schema.Boolean),
  paused: Schema.NullOr(Schema.Boolean),
  pausedReason: Schema.NullOr(Schema.String),
  troubled: Schema.NullOr(Schema.Boolean),
  channelsEnabled: Schema.NullOr(Schema.Boolean),
  consecutiveFailures: Schema.Number,
  firstFailureInRunAt: Schema.NullOr(Schema.Date),
  lastFailureNextRetryAt: Schema.NullOr(Schema.Date),
  updatedAt: Schema.Date,
});
export type Agent = typeof Agent.Type;

export const AgentFilter = Schema.Struct({
  issueId: Schema.optional(IssueId),
  role: Schema.optional(Role),
  status: Schema.optional(Status),
});
export type AgentFilter = typeof AgentFilter.Type;

export const HealthState = Schema.Literals([
  'starting', 'running', 'idle', 'waiting', 'stopped', 'crashed', 'dead',
]);

export const HealthEvent = Schema.Struct({
  agentId: Schema.NullOr(AgentId),
  timestamp: Schema.Date,
  state: HealthState,
  source: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.Unknown),
});
export type HealthEvent = typeof HealthEvent.Type;

export const SpawnOpts = Schema.Struct({
  issueId: IssueId,
  role: Role,
  harness: Schema.String,
  model: Schema.String,
  workspace: Schema.String,
  hostOverride: Schema.optional(Schema.NullOr(Schema.String)),
});
export type SpawnOpts = typeof SpawnOpts.Type;

export const ResumeOpts = Schema.Struct({
  force: Schema.optional(Schema.Boolean),
});
export type ResumeOpts = typeof ResumeOpts.Type;

// ── Errors — tagged, in the E channel ─────────────────────────────────────────

export class AgentNotFound extends Schema.TaggedErrorClass<AgentNotFound>()(
  'AgentNotFound', { id: AgentId },
) {}

export class AgentNotResumable extends Schema.TaggedErrorClass<AgentNotResumable>()(
  'AgentNotResumable', { id: AgentId, reason: Schema.String },
) {}

export class InvalidModel extends Schema.TaggedErrorClass<InvalidModel>()(
  'InvalidModel', { model: Schema.String },
) {}

// ── Helper ────────────────────────────────────────────────────────────────────

const decodeAgent = Schema.decodeUnknownSync(Agent);
const decodeHealthEvent = Schema.decodeUnknownSync(HealthEvent);

const validateModel = (model: string): Effect.Effect<string, InvalidModel> =>
  model.trim().length > 0
    ? Effect.succeed(model.trim())
    : Effect.fail(new InvalidModel({ model }));

// ── AgentsResolver — the read door ────────────────────────────────────────────

export class AgentsResolver extends Context.Service<AgentsResolver, {
  readonly get: (id: AgentId) => Effect.Effect<Agent, AgentNotFound>;
  readonly list: (f: AgentFilter) => Effect.Effect<ReadonlyArray<Agent>>;
  readonly isAlive: (id: AgentId) => Effect.Effect<boolean>;
  readonly getRuntime: (id: AgentId) => Effect.Effect<unknown, AgentNotFound>;
  readonly getHealthHistory: (id: AgentId) => Effect.Effect<ReadonlyArray<HealthEvent>>;
}>()('overdeck/AgentsResolver') {}

export const AgentsResolverLive = Layer.effect(
  AgentsResolver,
  Effect.gen(function* () {
    const db = yield* Db;
    const tmux = yield* Tmux;

    const get = (id: AgentId) =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db.q.select().from(overdeckAgents).where(eq(overdeckAgents.id, id)),
        );
        if (!row) {
          return yield* Effect.fail(new AgentNotFound({ id }));
        }
        return decodeAgent(row);
      });

    const list = (f: AgentFilter) =>
      Effect.gen(function* () {
        const conditions = [
          f.issueId !== undefined ? eq(overdeckAgents.issueId, f.issueId) : undefined,
          f.role !== undefined ? eq(overdeckAgents.role, f.role) : undefined,
          f.status !== undefined ? eq(overdeckAgents.status, f.status) : undefined,
        ].filter((c): c is NonNullable<typeof c> => c !== undefined);

        const rows = yield* Effect.promise(() =>
          conditions.length > 0
            ? db.q.select().from(overdeckAgents).where(and(...conditions))
            : db.q.select().from(overdeckAgents),
        );

        return rows.map((r) => decodeAgent(r));
      });

    const isAlive = (id: AgentId) => tmux.sessionExists(id);

    const getRuntime = (id: AgentId) =>
      Effect.gen(function* () {
        yield* get(id);
        return yield* tmux.readRuntimeJson(id);
      });

    const getHealthHistory = (id: AgentId) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db.q
            .select()
            .from(overdeckHealthEvents)
            .where(eq(overdeckHealthEvents.agentId, id))
            .orderBy(overdeckHealthEvents.timestamp),
        );
        return rows.map((r) => decodeHealthEvent(r));
      });

    return AgentsResolver.of({ get, list, isAlive, getRuntime, getHealthHistory });
  }),
);

// ── AgentWriter — the write door ──────────────────────────────────────────────

export interface AgentWriterServiceShape {
  readonly spawn:             (opts: SpawnOpts) => Effect.Effect<Agent, InvalidModel>;
  readonly switchModel:       (id: AgentId, model: string) => Effect.Effect<Agent, AgentNotFound | InvalidModel, AgentsResolver>;
  readonly stop:              (id: AgentId, opts?: { suspend?: boolean }) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly resume:            (id: AgentId, opts?: ResumeOpts) => Effect.Effect<Agent, AgentNotFound | AgentNotResumable, AgentsResolver>;
  readonly setStatus:         (id: AgentId, status: Status) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly setDeliveryMethod: (id: AgentId, method: DeliveryMethod) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly pause:             (id: AgentId, reason?: string) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly unpause:           (id: AgentId) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly markTroubled:       (id: AgentId) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly clearTroubled:      (id: AgentId) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly setChannelsEnabled: (id: AgentId, enabled: boolean) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly recordFailure:      (id: AgentId, reason: string) => Effect.Effect<Agent, AgentNotFound, AgentsResolver>;
  readonly recordHealth:      (id: AgentId, ev: HealthEvent) => Effect.Effect<void>;
}

export class AgentWriter extends Context.Service<AgentWriter, AgentWriterServiceShape>()('overdeck/AgentWriter') {}

export const AgentWriterLive = Layer.effect(
  AgentWriter,
  Effect.gen(function* () {
    const db = yield* Db;
    const records = yield* Records;
    const bus = yield* EventBus;
    const tmux = yield* Tmux;
    const now = () => new Date();

    // ── SOURCE-FIRST verbs — harness/model git record is authoritative ─────────

    const spawn: AgentWriterServiceShape['spawn'] = (opts) =>
      Effect.gen(function* () {
        const model = yield* validateModel(opts.model);
        yield* records.writeAgentIdentity(opts.issueId, { harness: opts.harness, model });
        // Process spawning is handled by the existing infra layer (pan start / process-services).
        // The writer owns the DB row and the records mirror; process lifecycle lives elsewhere.
        const agent: Agent = decodeAgent({
          id: `agent-${opts.issueId.toLowerCase()}` as AgentId,
          issueId: opts.issueId,
          role: opts.role,
          status: 'starting',
          workspace: opts.workspace,
          sessionId: null,
          harness: opts.harness,
          model,
          hostOverride: opts.hostOverride ?? null,
          deliveryMethod: null,
          startedAt: now(),
          lastResumeAt: null,
          stoppedByUser: null,
          kickoffDelivered: null,
          paused: null,
          pausedReason: null,
          troubled: null,
          channelsEnabled: null,
          consecutiveFailures: 0,
          firstFailureInRunAt: null,
          lastFailureNextRetryAt: null,
          updatedAt: now(),
        });
        yield* Effect.promise(() =>
          db.q.insert(overdeckAgents).values({
            id: agent.id,
            issueId: agent.issueId,
            role: agent.role,
            status: agent.status,
            workspace: agent.workspace,
            harness: agent.harness,
            model: agent.model,
            updatedAt: agent.updatedAt,
          }).run(),
        );
        yield* bus.emit({ type: 'agent.spawned', payload: { id: agent.id, issueId: opts.issueId } });
        return agent;
      });

    // AC2 — source-first: record → kill session → update DB → emit
    const switchModel: AgentWriterServiceShape['switchModel'] = (id, model) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const valid = yield* validateModel(model);
        // 1. SOURCE FIRST: rewrite model in the git record.
        yield* records.writeAgentIdentity(agent.issueId, { harness: agent.harness, model: valid });
        // 2. Stop + clear session.
        yield* tmux.killSession(String(id));
        const next: Agent = { ...agent, model: valid, sessionId: null, status: 'stopped', updatedAt: now() };
        // 3. Mirror the column.
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ model: valid, sessionId: null, status: 'stopped', updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.model_switched', payload: { id, model: valid } });
        return next;
      });

    // ── PURE-CACHE verbs — the cache write is the whole write ─────────────────

    const stop: AgentWriterServiceShape['stop'] = (id, opts) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const suspend = opts?.suspend ?? false;
        yield* tmux.killSession(String(id));
        const next: Agent = {
          ...agent,
          status: suspend ? 'stopped' : 'stopped',
          stoppedByUser: true,
          sessionId: null,
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ status: 'stopped', stoppedByUser: true, sessionId: null, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.stopped', payload: { id, suspend } });
        return next;
      });

    const resume: AgentWriterServiceShape['resume'] = (id, opts) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        if (agent.paused && !opts?.force) {
          return yield* Effect.fail(new AgentNotResumable({ id, reason: 'paused' }));
        }
        if (agent.troubled && !opts?.force) {
          return yield* Effect.fail(new AgentNotResumable({ id, reason: 'troubled' }));
        }
        const next: Agent = {
          ...agent,
          status: 'starting',
          stoppedByUser: false,
          lastResumeAt: now(),
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ status: 'starting', stoppedByUser: false, lastResumeAt: next.lastResumeAt, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.resumed', payload: { id } });
        return next;
      });

    const setStatus: AgentWriterServiceShape['setStatus'] = (id, status) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = { ...agent, status, updatedAt: now() };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ status, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.status_set', payload: { id, status } });
        return next;
      });

    const setDeliveryMethod: AgentWriterServiceShape['setDeliveryMethod'] = (id, method) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = { ...agent, deliveryMethod: method, updatedAt: now() };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ deliveryMethod: method, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.delivery_method_set', payload: { id, method } });
        return next;
      });

    const pause: AgentWriterServiceShape['pause'] = (id, reason) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const wasLive = yield* resolver.isAlive(id);
        if (wasLive) {
          yield* tmux.killSession(String(id));
        }
        const next: Agent = {
          ...agent,
          paused: true,
          pausedReason: reason ?? null,
          stoppedByUser: wasLive ? true : agent.stoppedByUser,
          status: wasLive ? 'stopped' : agent.status,
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({
              paused: true,
              pausedReason: reason ?? null,
              stoppedByUser: next.stoppedByUser,
              status: next.status,
              updatedAt: next.updatedAt,
            })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.paused', payload: { id, reason } });
        return next;
      });

    const unpause: AgentWriterServiceShape['unpause'] = (id) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = {
          ...agent,
          paused: false,
          pausedReason: null,
          stoppedByUser: false,
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ paused: false, pausedReason: null, stoppedByUser: false, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.unpaused', payload: { id } });
        return next;
      });

    const markTroubled: AgentWriterServiceShape['markTroubled'] = (id) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = { ...agent, troubled: true, updatedAt: now() };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ troubled: true, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.troubled', payload: { id } });
        return next;
      });

    const clearTroubled: AgentWriterServiceShape['clearTroubled'] = (id) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = {
          ...agent,
          troubled: false,
          consecutiveFailures: 0,
          firstFailureInRunAt: null,
          lastFailureNextRetryAt: null,
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({
              troubled: false,
              consecutiveFailures: 0,
              firstFailureInRunAt: null,
              lastFailureNextRetryAt: null,
              updatedAt: next.updatedAt,
            })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.untroubled', payload: { id } });
        return next;
      });

    const setChannelsEnabled: AgentWriterServiceShape['setChannelsEnabled'] = (id, enabled) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const next: Agent = { ...agent, channelsEnabled: enabled, updatedAt: now() };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({ channelsEnabled: enabled, updatedAt: next.updatedAt })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.channels_enabled_set', payload: { id, enabled } });
        return next;
      });

    const recordFailure: AgentWriterServiceShape['recordFailure'] = (id, reason) =>
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        const agent = yield* resolver.get(id);
        const newCount = agent.consecutiveFailures + 1;
        const threshold = 3;
        const backoffMs = Math.min(Math.pow(2, newCount - 1) * 1000, 60_000);
        const nextRetry = new Date(Date.now() + backoffMs);
        const next: Agent = {
          ...agent,
          consecutiveFailures: newCount,
          troubled: newCount >= threshold ? true : agent.troubled,
          firstFailureInRunAt: agent.firstFailureInRunAt ?? now(),
          lastFailureNextRetryAt: nextRetry,
          updatedAt: now(),
        };
        yield* Effect.promise(() =>
          db.q.update(overdeckAgents)
            .set({
              consecutiveFailures: next.consecutiveFailures,
              troubled: next.troubled,
              firstFailureInRunAt: next.firstFailureInRunAt,
              lastFailureNextRetryAt: next.lastFailureNextRetryAt,
              updatedAt: next.updatedAt,
            })
            .where(eq(overdeckAgents.id, id))
            .run(),
        );
        yield* bus.emit({ type: 'agent.failure_recorded', payload: { id, reason, count: newCount } });
        return next;
      });

    const recordHealth: AgentWriterServiceShape['recordHealth'] = (id, ev) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          db.q.insert(overdeckHealthEvents).values({
            agentId: id,
            timestamp: ev.timestamp,
            state: ev.state,
            source: ev.source ?? null,
            metadata: ev.metadata,
          }).run(),
        );
        yield* bus.emit({ type: 'agent.health_recorded', payload: { id, state: ev.state } });
      });

    return AgentWriter.of({
      spawn, switchModel, stop, resume, setStatus, setDeliveryMethod,
      pause, unpause, markTroubled, clearTroubled, setChannelsEnabled, recordFailure, recordHealth,
    });
  }),
);

// ── AgentsApi — the controller ─────────────────────────────────────────────────

export const AgentsApi = HttpApiGroup.make('agents')
  // reads
  .add(HttpApiEndpoint.get('list', '/agents', {
    query: AgentFilter,
    success: Schema.Array(Agent),
  }))
  .add(HttpApiEndpoint.get('get', '/agents/:id', {
    params: Schema.Struct({ id: AgentId }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.get('isAlive', '/agents/:id/alive', {
    params: Schema.Struct({ id: AgentId }),
    success: Schema.Boolean,
  }))
  .add(HttpApiEndpoint.get('runtime', '/agents/:id/runtime', {
    params: Schema.Struct({ id: AgentId }),
    success: Schema.Unknown,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.get('health', '/agents/:id/health-history', {
    params: Schema.Struct({ id: AgentId }),
    success: Schema.Array(HealthEvent),
  }))
  // writes
  .add(HttpApiEndpoint.post('spawn', '/agents', {
    payload: SpawnOpts,
    success: Agent,
    error: InvalidModel,
  }))
  .add(HttpApiEndpoint.post('stop', '/agents/:id/stop', {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ suspend: Schema.optional(Schema.Boolean) }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post('resume', '/agents/:id/resume', {
    params: Schema.Struct({ id: AgentId }),
    payload: ResumeOpts,
    success: Agent,
    error: Schema.Union([AgentNotFound, AgentNotResumable]),
  }))
  .add(HttpApiEndpoint.post('pause', '/agents/:id/pause', {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ reason: Schema.optional(Schema.String) }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post('unpause', '/agents/:id/unpause', {
    params: Schema.Struct({ id: AgentId }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post('untroubled', '/agents/:id/untroubled', {
    params: Schema.Struct({ id: AgentId }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post('switchModel', '/agents/:id/switch-model', {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ model: Schema.String }),
    success: Agent,
    error: Schema.Union([AgentNotFound, InvalidModel]),
  }))
  .add(HttpApiEndpoint.post('deliveryMethod', '/agents/:id/delivery-method', {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ deliveryMethod: DeliveryMethod }),
    success: Agent,
    error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post('heartbeat', '/agents/:id/heartbeat', {
    params: Schema.Struct({ id: AgentId }),
    payload: HealthEvent,
    success: Schema.Void,
  }));

// ── Layer wiring ───────────────────────────────────────────────────────────────

export const AgentsDomainLayer = Layer.mergeAll(
  AgentsResolverLive,
  AgentWriterLive,
);

// ── Sync helpers (for CLI and reconstruct paths that cannot use Effect) ────────

/**
 * All columns in the overdeck agents table (matches 0000_overdeck_init.sql).
 * Timestamps are stored as INTEGER (Unix ms); booleans as INTEGER 0/1.
 */
const OVERDECK_AGENT_COLUMNS = [
  'id', 'issue_id', 'role', 'status', 'workspace',
  'session_id', 'harness', 'model', 'host_override', 'delivery_method',
  'started_at', 'last_resume_at', 'stopped_by_user', 'kickoff_delivered',
  'paused', 'paused_reason', 'troubled', 'channels_enabled',
  'consecutive_failures', 'first_failure_in_run_at', 'last_failure_next_retry_at',
  'stopped_at', 'paused_at', 'troubled_at', 'last_activity', 'last_failure_reason',
  'phase', 'role_run_head', 'flywheel_run_id', 'cost_so_far',
  'review_sub_role', 'review_run_id', 'review_synthesis_agent_id',
  'review_output_path', 'review_deadline_at', 'review_monitor_signaled',
  'review_retry_attempt', 'updated_at',
] as const;

/** Convert an ISO timestamp string or null → Unix ms INTEGER or null. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Convert boolean → 0/1 integer, or null if input is null/undefined. */
function toBit(v: boolean | null | undefined): number | null {
  if (v == null) return null;
  return v ? 1 : 0;
}

/**
 * Map an AgentState to a parameter array for the overdeck agents INSERT.
 * Column order matches OVERDECK_AGENT_COLUMNS.
 */
function agentStateToOverdeckRow(state: AgentState): unknown[] {
  return [
    state.id,
    state.issueId,
    state.role,
    state.status,
    state.workspace ?? '',
    state.sessionId ?? null,
    state.harness ?? null,
    state.model ?? null,
    typeof state.hostOverride === 'string' ? state.hostOverride : null,
    state.deliveryMethod ?? null,
    toMs(state.startedAt),
    toMs(state.lastResumeAt),
    toBit(state.stoppedByUser),
    toBit(state.kickoffDelivered),
    toBit(state.paused),
    state.pausedReason ?? null,
    toBit(state.troubled),
    toBit(state.channelsEnabled),
    state.consecutiveFailures ?? 0,
    toMs(state.firstFailureInRunAt),
    toMs(state.lastFailureNextRetryAt),
    toMs(state.stoppedAt),
    toMs(state.pausedAt),
    toMs(state.troubledAt),
    toMs(state.lastActivity),
    state.lastFailureReason ?? null,
    state.phase ?? null,
    state.roleRunHead ?? null,
    state.flywheelRunId ?? null,
    state.costSoFar ?? null,
    state.reviewSubRole ?? null,
    state.reviewRunId ?? null,
    state.reviewSynthesisAgentId ?? null,
    state.reviewOutputPath ?? null,
    toMs(state.reviewDeadlineAt),
    state.reviewMonitorSignaled ?? null,
    state.reviewRetryAttempt ?? null,
    Date.now(),
  ];
}

function getManagedTmuxSocketName(): string {
  return process.env.PANOPTICON_TMUX_SOCKET_NAME ?? 'panopticon';
}

function listLiveTmuxSessionNamesSync(): Set<string> {
  try {
    const output = execFileSync(
      'tmux',
      ['-L', getManagedTmuxSocketName(), 'list-sessions', '-F', '#{session_name}'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return new Set(
      output.split('\n').map((l) => l.trim()).filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

const VALID_ROLES_SYNC = new Set<string>(['plan', 'work', 'review', 'test', 'ship', 'flywheel', 'strike']);

function parseAgentStateJsonSync(content: string, fallbackId: string): AgentState | null {
  let parsed: Partial<AgentState>;
  try {
    parsed = JSON.parse(content) as Partial<AgentState>;
  } catch {
    return null;
  }
  if (!parsed.role || !VALID_ROLES_SYNC.has(parsed.role)) return null;
  if (!parsed.id) parsed.id = fallbackId;
  if (!parsed.status) parsed.status = 'stopped';
  return parsed as AgentState;
}

export interface BackfillAgentsSyncOptions {
  verbose?: boolean;
  listLiveSessions?: () => Set<string>;
}

export interface BackfillAgentsSyncResult {
  processed: number;
  skipped: number;
  markedStopped: number;
}

/**
 * Read each agent's state.json from ~/.panopticon/agents/ and upsert rows into
 * the overdeck agents table. Reconciles running/starting agents against live
 * tmux sessions.
 *
 * Replaces database/agent-backfill.ts backfillAgentsAutoSync for the overdeck layer.
 */
export function backfillAgentsSync(options?: BackfillAgentsSyncOptions): BackfillAgentsSyncResult {
  const db = getOverdeckDatabaseSync();
  const agentsDir = join(getPanopticonHome(), 'agents');
  const liveSessions = options?.listLiveSessions?.() ?? listLiveTmuxSessionNamesSync();

  let processed = 0;
  let skipped = 0;
  let markedStopped = 0;

  let entries: string[] = [];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return { processed, skipped, markedStopped };
  }

  const cols = OVERDECK_AGENT_COLUMNS.join(', ');
  const placeholders = OVERDECK_AGENT_COLUMNS.map(() => '?').join(', ');
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO agents (${cols}) VALUES (${placeholders})`,
  );

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const dirPath = join(agentsDir, entry);
      let statePath: string;
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        statePath = join(dirPath, 'state.json');
      } catch {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(statePath, 'utf-8');
      } catch {
        skipped++;
        continue;
      }

      const state = parseAgentStateJsonSync(content, entry);
      if (!state) {
        skipped++;
        continue;
      }

      // Reconcile: mark stopped if no live tmux session
      if ((state.status === 'running' || state.status === 'starting') && !liveSessions.has(state.id)) {
        state.status = 'stopped';
        state.stoppedAt = state.stoppedAt ?? new Date().toISOString();
        markedStopped++;
      }

      upsert.run(...agentStateToOverdeckRow(state));
      processed++;

      if (options?.verbose) {
        console.log(`[backfill] ${state.id} -> ${state.status}`);
      }
    }
  });

  tx();
  return { processed, skipped, markedStopped };
}

/**
 * Count agents by status, grouped by role.
 * Drop-in for countAgentsByStatus() from database/agents-db.ts.
 */
export function countAgentsByStatus(status: string): Record<string, number> {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    `SELECT role, COUNT(*) AS n FROM agents WHERE status = ? GROUP BY role`,
  ).all(status) as Array<{ role: string; n: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.role] = row.n;
  }
  return result;
}

/**
 * Count agents matching both status and role.
 * Drop-in for countAgentsByStatusRole() from database/agents-db.ts.
 */
export function countAgentsByStatusRole(status: string, role: string): number {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM agents WHERE status = ? AND role = ?`,
  ).get(status, role) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * List all agents from the overdeck agents table as AgentState-compatible objects.
 * Used as a fallback in reconstruct-cache when listRunningAgents() fails.
 */
export function listAllAgentsSync(): Array<{
  id: string;
  issueId: string;
  role: string;
  status: string;
  workspace: string | null;
  harness: string | null;
  model: string | null;
  branch: null;
  sessionId: string | null;
  startedAt: string | null;
  lastActivity: string | null;
  lastResumeAt: string | null;
  stoppedAt: string | null;
  stoppedByUser: boolean | null;
  stoppedByPause: null;
  kickoffDelivered: boolean | null;
  hostOverride: null;
  costSoFar: number | null;
  phase: string | null;
  workType: null;
  paused: boolean | null;
  pausedReason: string | null;
  pausedAt: string | null;
  troubled: boolean | null;
  troubledAt: string | null;
  consecutiveFailures: number | null;
  firstFailureInRunAt: string | null;
  lastFailureAt: null;
  lastFailureReason: string | null;
  lastFailureNextRetryAt: string | null;
  flywheelRunId: string | null;
  roleRunHead: string | null;
  reviewSubRole: string | null;
  reviewRunId: string | null;
  reviewSynthesisAgentId: null;
  reviewOutputPath: null;
  reviewDeadlineAt: null;
  reviewMonitorSignaled: null;
  reviewRetryAttempt: null;
  inspectSubRole: null;
  deliveryMethod: string | null;
  supervisorEnabled: null;
  channelsEnabled: boolean | null;
  updatedAt: string;
}> {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(`
    SELECT id, issue_id, role, status, workspace, session_id, harness, model,
           host_override, delivery_method, started_at, last_resume_at,
           stopped_by_user, kickoff_delivered, paused, paused_reason, troubled,
           channels_enabled, consecutive_failures, first_failure_in_run_at,
           last_failure_next_retry_at, stopped_at, paused_at, troubled_at,
           last_activity, last_failure_reason, phase, role_run_head,
           flywheel_run_id, cost_so_far, review_sub_role, review_run_id,
           updated_at
    FROM agents
  `).all() as Array<Record<string, unknown>>;

  /** Convert INTEGER ms timestamp → ISO string or null. */
  const fromMs = (v: unknown): string | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  };
  const fromBit = (v: unknown): boolean | null => v == null ? null : v !== 0;

  return rows.map((row) => ({
    id: row['id'] as string,
    issueId: row['issue_id'] as string,
    role: row['role'] as string,
    status: row['status'] as string,
    workspace: (row['workspace'] as string | null) ?? null,
    harness: (row['harness'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    branch: null,
    sessionId: (row['session_id'] as string | null) ?? null,
    startedAt: fromMs(row['started_at']),
    lastActivity: fromMs(row['last_activity']),
    lastResumeAt: fromMs(row['last_resume_at']),
    stoppedAt: fromMs(row['stopped_at']),
    stoppedByUser: fromBit(row['stopped_by_user']),
    stoppedByPause: null,
    kickoffDelivered: fromBit(row['kickoff_delivered']),
    hostOverride: null,
    costSoFar: (row['cost_so_far'] as number | null) ?? null,
    phase: (row['phase'] as string | null) ?? null,
    workType: null,
    paused: fromBit(row['paused']),
    pausedReason: (row['paused_reason'] as string | null) ?? null,
    pausedAt: fromMs(row['paused_at']),
    troubled: fromBit(row['troubled']),
    troubledAt: fromMs(row['troubled_at']),
    consecutiveFailures: (row['consecutive_failures'] as number | null) ?? null,
    firstFailureInRunAt: fromMs(row['first_failure_in_run_at']),
    lastFailureAt: null,
    lastFailureReason: (row['last_failure_reason'] as string | null) ?? null,
    lastFailureNextRetryAt: fromMs(row['last_failure_next_retry_at']),
    flywheelRunId: (row['flywheel_run_id'] as string | null) ?? null,
    roleRunHead: (row['role_run_head'] as string | null) ?? null,
    reviewSubRole: (row['review_sub_role'] as string | null) ?? null,
    reviewRunId: (row['review_run_id'] as string | null) ?? null,
    reviewSynthesisAgentId: null,
    reviewOutputPath: null,
    reviewDeadlineAt: null,
    reviewMonitorSignaled: null,
    reviewRetryAttempt: null,
    inspectSubRole: null,
    deliveryMethod: (row['delivery_method'] as string | null) ?? null,
    supervisorEnabled: null,
    channelsEnabled: fromBit(row['channels_enabled']),
    updatedAt: fromMs(row['updated_at']) ?? new Date().toISOString(),
  }));
}
