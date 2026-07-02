import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Context, Effect, Layer, Schema } from 'effect';
import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { CostArchive, CostArchiveLive, Db, DbLive, EventBus, EventBusLive } from './infra.js';
import { IssueId } from './issues.js';
import {
  getAllBudgetsSync,
  checkBudgetSync,
  createBudgetSync,
  deleteBudgetSync,
} from '../cost.js';
import type { CostBudget } from '../cost.js';
import { parseOhmypiSessionSync } from '../cost-parsers/ohmypi-parser.js';
import { parseCodexSessionSync } from '../cost-parsers/codex-parser.js';
import { getOverdeckHome } from '../paths.js';
import { deriveTieredAgentCostRole } from '../agents/tier-metrics.js';

// ── Filesystem helpers ────────────────────────────────────────────────────────

function walkJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkJsonl(full));
    else if (entry.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
}

// ── Local Drizzle table definition ───────────────────────────────────────────
// Mirrors the locked schema (docs/overdeck-remodel/overdeck-schema.ts:173-195).
// No FK or index definitions here — those live in the compiled schema only.

const costEventsTable = sqliteTable('cost_events', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  ts:          integer('ts', { mode: 'timestamp_ms' }).notNull(),
  issueId:     text('issue_id'),
  agentId:     text('agent_id'),
  sessionId:   text('session_id'),
  sessionType: text('session_type'),
  provider:    text('provider'),
  model:       text('model'),
  input:       integer('input'),
  output:      integer('output'),
  cacheRead:   integer('cache_read'),
  cacheWrite:  integer('cache_write'),
  cost:        real('cost'),
  requestId:   text('request_id'),
  sourceFile:  text('source_file'),
});

// ── Entities ─────────────────────────────────────────────────────────────────

export const Tokens = Schema.Struct({
  input:      Schema.Number,
  output:     Schema.Number,
  cacheRead:  Schema.Number,
  cacheWrite: Schema.Number,
});
export type Tokens = typeof Tokens.Type;

export const CostEvent = Schema.Struct({
  ts:          Schema.Date,
  issueId:     Schema.NullOr(IssueId),
  agentId:     Schema.NullOr(Schema.String),
  sessionId:   Schema.NullOr(Schema.String),
  sessionType: Schema.NullOr(Schema.String),
  provider:    Schema.NullOr(Schema.String),
  model:       Schema.NullOr(Schema.String),
  input:       Schema.Number,
  output:      Schema.Number,
  cacheRead:   Schema.Number,
  cacheWrite:  Schema.Number,
  cost:        Schema.Number,
  requestId:   Schema.NullOr(Schema.String),
  sourceFile:  Schema.NullOr(Schema.String),
});
export type CostEvent = typeof CostEvent.Type;

export const Rollup = Schema.Struct({
  key:    Schema.String,
  role:   Schema.optional(Schema.String),
  cost:   Schema.Number,
  tokens: Tokens,
});
export type Rollup = typeof Rollup.Type;

export const Window = Schema.Literals(['day', 'week', 'month']);
export type Window = typeof Window.Type;

export const WindowSummary = Schema.Struct({
  project:     Schema.NullOr(Schema.String),
  window:      Window,
  totalCost:   Schema.Number,
  totalTokens: Schema.Number,
  entryCount:  Schema.Number,
  byModel:     Schema.Record(Schema.String, Schema.Number),
});
export type WindowSummary = typeof WindowSummary.Type;

export const IssueCost = Schema.Struct({
  issueId:   IssueId,
  totalCost: Schema.Number,
  tokens:    Tokens,
  byModel:   Schema.Record(Schema.String, Rollup),
  byStage:   Schema.Record(Schema.String, Schema.Record(Schema.String, Tokens)),
});
export type IssueCost = typeof IssueCost.Type;

export const BudgetSpec = Schema.Struct({
  name:           Schema.String,
  type:           Schema.Literals(['daily', 'monthly', 'project', 'issue', 'feature']),
  limit:          Schema.Number,
  currency:       Schema.String,
  alertThreshold: Schema.Number,
});
export type BudgetSpec = typeof BudgetSpec.Type;

export const Budget = Schema.Struct({
  ...BudgetSpec.fields,
  id:      Schema.String,
  spent:   Schema.Number,
  enabled: Schema.Boolean,
});
export type Budget = typeof Budget.Type;

