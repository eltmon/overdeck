import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Context, Effect, Layer, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { Db, Tmux, getOverdeckDatabaseSync } from './infra.js';
import { IssueId, type Stage } from './issues.js';
import { getOverdeckHome } from '../paths.js';
import { listAgentStatesSync, type AgentState } from '../agents/agent-state.js';
import { resolveLatestSessionIdSync } from '../agents/activity.js';

// ── Local table definitions (mirrors overdeck-schema.ts — no FK/index annotations here) ─

/**
 * PAN-3917: issue-stage-sync.ts (Appendix A.3 mirror sync) is deleted, but
 * both reads below only ever touched the still-live `issues` table (kept as
 * an FK anchor; its stage column is unwritten going forward but not yet
 * dropped) — inlined here rather than recreated at the deleted path.
 */
export function getIssueStageSync(issueId: string): string | null {
  const row = getOverdeckDatabaseSync()
    .prepare(`SELECT stage FROM issues WHERE id = ?`)
    .get(issueId) as { stage: string } | undefined;
  return row?.stage ?? null;
}

const TERMINAL_ISSUE_STAGES = new Set<Stage>(['verifying_on_main', 'closed', 'cancelled']);

export function isTerminalIssueStage(stage: string | null): boolean {
  return TERMINAL_ISSUE_STAGES.has(stage as Stage);
}

const overdeckHealthEvents = sqliteTable('health_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id'),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  state: text('state').notNull(),
  source: text('source'),
  metadata: text('metadata', { mode: 'json' }),
});

// ── Branded id + literal unions ────────────────────────────────────────────────

export const AgentId = Schema.String.pipe(Schema.brand('AgentId'));
export type AgentId = typeof AgentId.Type;

// Must match VALID_ROLES_SYNC (and the roles actually written to the agents
// table). PAN-1979: a too-narrow Role enum crashed the AgentsResolver list
// decode on real `strike`/`flywheel` rows, taking down dashboard boot.
export const Role = Schema.Literals(['work', 'review', 'plan', 'ship', 'test', 'flywheel', 'strike', 'sequencer', 'knowledge', 'worker']);
export type Role = typeof Role.Type;

// PAN-1979: a too-narrow Role enum crashed the AgentsResolver list decode
// on real `strike`/`flywheel` rows, taking down dashboard boot. Same class for
// Status: planning writes 'error' on spawn failure (spawn-planning-session.ts),
// and flywheel surfaces can persist 'waiting'; both must decode or a single
// lifecycle row bricks dashboard boot.
export const Status = Schema.Literals(['starting', 'running', 'waiting', 'idle', 'stopped', 'crashed', 'error']);
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

// ── Errors — tagged, in the E channel ─────────────────────────────────────────

export class AgentNotFound extends Schema.TaggedErrorClass<AgentNotFound>()(
  'AgentNotFound', { id: AgentId },
) {}

// ── Helper ────────────────────────────────────────────────────────────────────

const decodeAgent = Schema.decodeUnknownSync(Agent);
const decodeHealthEvent = Schema.decodeUnknownSync(HealthEvent);

// `consecutive_failures` is a nullable DB column — `.default(0)` only fires on an
// omitted-insert, not an explicit null, so rows written through other paths (e.g.
// planning-* state sync) legitimately carry null. A null failure count means "no
// failures recorded" = 0; normalize it here so the strict `Schema.Number` entity
// type stays valid and every consumer keeps a number (e.g. `consecutiveFailures + 1`
// in recordFailure). A null row otherwise crashed the dashboard boot decode (PAN-1972).
const decodeAgentRow = (row: unknown): Agent =>
  decodeAgent(
    row && typeof row === 'object' && (row as { consecutiveFailures?: unknown }).consecutiveFailures == null
      ? { ...(row as object), consecutiveFailures: 0 }
      : row,
  );

