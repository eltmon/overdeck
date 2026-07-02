import { jsonResponse } from "../http-helpers.js";
/**
 * Costs route module — Effect HttpRouter.Layer (PAN-428 B10)
 *
 * Implements all /api/costs/* endpoints from the Express server:
 *   GET  /api/costs/summary
 *   GET  /api/costs/by-issue
 *   POST /api/costs/rebuild
 *   POST /api/costs/deduplicate
 *   GET  /api/costs/stream
 *   GET  /api/costs/trends
 *   GET  /api/costs/by-model
 *   GET  /api/costs/issue/:id
 *   GET  /api/costs/by-agent
 *   POST /api/costs/sync-wal
 *   POST /api/costs/reconcile
 */

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  readEventsSync,
  tailEventsSync,
  migrateAllSessionsSync,
  rebuildCacheSync,
  deduplicateEventsSync,
  reconcile,
} from '../../../lib/costs/index.js';
import {
  getCostsByIssueSync,
  getCostForIssueAggregateSync,
  getDailyTrendsSync,
  getModelRollupSync,
  getCavemanExperimentDataSync,
  getBackgroundCostBySourceSync,
} from '../../../lib/overdeck/cost-sync.js';
import { syncWalFromAllProjects } from '../../../lib/costs/sync-wal.js';
import { httpHandler } from './http-handler.js';
// PAN-1938: overdeck read door — CostResolver replaces direct DB calls for read endpoints.
// CostWriter is deferred until CostArchiveLive is wired (write endpoints stay on legacy path).
import { CostResolver } from '../../../lib/overdeck/cost.js';
import type { IssueId } from '../../../lib/overdeck/cost.js';

// ─── Route: GET /api/costs/summary ───────────────────────────────────────────

const getCostsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/costs/summary',
  httpHandler(Effect.gen(function* () {
    // PAN-1597: optional `?project=<PREFIX>` scopes the windows to one project's
    // issues (e.g. PAN-* ) so the project cockpit can show recent (today / 7d)
    // spend instead of an all-time lifetime total.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const projectPrefix = (Option.isSome(urlOpt) ? urlOpt.value.searchParams.get('project') : null)?.toUpperCase() ?? null;

    return yield* Effect.try({
      try: () => {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        type Entry = { issueId?: string; cost?: number; input?: number; output?: number; model?: string };
        const scope = (entries: Entry[]) =>
          projectPrefix
            ? entries.filter((e) => typeof e.issueId === 'string' && e.issueId.toUpperCase().startsWith(`${projectPrefix}-`))
            : entries;

        const todayEntries = scope(readEventsSync({ startDate: today }));
        const weekEntries = scope(readEventsSync({ startDate: weekAgo }));
        const monthEntries = scope(readEventsSync({ startDate: monthAgo }));

        const summarize = (entries: Entry[]) => ({
          totalCost: entries.reduce((sum, e) => sum + (e.cost || 0), 0),
          totalTokens: entries.reduce((sum, e) => sum + ((e.input || 0) + (e.output || 0)), 0),
          entryCount: entries.length,
          byModel: entries.reduce<Record<string, number>>((acc, e) => {
            if (e.model) acc[e.model] = (acc[e.model] || 0) + (e.cost || 0);
            return acc;
          }, {}),
        });

        return jsonResponse({
          project: projectPrefix,
          today: summarize(todayEntries),
          week: summarize(weekEntries),
          month: summarize(monthEntries),
        });
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
  })),
);

// ─── Route: GET /api/costs/by-issue ──────────────────────────────────────────

const getCostsByIssueRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-issue',
  httpHandler(Effect.try({
    try: () => {
      const dbIssues = getCostsByIssueSync();

      const issues = Object.entries(dbIssues).map(([issueId, data]) => {
        const d = data as {
          totalCost: number; inputTokens: number; outputTokens: number;
          cacheReadTokens: number; cacheWriteTokens: number; models: Record<string, { cost: number; tokens: number }>;
          stages?: Record<string, { cost: number; tokens: number }>; budgetWarning?: boolean; lastUpdated?: string;
        };
        return {
          issueId,
          totalCost: d.totalCost,
          tokenCount: d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheWriteTokens,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
          models: d.models,
          byModel: Object.fromEntries(
            Object.entries(d.models).map(([model, stats]) => [model, { cost: stats.cost, tokens: stats.tokens }])
          ),
          byStage: Object.fromEntries(
            Object.entries(d.stages || {}).map(([stage, stats]) => [stage, { cost: stats.cost, tokens: stats.tokens }])
          ),
          budgetWarning: d.budgetWarning,
          lastUpdated: d.lastUpdated,
        };
      });

      issues.sort((a, b) => b.totalCost - a.totalCost);

      return jsonResponse({ status: 'live', eventCount: issues.length, issues });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: POST /api/costs/rebuild ──────────────────────────────────────────

const postCostsRebuildRoute = HttpRouter.add(
  'POST',
  '/api/costs/rebuild',
  httpHandler(Effect.try({
    try: () => {
      console.log('Manual cost cache rebuild requested...');
      const migrationStats = migrateAllSessionsSync();
      const cache = rebuildCacheSync();
      return jsonResponse({
        success: true,
        message: 'Cost cache rebuilt successfully',
        migration: {
          eventsCreated: migrationStats.eventsCreated,
          totalCost: migrationStats.totalCost,
          errors: migrationStats.errors.length,
          warnings: migrationStats.warnings.length,
        },
        cache: {
          issueCount: Object.keys(cache.issues).length,
          eventCount: cache.lastEventLine,
          lastEventTs: cache.lastEventTs,
        },
      });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: POST /api/costs/deduplicate ──────────────────────────────────────

const postCostsDeduplicateRoute = HttpRouter.add(
  'POST',
  '/api/costs/deduplicate',
  httpHandler(Effect.try({
    try: () => {
      const removed = deduplicateEventsSync();
      return jsonResponse({
        success: true,
        message: `Deduplication complete: ${removed} duplicate event${removed !== 1 ? 's' : ''} removed`,
        removed,
      });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/costs/stream ────────────────────────────────────────────

const getCostsStreamRoute = HttpRouter.add(
  'GET',
  '/api/costs/stream',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const searchParams = urlOpt.value.searchParams;
    const since = searchParams.get('since');
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    return yield* Effect.try({
      try: () => {
        const events = since ? readEventsSync({ startDate: since, limit }) : tailEventsSync(limit);

        const byIssue: Record<string, unknown[]> = {};
        for (const event of events) {
          const e = event as { issueId: string; ts: string; model: string; provider: string; cost: number; input: number; output: number; cacheRead: number; cacheWrite: number };
          if (!byIssue[e.issueId]) byIssue[e.issueId] = [];
          byIssue[e.issueId]!.push({
            ts: e.ts, model: e.model, provider: e.provider, cost: e.cost,
            tokens: e.input + e.output + e.cacheRead + e.cacheWrite,
          });
        }

        return jsonResponse({ events: events.slice(0, 50), byIssue, count: events.length });
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
  })),
);

// ─── Route: GET /api/costs/trends ────────────────────────────────────────────

const getCostsTrendsRoute = HttpRouter.add(
  'GET',
  '/api/costs/trends',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const { searchParams } = urlOpt.value;
    const days = parseInt(searchParams.get('days') ?? '30', 10);
    const issueId = searchParams.get('issueId') ?? undefined;

    return yield* Effect.try({
      try: () => jsonResponse({ trends: getDailyTrendsSync({ days, issueId }), days, issueId: issueId ?? null }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
  })),
);

// ─── Route: GET /api/costs/by-model ──────────────────────────────────────────

const getCostsByModelRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-model',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const issueId = urlOpt.value.searchParams.get('issueId') ?? undefined;

    return yield* Effect.try({
      try: () => jsonResponse({ models: getModelRollupSync(issueId), issueId: issueId ?? null }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
  })),
);

// ─── Route: GET /api/costs/issue/:id ─────────────────────────────────────────

const getCostsIssueRoute = HttpRouter.add(
  'GET',
  '/api/costs/issue/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.try({
      try: () => {
        const data = getCostForIssueAggregateSync(id);
        if (!data) {
          return jsonResponse({ issueId: id.toUpperCase(), totalCost: 0, models: {}, stages: {} });
        }
        return jsonResponse(data);
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
  })),
);

// ─── Route: GET /api/costs/by-agent ──────────────────────────────────────────
// PAN-1938: served through CostResolver (overdeck read door).
// Response shape: Rollup[] = { key: agentId, role?, cost, tokens: { input, output, cacheRead, cacheWrite } }

const getCostsByAgentRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-agent',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const issueId = urlOpt.value.searchParams.get('issueId') ?? undefined;
    const resolver = yield* CostResolver;
    const agents = yield* resolver.byAgent(issueId as IssueId | undefined);
    return jsonResponse({ agents, issueId: issueId ?? null });
  })),
);

// ─── Route: POST /api/costs/sync-wal ─────────────────────────────────────────

const postCostsSyncWalRoute = HttpRouter.add(
  'POST',
  '/api/costs/sync-wal',
  httpHandler(Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => syncWalFromAllProjects(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse({ success: true, ...result });
  })),
);

// ─── Route: POST /api/costs/reconcile ────────────────────────────────────────
// TODO PAN-1938: migrate to CostWriter once CostArchiveLive is wired.

const postCostsReconcileRoute = HttpRouter.add(
  'POST',
  '/api/costs/reconcile',
  httpHandler(Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => Effect.runPromise(reconcile()),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    console.log(
      `[reconciler] Sweep complete: ${(result as { eventsImported?: number }).eventsImported ?? 0} imported`
    );
    return jsonResponse({ success: true, ...result });
  })),
);

// ─── Route: GET /api/costs/experiments ───────────────────────────────────────

const getCostsExperimentsRoute = HttpRouter.add(
  'GET',
  '/api/costs/experiments',
  httpHandler(Effect.try({
    try: () => jsonResponse({ experiments: getCavemanExperimentDataSync() }),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/costs/background ────────────────────────────────────────
// Last-24h spend per background-AI source (PAN-1589). `?hours=` overrides.

const getCostsBackgroundRoute = HttpRouter.add(
  'GET',
  '/api/costs/background',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');
      const hoursParam = Number(url.searchParams.get('hours'));
      const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 24;
      return jsonResponse({ hours, bySource: getBackgroundCostBySourceSync(hours) });
    }),
  ),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const costsRouteLayer = Layer.mergeAll(
  getCostsSummaryRoute,
  getCostsByIssueRoute,
  getCostsBackgroundRoute,
  postCostsRebuildRoute,
  postCostsDeduplicateRoute,
  getCostsStreamRoute,
  getCostsTrendsRoute,
  getCostsByModelRoute,
  getCostsIssueRoute,
  getCostsByAgentRoute,
  postCostsSyncWalRoute,
  postCostsReconcileRoute,
  getCostsExperimentsRoute,
);

export default costsRouteLayer;