export const BudgetStatus = Schema.Struct({
  budget:      Budget,
  percentUsed: Schema.Number,
  remaining:   Schema.Number,
  alert:       Schema.Boolean,
  exceeded:    Schema.Boolean,
});
export type BudgetStatus = typeof BudgetStatus.Type;

// ── Errors ────────────────────────────────────────────────────────────────────

export class CostIngestError extends Schema.TaggedErrorClass<CostIngestError>()(
  'CostIngestError',
  { reason: Schema.String },
) {}

export class BudgetNotFound extends Schema.TaggedErrorClass<BudgetNotFound>()(
  'BudgetNotFound',
  { id: Schema.String },
) {}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapBudget(b: CostBudget): Budget {
  return {
    id:             b.id,
    name:           b.name,
    type:           b.type,
    limit:          b.limit,
    currency:       b.currency,
    alertThreshold: b.alertThreshold,
    spent:          b.spent,
    enabled:        b.enabled,
  };
}

type TokenRow = {
  input:      number | null;
  output:     number | null;
  cacheRead:  number | null;
  cacheWrite: number | null;
};

function toTokens(r: TokenRow): Tokens {
  return {
    input:      r.input      ?? 0,
    output:     r.output     ?? 0,
    cacheRead:  r.cacheRead  ?? 0,
    cacheWrite: r.cacheWrite ?? 0,
  };
}

function toRollup(key: string, r: TokenRow & { cost: number | null }, role?: string): Rollup {
  return { key, ...(role ? { role } : {}), cost: r.cost ?? 0, tokens: toTokens(r) };
}

// ── CostResolver — the read door ──────────────────────────────────────────────

