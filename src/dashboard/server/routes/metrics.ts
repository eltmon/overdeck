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
import { listRunningAgents } from '../../../lib/agents.js';
import { loadReviewStatuses } from '../../../lib/review-status.js';
import { listGitOperations } from '../services/git-activity.js';
import { readEvents } from '../../../lib/costs/index.js';
import { startConvoy, stopConvoy, getConvoyStatus, listConvoys, type ConvoyContext } from '../../../lib/convoy.js';
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

      // Compute stuck count as union of:
      //   1. Agents with inactivity-based health.state === 'stuck'
      //   2. Workspaces with persistent review_status.stuck = true (divergence guard)
      // Deduped by issueId — an issue with both flags set must count as 1, not 2.
      const reviewStatuses = loadReviewStatuses();
      const persistentStuckIssueIds = new Set(
        Object.values(reviewStatuses)
          .filter((rs) => rs.stuck === true)
          .map((rs) => rs.issueId.toUpperCase())
      );
      // Map agentId → issueId for running agents, then check health state per agent.
      const agentIdToIssueId = new Map(
        listRunningAgents().filter((a) => a.tmuxActive).map((a) => [a.id, a.issueId.toUpperCase()])
      );
      const healthStuckIssueIds = new Set<string>();
      for (const agentId of status.agentsNeedingAttention) {
        const health = service.getAgentHealth(agentId);
        if (health?.state === 'stuck') {
          const issueId = agentIdToIssueId.get(agentId);
          if (issueId) healthStuckIssueIds.add(issueId);
        }
      }
      const stuckCount = new Set([...healthStuckIssueIds, ...persistentStuckIssueIds]).size;

      return jsonResponse({
        today: {
          totalCost: Math.round(dailyTotal * 100) / 100,
          agentCount: status.summary.total,
          activeCount: status.summary.active,
          stuckCount,
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

// ─── Route: GET /api/git-activity ─────────────────────────────────────────────
// Returns recent git_operations rows as ActivityPanel-compatible entries.
// Supports ?since=ISO&issueId=PAN-XXX&limit=N query params.

const getGitActivityRoute = HttpRouter.add(
  'GET',
  '/api/git-activity',
  httpHandler(Effect.try({
    try: () => {
      const ops = listGitOperations({ limit: 200 });
      // Map to ActivityPanel-compatible format
      const entries = ops.map((op) => ({
        id: `git-op-${op.id ?? op.ts}`,
        timestamp: op.ts,
        source: 'git',
        level: op.status === 'success' ? 'success'
          : op.status === 'aborted' ? 'warn'
          : 'error',
        message: `${op.operation}: ${op.branch ?? '?'} [${op.status}]`,
        details: [
          op.beforeSha && `before: ${op.beforeSha}`,
          op.afterSha && `after: ${op.afterSha}`,
          op.remoteSha && `remote: ${op.remoteSha}`,
          op.error && `error: ${op.error}`,
        ].filter(Boolean).join('\n') || null,
        issueId: op.issueId ?? null,
        category: 'git',
      }));
      return jsonResponse(entries);
    },
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  }))
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const metricsRouteLayer = Layer.mergeAll(
  getMetricsSummaryRoute,
  getMetricsCostsRoute,
  getMetricsHandoffsRoute,
  getMetricsStuckRoute,
  getActivityRoute,
  getActivityByIdRoute,
  getGitActivityRoute,
  getConvoysRoute,
  getConvoyByIdRoute,
  postConvoysStartRoute,
  postConvoyStopRoute,
  getConvoyOutputRoute,
);

export default metricsRouteLayer;
