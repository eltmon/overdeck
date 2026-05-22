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
  getCostsByIssueFromDb,
  getCostForIssueFromDb,
  getDailyTrends,
  getModelRollup,
  getAgentRollup,
  getCavemanExperimentData,
} from '../../../lib/database/cost-events-db.js';
import { syncWalFromAllProjects } from '../../../lib/costs/sync-wal.js';
import { httpHandler } from './http-handler.js';

// ─── Route: GET /api/costs/summary ───────────────────────────────────────────

const getCostsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/costs/summary',
  httpHandler(Effect.try({
    try: () => {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const todayEntries = readEventsSync({ startDate: today });
      const weekEntries = readEventsSync({ startDate: weekAgo });
      const monthEntries = readEventsSync({ startDate: monthAgo });

      const summarize = (entries: { cost?: number; input?: number; output?: number; model?: string }[]) => ({
        totalCost: entries.reduce((sum, e) => sum + (e.cost || 0), 0),
        totalTokens: entries.reduce((sum, e) => sum + ((e.input || 0) + (e.output || 0)), 0),
        entryCount: entries.length,
        byModel: entries.reduce<Record<string, number>>((acc, e) => {
          if (e.model) acc[e.model] = (acc[e.model] || 0) + (e.cost || 0);
          return acc;
        }, {}),
      });

      return jsonResponse({
        today: summarize(todayEntries),
        week: summarize(weekEntries),
        month: summarize(monthEntries),
      });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/costs/by-issue ──────────────────────────────────────────

const getCostsByIssueRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-issue',
  httpHandler(Effect.try({
    try: () => {
      const dbIssues = getCostsByIssueFromDb();

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
      try: () => jsonResponse({ trends: getDailyTrends({ days, issueId }), days, issueId: issueId ?? null }),
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
      try: () => jsonResponse({ models: getModelRollup(issueId), issueId: issueId ?? null }),
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
        const data = getCostForIssueFromDb(id);
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

    return yield* Effect.try({
      try: () => jsonResponse({ agents: getAgentRollup(issueId), issueId: issueId ?? null }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
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

const postCostsReconcileRoute = HttpRouter.add(
  'POST',
  '/api/costs/reconcile',
  httpHandler(Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => reconcile(),
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
    try: () => jsonResponse({ experiments: getCavemanExperimentData() }),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const costsRouteLayer = Layer.mergeAll(
  getCostsSummaryRoute,
  getCostsByIssueRoute,
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
