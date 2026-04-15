import { jsonResponse } from "../http-helpers.js";
/**
 * Metrics route module — Effect HttpRouter.Layer (PAN-428 B16)
 *
 * Implements all /api/metrics/*, and /api/activity/* endpoints:
 *
 *   GET  /api/metrics/summary
 *   GET  /api/metrics/costs
 *   GET  /api/metrics/handoffs
 *   GET  /api/metrics/stuck
 *   GET  /api/activity
 *   GET  /api/activity/:id
 */

import { readFile } from 'node:fs/promises';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { readEvents } from '../../../lib/costs/index.js';
import { httpHandler } from './http-handler.js';

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
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    // Query last 100 activity.entry events, most recent first
    const events = yield* eventStore.queryByType('activity.entry', 100);
    return jsonResponse(events.map((e) => ({
      id: (e.payload as Record<string, unknown>)['id'] as string,
      timestamp: e.timestamp,
      source: (e.payload as Record<string, unknown>)['source'] as string,
      level: (e.payload as Record<string, unknown>)['level'] as string,
      message: (e.payload as Record<string, unknown>)['message'] as string,
      details: (e.payload as Record<string, unknown>)['details'] as string | null,
      issueId: (e.payload as Record<string, unknown>)['issueId'] as string | null,
    })));
  })),
);

// ─── Route: GET /api/activity/:id ────────────────────────────────────────────

const getActivityByIdRoute = HttpRouter.add(
  'GET',
  '/api/activity/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const eventStore = yield* EventStoreService;
    const id = params['id'] ?? '';
    const events = yield* eventStore.queryByType('activity.entry', 1000);
    const activity = events.find((e) => (e.payload as Record<string, unknown>)['id'] === id);
    if (!activity) {
      return jsonResponse({ error: 'Activity not found' }, { status: 404 });
    }
    return jsonResponse({
      id: (activity.payload as Record<string, unknown>)['id'],
      timestamp: activity.timestamp,
      source: (activity.payload as Record<string, unknown>)['source'],
      level: (activity.payload as Record<string, unknown>)['level'],
      message: (activity.payload as Record<string, unknown>)['message'],
      details: (activity.payload as Record<string, unknown>)['details'],
      issueId: (activity.payload as Record<string, unknown>)['issueId'],
    });
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
);

export default metricsRouteLayer;
