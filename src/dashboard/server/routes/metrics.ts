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

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { listRunningAgentsAsync } from '../../../lib/agents.js';
import { loadReviewStatuses } from '../../../lib/review-status.js';

// ─── Cached review statuses ───────────────────────────────────────────────────
// loadReviewStatuses() hits SQLite with SELECT * FROM review_status on every
// metrics request. Cache for 5s — review status changes are low-frequency.
let _cachedReviewStatuses: ReturnType<typeof loadReviewStatuses> | null = null;
let _cachedReviewStatusesAt = 0;
const REVIEW_STATUS_CACHE_TTL_MS = 5_000;

function getReviewStatusesCached(): ReturnType<typeof loadReviewStatuses> {
  const now = Date.now();
  if (_cachedReviewStatuses && now - _cachedReviewStatusesAt < REVIEW_STATUS_CACHE_TTL_MS) {
    return _cachedReviewStatuses;
  }
  _cachedReviewStatuses = loadReviewStatuses();
  _cachedReviewStatusesAt = now;
  return _cachedReviewStatuses;
}
import { listGitOperations, type GitOperation } from '../../../lib/git-activity.js';
import { httpHandler } from './http-handler.js';

// ─── Exported helper: safe agentId→issueId map ───────────────────────────────
// Exported for unit testing — skips agents with missing/empty issueId so the
// route never throws on malformed or legacy persisted agent state.

export function buildAgentIssueMap(
  agents: Array<{ id: string; issueId?: string; tmuxActive: boolean }>,
): Map<string, string> {
  return new Map(
    agents
      .filter((a): a is typeof a & { issueId: string } => a.tmuxActive && Boolean(a.issueId))
      .map((a) => [a.id, a.issueId.toUpperCase()]),
  );
}

// ─── Exported helper: union stuck count ──────────────────────────────────────
// Exported for unit testing — used by both /api/metrics/summary and
// /api/metrics/stuck to ensure consistent stuck counts across both endpoints.

export function computeStuckCount(
  agentsNeedingAttention: string[],
  getAgentHealth: (id: string) => { state: string } | null | undefined,
  agentIdToIssueId: Map<string, string>,
  reviewStatuses: Record<string, { stuck?: boolean; issueId: string }>,
): number {
  const persistentSet = new Set(
    Object.values(reviewStatuses)
      .filter((rs) => rs.stuck === true)
      .map((rs) => rs.issueId.toUpperCase()),
  );
  const healthSet = new Set<string>();
  for (const agentId of agentsNeedingAttention) {
    const health = getAgentHealth(agentId);
    if (health?.state === 'stuck') {
      const issueId = agentIdToIssueId.get(agentId);
      if (issueId) healthSet.add(issueId);
    }
  }
  return new Set([...healthSet, ...persistentSet]).size;
}

// ─── Route: GET /api/metrics/summary ─────────────────────────────────────────

const getMetricsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/metrics/summary',
  httpHandler(Effect.gen(function* () {
    const service = getCloisterService();
    const status = service.getStatus();

    // Use in-memory cost summary instead of readEvents() — the events file is
    // 100K+ lines and readFileSync on every metrics request blocks the loop.
    const costSummary = service.getCostSummary();
    const topAgents = costSummary.topAgents.slice(0, 5);
    const topIssues = costSummary.topIssues.slice(0, 5);

    const runningAgents = yield* Effect.promise(() => listRunningAgentsAsync());
    const stuckCount = computeStuckCount(
      status.agentsNeedingAttention,
      (id) => service.getAgentHealth(id),
      buildAgentIssueMap(runningAgents),
      getReviewStatusesCached(),
    );

    return jsonResponse({
      today: {
        totalCost: Math.round(costSummary.dailyTotal * 100) / 100,
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
  httpHandler(Effect.gen(function* () {
    const service = getCloisterService();
    const status = service.getStatus();
    const runningAgents = yield* Effect.promise(() => listRunningAgentsAsync());
    const current = computeStuckCount(
      status.agentsNeedingAttention,
      (id) => service.getAgentHealth(id),
      buildAgentIssueMap(runningAgents),
      getReviewStatusesCached(),
    );
    return jsonResponse({ current, incidents: [] });
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

// ─── Route: GET /api/git-activity ─────────────────────────────────────────────
// Returns recent git_operations rows as ActivityPanel-compatible entries.
// Supports ?since=ISO&issueId=PAN-XXX&limit=N query params.

/** Parse and validate query params for GET /api/git-activity. Exported for unit testing. */
export function parseGitActivityParams(params: URLSearchParams): { since?: string; issueId?: string; limit: number } {
  const since   = params.get('since')   ?? undefined;
  const issueId = params.get('issueId') ?? undefined;
  const limitRaw = params.get('limit');
  const limitParsed = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit   = !isNaN(limitParsed) ? Math.min(Math.max(1, limitParsed), 500) : 200;
  return { since, issueId, limit };
}

/** Map a GitOperation DB row to an ActivityPanel-compatible entry. Exported for unit testing. */
export function mapGitOperationToActivityEntry(op: GitOperation) {
  return {
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
  };
}

const getGitActivityRoute = HttpRouter.add(
  'GET',
  '/api/git-activity',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const params = Option.isSome(urlOpt) ? urlOpt.value.searchParams : new URLSearchParams();

    const { since, issueId, limit } = parseGitActivityParams(params);

    const ops = listGitOperations({ since, issueId, limit });
    const entries = ops.map(mapGitOperationToActivityEntry);
    return jsonResponse(entries);
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
);

export default metricsRouteLayer;