export class CostResolver extends Context.Service<
  CostResolver,
  {
    // Windowed totals + per-model breakdown, optional project scope
    readonly summary: (window: Window, project?: string) => Effect.Effect<WindowSummary>;
    // All-issue rollup: GROUP BY issue_id
    readonly byIssue: () => Effect.Effect<ReadonlyArray<Rollup>>;
    // One issue's detail: total + per-model + per-stage
    readonly issueDetail: (id: IssueId) => Effect.Effect<IssueCost>;
    // Per-day trend over N days, optional issue filter
    readonly byDay: (days: number, issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>;
    // Per-model rollup, optional issue filter
    readonly byModel: (issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>;
    // Per-agent rollup, optional issue filter
    readonly byAgent: (issue?: IssueId) => Effect.Effect<ReadonlyArray<Rollup>>;
    // Per source_file, last N hours (background-AI costs)
    readonly byBackgroundSource: (hours: number) => Effect.Effect<ReadonlyArray<Rollup>>;
    // GROUP BY issue-id prefix (no project column — extracts from issue_id)
    readonly byProject: () => Effect.Effect<ReadonlyArray<Rollup>>;
    // Recent events, optional since filter
    readonly recent: (limit: number, since?: Date) => Effect.Effect<ReadonlyArray<CostEvent>>;
    // Budget reads (budgets.json — separate from cost_events)
    readonly listBudgets: () => Effect.Effect<ReadonlyArray<Budget>>;
    readonly checkBudget: (id: string) => Effect.Effect<BudgetStatus, BudgetNotFound>;
  }
>()('overdeck/CostResolver') {}

export const CostResolverLive = Layer.effect(
  CostResolver,
  Effect.gen(function* () {
    const { q } = yield* Db;

    const groupBySelect = {
      cost:      sql<number>`SUM(${costEventsTable.cost})`,
      input:     sql<number>`SUM(${costEventsTable.input})`,
      output:    sql<number>`SUM(${costEventsTable.output})`,
      cacheRead: sql<number>`SUM(${costEventsTable.cacheRead})`,
      cacheWrite: sql<number>`SUM(${costEventsTable.cacheWrite})`,
    } as const;

    const summary = (window: Window, project?: string) =>
      Effect.promise(async () => {
        const days = { day: 1, week: 7, month: 30 }[window];
        const cutoff = new Date(Date.now() - days * 86400_000);
        const where = project
          ? and(gte(costEventsTable.ts, cutoff), like(costEventsTable.issueId, `${project}-%`))
          : gte(costEventsTable.ts, cutoff);

        const [agg] = await q
          .select({
            totalCost:   sql<number>`COALESCE(SUM(${costEventsTable.cost}), 0)`,
            totalTokens: sql<number>`COALESCE(SUM(COALESCE(${costEventsTable.input},0) + COALESCE(${costEventsTable.output},0) + COALESCE(${costEventsTable.cacheRead},0) + COALESCE(${costEventsTable.cacheWrite},0)), 0)`,
            entryCount:  sql<number>`COUNT(*)`,
          })
          .from(costEventsTable)
          .where(where);

        const modelRows = await q
          .select({ model: costEventsTable.model, cost: sql<number>`COALESCE(SUM(${costEventsTable.cost}), 0)` })
          .from(costEventsTable)
          .where(where)
          .groupBy(costEventsTable.model);

        const byModel: Record<string, number> = {};
        for (const r of modelRows) byModel[r.model ?? 'unknown'] = r.cost ?? 0;

        return {
          project:     project ?? null,
          window,
          totalCost:   agg?.totalCost   ?? 0,
          totalTokens: agg?.totalTokens ?? 0,
          entryCount:  agg?.entryCount  ?? 0,
          byModel,
        };
      });

    const byIssue = () =>
      Effect.promise(async () => {
        const rows = await q
          .select({ key: costEventsTable.issueId, ...groupBySelect })
          .from(costEventsTable)
          .groupBy(costEventsTable.issueId);
        return rows.map((r) => toRollup(r.key ?? 'unattributed', r));
      });

    const issueDetail = (id: IssueId) =>
      Effect.promise(async () => {
        const modelRows = await q
          .select({ model: costEventsTable.model, ...groupBySelect })
          .from(costEventsTable)
          .where(eq(costEventsTable.issueId, id))
          .groupBy(costEventsTable.model);

        const byModel: Record<string, Rollup> = {};
        let totalCost = 0;
        let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
        for (const r of modelRows) {
          const key = r.model ?? 'unknown';
          const t = toTokens(r);
          byModel[key] = { key, cost: r.cost ?? 0, tokens: t };
          totalCost       += r.cost ?? 0;
          totalInput      += t.input;
          totalOutput     += t.output;
          totalCacheRead  += t.cacheRead;
          totalCacheWrite += t.cacheWrite;
        }
        const tokens: Tokens = { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite };

        const stageRows = await q
          .select({
            stage: costEventsTable.sessionType,
            model: costEventsTable.model,
            input:      sql<number>`SUM(${costEventsTable.input})`,
            output:     sql<number>`SUM(${costEventsTable.output})`,
            cacheRead:  sql<number>`SUM(${costEventsTable.cacheRead})`,
            cacheWrite: sql<number>`SUM(${costEventsTable.cacheWrite})`,
          })
          .from(costEventsTable)
          .where(eq(costEventsTable.issueId, id))
          .groupBy(costEventsTable.sessionType, costEventsTable.model);

        const byStage: Record<string, Record<string, Tokens>> = {};
        for (const r of stageRows) {
          const stage = r.stage ?? 'unknown';
          const model = r.model ?? 'unknown';
          if (!byStage[stage]) byStage[stage] = {};
          byStage[stage][model] = toTokens(r);
        }

        return { issueId: id, totalCost, tokens, byModel, byStage };
      });

    const byDay = (days: number, issue?: IssueId) =>
      Effect.promise(async () => {
        const cutoff = new Date(Date.now() - days * 86400_000);
        const dayExpr = sql<string>`DATE(${costEventsTable.ts}, 'unixepoch')`;
        const where = issue
          ? and(gte(costEventsTable.ts, cutoff), eq(costEventsTable.issueId, issue))
          : gte(costEventsTable.ts, cutoff);
        const rows = await q
          .select({ key: dayExpr, ...groupBySelect })
          .from(costEventsTable)
          .where(where)
          .groupBy(dayExpr)
          .orderBy(sql`DATE(${costEventsTable.ts}, 'unixepoch') DESC`);
        return rows.map((r) => toRollup(r.key ?? '', r));
      });

    const byModel = (issue?: IssueId) =>
      Effect.promise(async () => {
        const rows = await q
          .select({ key: costEventsTable.model, ...groupBySelect })
          .from(costEventsTable)
          .where(issue ? eq(costEventsTable.issueId, issue) : undefined)
          .groupBy(costEventsTable.model);
        return rows.map((r) => toRollup(r.key ?? 'unknown', r));
      });

    const byAgent = (issue?: IssueId) =>
      Effect.promise(async () => {
        const rows = await q
          .select({ key: costEventsTable.agentId, ...groupBySelect })
          .from(costEventsTable)
          .where(issue ? eq(costEventsTable.issueId, issue) : undefined)
          .groupBy(costEventsTable.agentId);
        return rows.map((r) => {
          const key = r.key ?? 'unattributed';
          return toRollup(key, r, deriveTieredAgentCostRole(key, issue));
        });
      });

    const byBackgroundSource = (hours: number) =>
      Effect.promise(async () => {
        const cutoff = new Date(Date.now() - hours * 3600_000);
        const rows = await q
          .select({ key: costEventsTable.sourceFile, ...groupBySelect })
          .from(costEventsTable)
          .where(and(gte(costEventsTable.ts, cutoff), sql`${costEventsTable.sourceFile} IS NOT NULL`))
          .groupBy(costEventsTable.sourceFile);
        return rows.map((r) => toRollup(r.key ?? 'unknown', r));
      });

    const byProject = () =>
      Effect.promise(async () => {
        const projExpr = sql<string>`UPPER(SUBSTR(${costEventsTable.issueId}, 1, INSTR(${costEventsTable.issueId}, '-') - 1))`;
        const rows = await q
          .select({ key: projExpr, ...groupBySelect })
          .from(costEventsTable)
          .where(sql`${costEventsTable.issueId} IS NOT NULL`)
          .groupBy(projExpr);
        return rows.map((r) => toRollup(r.key ?? 'unknown', r));
      });

    const recent = (limit: number, since?: Date) =>
      Effect.promise(async () => {
        const rows = await q
          .select()
          .from(costEventsTable)
          .where(since ? gte(costEventsTable.ts, since) : undefined)
          .orderBy(desc(costEventsTable.ts))
          .limit(limit);
        return rows.map((r) => ({
          ts:          r.ts,
          issueId:     r.issueId ?? null,
          agentId:     r.agentId ?? null,
          sessionId:   r.sessionId ?? null,
          sessionType: r.sessionType ?? null,
          provider:    r.provider ?? null,
          model:       r.model ?? null,
          input:       r.input       ?? 0,
          output:      r.output      ?? 0,
          cacheRead:   r.cacheRead   ?? 0,
          cacheWrite:  r.cacheWrite  ?? 0,
          cost:        r.cost        ?? 0,
          requestId:   r.requestId   ?? null,
          sourceFile:  r.sourceFile  ?? null,
        })) as ReadonlyArray<CostEvent>;
      });

    const listBudgets = () =>
      Effect.sync(() => getAllBudgetsSync().map(mapBudget));

    const checkBudget = (id: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.sync(() => checkBudgetSync(id));
        if (!result.budget) return yield* Effect.fail(new BudgetNotFound({ id }));
        return {
          budget:      mapBudget(result.budget),
          percentUsed: result.percentUsed,
          remaining:   result.remaining,
          alert:       result.alert,
          exceeded:    result.exceeded,
        };
      });

    return CostResolver.of({
      summary, byIssue, issueDetail, byDay, byModel, byAgent,
      byBackgroundSource, byProject, recent, listBudgets, checkBudget,
    });
  }),
);

// ── CostWriter — the write door ───────────────────────────────────────────────

export class CostWriter extends Context.Service<
  CostWriter,
  {
    // The ONLY ingest primitive — owns archive fan-out and dedup
    readonly record: (event: CostEvent) => Effect.Effect<boolean, CostIngestError>;
    // Catch-up sweep (PAN-1935: pi/codex sweep lands here)
    readonly reconcile: (opts?: {
      source?: 'claude' | 'ohmypi' | 'codex' | 'wal';
    }) => Effect.Effect<{ imported: number }, CostIngestError>;
    // Full rebuild from archive; recomputes cost from tokens
    readonly rebuild: () => Effect.Effect<{ events: number }, CostIngestError>;
    // Budget writes (budgets.json — separate from cost_events)
    readonly createBudget: (spec: BudgetSpec) => Effect.Effect<Budget, CostIngestError>;
    readonly deleteBudget: (id: string) => Effect.Effect<void, BudgetNotFound>;
  }
>()('overdeck/CostWriter') {}

export const CostWriterLive = Layer.effect(
  CostWriter,
  Effect.gen(function* () {
    const { q } = yield* Db;
    const archive = yield* CostArchive;
    const bus = yield* EventBus;

    // Dedup: prefer the precise requestId when present; fall back to sourceFile
    // only for events with no requestId (codex / background-AI dumps that carry
    // a file path but no request id). Using OR(requestId, sourceFile) is wrong —
    // it collapses every event that shares a sourceFile (e.g. all events
    // reconciled from one pi transcript) down to a single row, silently dropping
    // the rest (PAN-1935).
    const checkDuplicate = (e: CostEvent) =>
      Effect.gen(function* () {
        if (e.requestId == null && e.sourceFile == null) return false;
        const condition =
          e.requestId != null
            ? eq(costEventsTable.requestId, e.requestId)
            : eq(costEventsTable.sourceFile, e.sourceFile as string);
        const existing = yield* Effect.promise(() =>
          q
            .select({ id: costEventsTable.id })
            .from(costEventsTable)
            .where(condition)
            .limit(1),
        );
        return (existing as unknown[]).length > 0;
      });

    const record = (event: CostEvent) =>
      Effect.gen(function* () {
        if (yield* checkDuplicate(event)) return false;

        // 1. DURABLE ARCHIVE FIRST — events.jsonl + WAL. Archive decides no-op
        //    vs append by event source (transcript-backed events are no-ops).
        yield* archive.append(event);

        // 2. Cache insert — UNIQUE(request_id) makes it idempotent on re-import.
        yield* Effect.promise(() =>
          q
            .insert(costEventsTable)
            .values({
              ts:          event.ts,
              issueId:     event.issueId,
              agentId:     event.agentId,
              sessionId:   event.sessionId,
              sessionType: event.sessionType,
              provider:    event.provider,
              model:       event.model,
              input:       event.input,
              output:      event.output,
              cacheRead:   event.cacheRead,
              cacheWrite:  event.cacheWrite,
              cost:        event.cost,
              requestId:   event.requestId,
              sourceFile:  event.sourceFile,
            })
            .onConflictDoNothing(),
        );

        // 3. Announce — cost.subscribe + /api/costs/stream feed from this.
        yield* bus.emit({ type: 'cost.recorded', payload: { issueId: event.issueId, cost: event.cost } });
        return true;
      });

    // Catch-up sweep for pi/codex session files.
    // Walks OVERDECK_HOME/agents/<id>/sessions/**/*.jsonl (pi) or
    // OVERDECK_HOME/agents/<id>/codex-home/sessions/**/*.jsonl (codex),
    // parses each with the existing parsers, and feeds into record() (which deduplicates).
    const reconcile = (opts?: { source?: 'claude' | 'ohmypi' | 'codex' | 'wal' }) =>
      Effect.gen(function* () {
        const source = opts?.source ?? 'claude';
        if (source !== 'ohmypi' && source !== 'codex') return { imported: 0 };

        const agentsDir = join(getOverdeckHome(), 'agents');
        const agentNames = yield* Effect.sync(() => {
          if (!existsSync(agentsDir)) return [] as string[];
          return readdirSync(agentsDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
        });

        let imported = 0;

        for (const agentName of agentNames) {
          const sessionRoot =
            source === 'ohmypi'
              ? join(agentsDir, agentName, 'sessions')
              : join(agentsDir, agentName, 'codex-home', 'sessions');

          const sessionFiles = yield* Effect.sync(() => walkJsonl(sessionRoot));

          for (const sessionFile of sessionFiles) {
            const session = yield* Effect.sync(() =>
              source === 'ohmypi'
                ? parseOhmypiSessionSync(sessionFile)
                : parseCodexSessionSync(sessionFile),
            );
            if (!session) continue;

            const event: CostEvent = {
              ts:          new Date(session.startTime),
              issueId:     null,
              agentId:     agentName,
              sessionId:   session.sessionId,
              sessionType: source,
              provider:    null,
              model:       session.model ?? null,
              input:       session.usage.inputTokens,
              output:      session.usage.outputTokens,
              cacheRead:   session.usage.cacheReadTokens ?? 0,
              cacheWrite:  0,
              cost:        session.cost_v2 ?? session.cost,
              requestId:   null,
              sourceFile:  sessionFile,
            };

            const wasDuplicate = yield* checkDuplicate(event);
            if (!wasDuplicate) {
              if (yield* record(event)) imported++;
            }
          }
        }

        return { imported };
      });

    // Stub — full rebuild (recomputes cost from tokens) deferred to
    // workspace-3zhmy.
    const rebuild = () =>
      Effect.gen(function* () {
        return { events: 0 };
      });

    const createBudget = (spec: BudgetSpec) =>
      Effect.gen(function* () {
        const created = yield* Effect.sync(() =>
          createBudgetSync({ ...spec, enabled: true }),
        );
        return mapBudget(created);
      });

    const deleteBudget = (id: string) =>
      Effect.gen(function* () {
        const deleted = yield* Effect.sync(() => deleteBudgetSync(id));
        if (!deleted) return yield* Effect.fail(new BudgetNotFound({ id }));
      });

    return CostWriter.of({ record, reconcile, rebuild, createBudget, deleteBudget });
  }),
);

export const CostDoorLive = CostWriterLive.pipe(
  Layer.provide(Layer.mergeAll(DbLive, EventBusLive.pipe(Layer.provide(DbLive)), CostArchiveLive)),
);

// ── CostApi — the controller (HttpApiGroup, no handler wiring) ────────────────
// Handler wiring (CostApiLive) is deferred to workspace-m9n4j (server bootstrap).

export const CostApi = HttpApiGroup.make('costs')
  // ── reads ──
  .add(
    HttpApiEndpoint.get('summary', '/costs/summary', {
      query: {
        window:  Schema.optional(Window),
        project: Schema.optional(Schema.String),
      },
      success: WindowSummary,
    }),
  )
  .add(HttpApiEndpoint.get('byIssue', '/costs/by-issue', { success: Schema.Array(Rollup) }))
  .add(
    HttpApiEndpoint.get('issueDetail', '/costs/issue/:id', {
      params:  { id: IssueId },
      success: IssueCost,
    }),
  )
  .add(
    HttpApiEndpoint.get('byDay', '/costs/trends', {
      query: {
        days:    Schema.optional(Schema.NumberFromString),
        issueId: Schema.optional(IssueId),
      },
      success: Schema.Array(Rollup),
    }),
  )
  .add(
    HttpApiEndpoint.get('byModel', '/costs/by-model', {
      query:   { issueId: Schema.optional(IssueId) },
      success: Schema.Array(Rollup),
    }),
  )
  .add(
    HttpApiEndpoint.get('byAgent', '/costs/by-agent', {
      query:   { issueId: Schema.optional(IssueId) },
      success: Schema.Array(Rollup),
    }),
  )
  .add(
    HttpApiEndpoint.get('byBackgroundSource', '/costs/background', {
      query:   { hours: Schema.optional(Schema.NumberFromString) },
      success: Schema.Array(Rollup),
    }),
  )
  .add(HttpApiEndpoint.get('byProject', '/costs/by-project', { success: Schema.Array(Rollup) }))
  .add(
    HttpApiEndpoint.get('recent', '/costs/stream', {
      query: {
        limit: Schema.optional(Schema.NumberFromString),
        since: Schema.optional(Schema.String),
      },
      success: Schema.Array(CostEvent),
    }),
  )
  .add(HttpApiEndpoint.get('listBudgets', '/costs/budget', { success: Schema.Array(Budget) }))
  .add(
    HttpApiEndpoint.get('checkBudget', '/costs/budget/:id', {
      params:  { id: Schema.String },
      success: BudgetStatus,
      error:   BudgetNotFound,
    }),
  )
  // ── writes ──
  .add(
    HttpApiEndpoint.post('reconcile', '/costs/reconcile', {
      payload: Schema.Struct({
        source: Schema.optional(Schema.Literals(['claude', 'ohmypi', 'codex', 'wal'])),
      }),
      success: Schema.Struct({ imported: Schema.Number }),
      error:   CostIngestError,
    }),
  )
  .add(
    HttpApiEndpoint.post('rebuild', '/costs/rebuild', {
      success: Schema.Struct({ events: Schema.Number }),
      error:   CostIngestError,
    }),
  )
  .add(
    HttpApiEndpoint.post('createBudget', '/costs/budget', {
      payload: BudgetSpec,
      success: Budget,
      error:   CostIngestError,
    }),
  )
  // HttpApiEndpoint exports 'del' as 'delete' (reserved word alias)
  .add(
    HttpApiEndpoint['delete']('deleteBudget', '/costs/budget/:id', {
      params: { id: Schema.String },
      error:  BudgetNotFound,
    }),
  );
