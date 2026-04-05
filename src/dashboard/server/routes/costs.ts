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
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  readEvents,
  tailEvents,
  migrateAllSessions,
  rebuildCache,
  deduplicateEvents,
  reconcile,
} from '../../../lib/costs/index.js';
import {
  getCostsByIssueFromDb,
  getCostForIssueFromDb,
  getDailyTrends,
  getModelRollup,
  getAgentRollup,
} from '../../../lib/database/cost-events-db.js';
import { syncWalFromAllProjects } from '../../../lib/costs/sync-wal.js';

// ─── Route: GET /api/costs/summary ───────────────────────────────────────────

const getCostsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/costs/summary',
  Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const todayEntries = readEvents({ startDate: today });
        const weekEntries = readEvents({ startDate: weekAgo });
        const monthEntries = readEvents({ startDate: monthAgo });

        const summarize = (entries: any[]) => ({
          totalCost: entries.reduce((sum: number, e: any) => sum + (e.cost || 0), 0),
          totalTokens: entries.reduce((sum: number, e: any) => sum + ((e.input || 0) + (e.output || 0)), 0),
          entryCount: entries.length,
          byModel: entries.reduce((acc: Record<string, number>, e: any) => {
            acc[e.model] = (acc[e.model] || 0) + (e.cost || 0);
            return acc;
          }, {} as Record<string, number>),
        });

        return jsonResponse({
          today: summarize(todayEntries),
          week: summarize(weekEntries),
          month: summarize(monthEntries),
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting cost summary:', error);
        return jsonResponse({ error: 'Failed to get cost summary: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/by-issue ──────────────────────────────────────────

const getCostsByIssueRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-issue',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
        try {
          const dbIssues = getCostsByIssueFromDb();

          const issues = Object.entries(dbIssues).map(([issueId, data]: [string, any]) => ({
            issueId,
            totalCost: data.totalCost,
            tokenCount: data.inputTokens + data.outputTokens + data.cacheReadTokens + data.cacheWriteTokens,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            cacheReadTokens: data.cacheReadTokens,
            cacheWriteTokens: data.cacheWriteTokens,
            models: data.models,
            byModel: Object.fromEntries(
              Object.entries(data.models).map(([model, stats]: [string, any]) => [
                model,
                { cost: stats.cost, tokens: stats.tokens },
              ])
            ),
            byStage: Object.fromEntries(
              Object.entries(data.stages || {}).map(([stage, stats]: [string, any]) => [
                stage,
                { cost: stats.cost, tokens: stats.tokens },
              ])
            ),
            budgetWarning: data.budgetWarning,
            lastUpdated: data.lastUpdated,
          }));

          issues.sort((a, b) => b.totalCost - a.totalCost);

          return jsonResponse({
            status: 'live',
            eventCount: issues.length,
            issues,
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error getting costs by issue:', error);
          return jsonResponse({ error: 'Failed to get costs by issue: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/costs/rebuild ──────────────────────────────────────────

const postCostsRebuildRoute = HttpRouter.add(
  'POST',
  '/api/costs/rebuild',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
        try {
          console.log('Manual cost cache rebuild requested...');

          const migrationStats = migrateAllSessions();
          const cache = rebuildCache();

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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error rebuilding cost cache:', error);
          return jsonResponse({ error: 'Failed to rebuild cost cache: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/costs/deduplicate ──────────────────────────────────────

const postCostsDeduplicateRoute = HttpRouter.add(
  'POST',
  '/api/costs/deduplicate',
  Effect.gen(function* () {
    return yield* Effect.try({
      try: () => {
        const removed = deduplicateEvents();
        return jsonResponse({
          success: true,
          message: `Deduplication complete: ${removed} duplicate event${removed !== 1 ? 's' : ''} removed`,
          removed,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error deduplicating cost events:', error);
        return jsonResponse({ error: 'Failed to deduplicate cost events: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/stream ────────────────────────────────────────────

const getCostsStreamRoute = HttpRouter.add(
  'GET',
  '/api/costs/stream',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const searchParams = urlOpt.value.searchParams;
    const since = searchParams.get('since');
    const limitParam = searchParams.get('limit') ?? '50';

    return yield* Effect.try({
      try: () => {
        const limit = parseInt(limitParam, 10);
        let events: any[];
        if (since) {
          events = readEvents({ startDate: since, limit });
        } else {
          events = tailEvents(limit);
        }

        const byIssue: Record<string, any[]> = {};
        for (const event of events) {
          if (!byIssue[event.issueId]) {
            byIssue[event.issueId] = [];
          }
          byIssue[event.issueId].push({
            ts: event.ts,
            model: event.model,
            provider: event.provider,
            cost: event.cost,
            tokens: event.input + event.output + event.cacheRead + event.cacheWrite,
          });
        }

        return jsonResponse({
          events: events.slice(0, 50),
          byIssue,
          count: events.length,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error streaming cost events:', error);
        return jsonResponse({ error: 'Failed to stream cost events: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/trends ────────────────────────────────────────────

const getCostsTrendsRoute = HttpRouter.add(
  'GET',
  '/api/costs/trends',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const searchParams = urlOpt.value.searchParams;
    const days = parseInt(searchParams.get('days') ?? '30', 10);
    const issueId = searchParams.get('issueId') ?? undefined;

    return yield* Effect.try({
      try: () => {
        const trends = getDailyTrends({ days, issueId });
        return jsonResponse({ trends, days, issueId: issueId ?? null });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting cost trends:', error);
        return jsonResponse({ error: 'Failed to get cost trends: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/by-model ──────────────────────────────────────────

const getCostsByModelRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-model',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const issueId = urlOpt.value.searchParams.get('issueId') ?? undefined;

    return yield* Effect.try({
      try: () => {
        const models = getModelRollup(issueId);
        return jsonResponse({ models, issueId: issueId ?? null });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting model costs:', error);
        return jsonResponse({ error: 'Failed to get model costs: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/issue/:id ─────────────────────────────────────────

const getCostsIssueRoute = HttpRouter.add(
  'GET',
  '/api/costs/issue/:id',
  Effect.gen(function* () {
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
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting issue cost detail:', error);
        return jsonResponse({ error: 'Failed to get issue cost detail: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/costs/by-agent ──────────────────────────────────────────

const getCostsByAgentRoute = HttpRouter.add(
  'GET',
  '/api/costs/by-agent',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const issueId = urlOpt.value.searchParams.get('issueId') ?? undefined;

    return yield* Effect.try({
      try: () => {
        const agents = getAgentRollup(issueId);
        return jsonResponse({ agents, issueId: issueId ?? null });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting agent costs:', error);
        return jsonResponse({ error: 'Failed to get agent costs: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/costs/sync-wal ─────────────────────────────────────────

const postCostsSyncWalRoute = HttpRouter.add(
  'POST',
  '/api/costs/sync-wal',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
        try {
          const result = await syncWalFromAllProjects();
          return jsonResponse({ success: true, ...result });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error syncing WAL:', error);
          return jsonResponse({ error: 'Failed to sync WAL: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/costs/reconcile ────────────────────────────────────────

const postCostsReconcileRoute = HttpRouter.add(
  'POST',
  '/api/costs/reconcile',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
        try {
          const result = await reconcile();
          console.log(
            `[reconciler] Sweep complete: ${result.eventsImported} imported, ${result.duplicatesSkipped} dupes, ${result.sessionsScanned} sessions scanned`
          );
          return jsonResponse({ success: true, ...result });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error running reconciler:', error);
          return jsonResponse({ error: 'Failed to run reconciler: ' + msg }, { status: 500 });
        }
      })
  }),
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
);

export default costsRouteLayer;
