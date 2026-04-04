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

import { existsSync, readFileSync } from 'node:fs';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { readEvents } from '../../../lib/costs/index.js';
import { startConvoy, stopConvoy, getConvoyStatus, listConvoys, type ConvoyContext } from '../../../lib/convoy.js';

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
  Effect.try({
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

      return HttpServerResponse.json({
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
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting metrics summary:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get metrics summary: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/metrics/costs ───────────────────────────────────────────

const getMetricsCostsRoute = HttpRouter.add(
  'GET',
  '/api/metrics/costs',
  Effect.try({
    try: () => {
      const service = getCloisterService();
      const costSummary = service.getCostSummary();

      return HttpServerResponse.json({
        dailyTotal: costSummary.dailyTotal,
        topAgents: costSummary.topAgents,
        topIssues: costSummary.topIssues,
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting cost metrics:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get cost metrics: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/metrics/handoffs ────────────────────────────────────────

const getMetricsHandoffsRoute = HttpRouter.add(
  'GET',
  '/api/metrics/handoffs',
  Effect.try({
    try: () =>
      HttpServerResponse.json({
        totalHandoffs: 0,
        successRate: 0,
        byType: {},
      }),
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting handoff metrics:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get handoff metrics: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/metrics/stuck ───────────────────────────────────────────

const getMetricsStuckRoute = HttpRouter.add(
  'GET',
  '/api/metrics/stuck',
  Effect.try({
    try: () => {
      const service = getCloisterService();
      const status = service.getStatus();

      return HttpServerResponse.json({
        current: status.summary.stuck,
        incidents: [],
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting stuck agent metrics:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get stuck agent metrics: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/activity ─────────────────────────────────────────────────

const getActivityRoute = HttpRouter.add(
  'GET',
  '/api/activity',
  Effect.sync(() => HttpServerResponse.json(activities)),
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
      return HttpServerResponse.json({ error: 'Activity not found' }, { status: 404 });
    }
    return HttpServerResponse.json(activity);
  }),
);

// ─── Route: GET /api/convoys ──────────────────────────────────────────────────

const getConvoysRoute = HttpRouter.add(
  'GET',
  '/api/convoys',
  Effect.try({
    try: () => {
      const convoys = listConvoys();
      return HttpServerResponse.json({ convoys });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error listing convoys:', error);
      return HttpServerResponse.json(
        { error: 'Failed to list convoys: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/convoys/:id ─────────────────────────────────────────────

const getConvoyByIdRoute = HttpRouter.add(
  'GET',
  '/api/convoys/:id',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.try({
      try: () => {
        const convoy = getConvoyStatus(id);
        if (!convoy) {
          return HttpServerResponse.json({ error: 'Convoy not found' }, { status: 404 });
        }
        return HttpServerResponse.json(convoy);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting convoy status:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get convoy status: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/convoys/start ──────────────────────────────────────────

const postConvoysStartRoute = HttpRouter.add(
  'POST',
  '/api/convoys/start',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text;
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    const { template, context } = body;
    const eventStore = yield* EventStoreService;

    if (!template) {
      return HttpServerResponse.json({ error: 'Template name is required' }, { status: 400 });
    }

    if (!context || !context.projectPath) {
      return HttpServerResponse.json(
        { error: 'Context with projectPath is required' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const convoy = await startConvoy(template, context as ConvoyContext);
        if ((context as ConvoyContext).issueId) {
          Effect.runSync(eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId: (context as ConvoyContext).issueId } }));
        }
        return HttpServerResponse.json(convoy);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error starting convoy:', error);
        return HttpServerResponse.json(
          { error: 'Failed to start convoy: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/convoys/:id/stop ───────────────────────────────────────

const postConvoyStopRoute = HttpRouter.add(
  'POST',
  '/api/convoys/:id/stop',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        await stopConvoy(id);
        return HttpServerResponse.json({ success: true, message: 'Convoy stopped' });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error stopping convoy:', error);
        return HttpServerResponse.json(
          { error: 'Failed to stop convoy: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/convoys/:id/output ──────────────────────────────────────

const getConvoyOutputRoute = HttpRouter.add(
  'GET',
  '/api/convoys/:id/output',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.try({
      try: () => {
        const convoy = getConvoyStatus(id);
        if (!convoy) {
          return HttpServerResponse.json({ error: 'Convoy not found' }, { status: 404 });
        }

        const outputs: Record<string, string> = {};
        for (const agent of convoy.agents) {
          if (agent.outputFile && existsSync(agent.outputFile)) {
            try {
              outputs[agent.role] = readFileSync(agent.outputFile, 'utf-8');
            } catch (err) {
              outputs[agent.role] = `Error reading output: ${err}`;
            }
          }
        }

        return HttpServerResponse.json({ outputs });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting convoy output:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get convoy output: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
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
