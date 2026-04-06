import { jsonResponse } from "../http-helpers.js";
/**
 * Metrics + Convoys route module — Effect HttpRouter.Layer (PAN-428 B16)
 *
 * Implements all /api/metrics/*, /api/convoys/*, and /api/activity/* endpoints
 * from the Express server (11 routes total):
 *
 *   GET  /api/metrics/summary
 *   GET  /api/metrics/costs
 *   GET  /api/metrics/handoffs
 *   GET  /api/metrics/stuck
 *   GET  /api/activity
 *   GET  /api/activity/:id
 *   GET  /api/convoys
 *   GET  /api/convoys/:id
 *   POST /api/convoys/start
 *   POST /api/convoys/:id/stop
 *   GET  /api/convoys/:id/output
 */

import { readFile } from 'node:fs/promises';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { readEvents } from '../../../lib/costs/index.js';
import { startConvoy, stopConvoy, getConvoyStatus, listConvoys, type ConvoyContext } from '../../../lib/convoy.js';
import { httpHandler } from './http-handler.js';

// ─── Activity store ───────────────────────────────────────────────────────────
// Mirror of the in-memory activity store from index.ts. The Effect HTTP server
// runs in the same process as the Express server during migration, so this
// module maintains its own independent store for routes it owns.

interface ActivityEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
}

const activities: ActivityEntry[] = [];

// ─── Route: GET /api/metrics/summary ─────────────────────────────────────────

const getMetricsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/metrics/summary',
  httpHandler(Effect.try({
    try: () => {
      const service = getCloisterService();
      const status = service.getStatus();

      const todayStr = new Date().toISOString().split('T')[0];
      const todayEvents = readEvents({ startDate: todayStr });
      const dailyTotal = todayEvents.reduce((sum, e) => sum + (e.cost || 0), 0);

      const agentCosts = new Map<string, number>();
      const issueCosts = new Map<string, number>();
      for (const e of todayEvents) {
        agentCosts.set(e.agentId, (agentCosts.get(e.agentId) || 0) + e.cost);
        issueCosts.set(e.issueId, (issueCosts.get(e.issueId) || 0) + e.cost);
      }

      const topAgents = Array.from(agentCosts.entries())
        .map(([agentId, cost]) => ({ agentId, cost }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);
      const topIssues = Array.from(issueCosts.entries())
        .map(([issueId, cost]) => ({ issueId, cost }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      return jsonResponse({
        today: {
          totalCost: Math.round(dailyTotal * 100) / 100,
          agentCount: status.summary.total,
          activeCount: status.summary.active,
          stuckCount: status.summary.stuck,
          warningCount: status.summary.warning,
        },
        topSpenders: {
          agents: topAgents,
          issues: topIssues,
        },
      });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/metrics/costs ───────────────────────────────────────────

const getMetricsCostsRoute = HttpRouter.add(
  'GET',
  '/api/metrics/costs',
  httpHandler(Effect.try({
    try: () => {
      const costSummary = getCloisterService().getCostSummary();
      return jsonResponse({
        dailyTotal: costSummary.dailyTotal,
        topAgents: costSummary.topAgents,
        topIssues: costSummary.topIssues,
      });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/metrics/handoffs ────────────────────────────────────────

const getMetricsHandoffsRoute = HttpRouter.add(
  'GET',
  '/api/metrics/handoffs',
  Effect.succeed(jsonResponse({ totalHandoffs: 0, successRate: 0, byType: {} })),
);

// ─── Route: GET /api/metrics/stuck ───────────────────────────────────────────

const getMetricsStuckRoute = HttpRouter.add(
  'GET',
  '/api/metrics/stuck',
  httpHandler(Effect.try({
    try: () => {
      const status = getCloisterService().getStatus();
      return jsonResponse({ current: status.summary.stuck, incidents: [] });
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/activity ─────────────────────────────────────────────────

const getActivityRoute = HttpRouter.add(
  'GET',
  '/api/activity',
  Effect.succeed(jsonResponse(activities)),
);

// ─── Route: GET /api/activity/:id ────────────────────────────────────────────

const getActivityByIdRoute = HttpRouter.add(
  'GET',
  '/api/activity/:id',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const activity = activities.find(a => a.id === id);
    if (!activity) {
      return jsonResponse({ error: 'Activity not found' }, { status: 404 });
    }
    return jsonResponse(activity);
  }),
);

// ─── Route: GET /api/convoys ──────────────────────────────────────────────────

const getConvoysRoute = HttpRouter.add(
  'GET',
  '/api/convoys',
  httpHandler(Effect.try({
    try: () => jsonResponse({ convoys: listConvoys() }),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  })),
);

// ─── Route: GET /api/convoys/:id ─────────────────────────────────────────────

const getConvoyByIdRoute = HttpRouter.add(
  'GET',
  '/api/convoys/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const convoy = yield* Effect.try({
      try: () => getConvoyStatus(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    if (!convoy) {
      return jsonResponse({ error: 'Convoy not found' }, { status: 404 });
    }
    return jsonResponse(convoy);
  })),
);

// ─── Route: POST /api/convoys/start ──────────────────────────────────────────

const postConvoysStartRoute = HttpRouter.add(
  'POST',
  '/api/convoys/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text;
    let body: { template?: string; context?: ConvoyContext } = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* use empty */ }

    const { template, context } = body;
    const eventStore = yield* EventStoreService;

    if (!template) {
      return jsonResponse({ error: 'Template name is required' }, { status: 400 });
    }
    if (!context?.projectPath) {
      return jsonResponse({ error: 'Context with projectPath is required' }, { status: 400 });
    }

    const convoy = yield* Effect.tryPromise({
      try: () => startConvoy(template, context),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (context.issueId) {
      yield* eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId: context.issueId } });
    }
    return jsonResponse(convoy);
  })),
);

// ─── Route: POST /api/convoys/:id/stop ───────────────────────────────────────

const postConvoyStopRoute = HttpRouter.add(
  'POST',
  '/api/convoys/:id/stop',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    yield* Effect.tryPromise({
      try: () => stopConvoy(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse({ success: true, message: 'Convoy stopped' });
  })),
);

// ─── Route: GET /api/convoys/:id/output ──────────────────────────────────────

const getConvoyOutputRoute = HttpRouter.add(
  'GET',
  '/api/convoys/:id/output',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const convoy = yield* Effect.try({
      try: () => getConvoyStatus(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    if (!convoy) {
      return jsonResponse({ error: 'Convoy not found' }, { status: 404 });
    }

    const outputs: Record<string, string> = {};
    for (const agent of convoy.agents) {
      if (agent.outputFile) {
        // Non-fatal: skip unreadable output files rather than aborting the request
        const content = yield* Effect.promise(() =>
          readFile(agent.outputFile!, 'utf-8').catch(() => null as null | string)
        );
        if (content !== null) {
          outputs[agent.role] = content;
        }
      }
    }

    return jsonResponse({ outputs });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const metricsRouteLayer = Layer.mergeAll(
  getMetricsSummaryRoute,
  getMetricsCostsRoute,
  getMetricsHandoffsRoute,
  getMetricsStuckRoute,
  getActivityRoute,
  getActivityByIdRoute,
  getConvoysRoute,
  getConvoyByIdRoute,
  postConvoysStartRoute,
  postConvoyStopRoute,
  getConvoyOutputRoute,
);

export default metricsRouteLayer;