// A single undecodable row must never brick dashboard boot. The SHARED runtime
// `agents` table holds rows written by feature-branch agents running ahead of
// main (a role/status main doesn't know yet — e.g. PAN-2468's `knowledge`
// specialist, on feature/pan-2468 only, registered in overdeck.db). `list` is a
// boot-critical read, so it skips+logs rows it can't decode instead of throwing;
// PAN-1979 widened the Role enum reactively, but the enum always lags whatever a
// branch invents. `get(id)` stays strict to surface a genuine decode bug.
/** ISO timestamp → Date, or null when absent or unparsable. */
function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * PAN-3917: `~/.overdeck/agents/<id>/state.json` is the only copy of an agent's
 * state — the overdeck.db `agents` mirror is dropped on every boot. Project one
 * state file into the shape the `Agent` entity decodes, so the read door keeps
 * its contract while its source moves from a table to the files.
 */
function agentStateToEntityInput(state: AgentState): Record<string, unknown> {
  return {
    id: state.id,
    issueId: state.issueId,
    role: state.role,
    status: state.status,
    workspace: state.workspace ?? '',
    sessionId: resolveLatestSessionIdSync(state.id, { getAgentState: () => state }).sessionId,
    harness: state.harness ?? '',
    model: state.model ?? '',
    hostOverride: typeof state.hostOverride === 'string' ? state.hostOverride : null,
    deliveryMethod: state.deliveryMethod ?? null,
    startedAt: toDate(state.startedAt),
    lastResumeAt: toDate(state.lastResumeAt),
    stoppedByUser: state.stoppedByUser ?? null,
    kickoffDelivered: state.kickoffDelivered ?? null,
    paused: state.paused ?? null,
    pausedReason: state.pausedReason ?? null,
    troubled: state.troubled ?? null,
    channelsEnabled: state.channelsEnabled ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    firstFailureInRunAt: toDate(state.firstFailureInRunAt),
    lastFailureNextRetryAt: toDate(state.lastFailureNextRetryAt),
    updatedAt: toDate(state.lastActivity) ?? toDate(state.startedAt) ?? new Date(),
  };
}

const warnedUndecodableAgentRows = new Set<string>();
export const decodeAgentRowsLenient = (rows: readonly unknown[]): Agent[] => {
  const out: Agent[] = [];
  for (const row of rows) {
    try {
      out.push(decodeAgentRow(row));
    } catch (err) {
      const id =
        row && typeof row === 'object' && 'id' in row
          ? String((row as { id: unknown }).id)
          : '<unknown>';
      if (!warnedUndecodableAgentRows.has(id)) {
        warnedUndecodableAgentRows.add(id);
        console.warn(
          `[agents] skipping undecodable agent row ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return out;
};

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
        const state = yield* Effect.sync(() =>
          listAgentStatesSync().find((candidate) => candidate.id === id));
        if (!state) {
          return yield* Effect.fail(new AgentNotFound({ id }));
        }
        return decodeAgentRow(agentStateToEntityInput(state));
      });

    const list = (f: AgentFilter) =>
      Effect.gen(function* () {
        const states = yield* Effect.sync(() => listAgentStatesSync());
        const matching = states.filter((state) =>
          (f.issueId === undefined || state.issueId === f.issueId)
          && (f.role === undefined || state.role === f.role)
          && (f.status === undefined || state.status === f.status));
        return decodeAgentRowsLenient(matching.map(agentStateToEntityInput));
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

// ── Sync helpers (for CLI and reconstruct paths that cannot use Effect) ───────

/**
 * All agent ids matching a prefix, from the on-disk state dirs — the only copy
 * since the overdeck.db mirror was dropped. Used to enumerate an issue's review
 * fleet, e.g. listAgentIdsByPrefixSync('agent-pan-1866-review').
 */
export function listAgentIdsByPrefixSync(prefix: string): string[] {
  try {
    return readdirSync(join(getOverdeckHome(), 'agents')).filter((name) => name.startsWith(prefix));
  } catch {
    return [];
  }
}
