import { jsonResponse } from "../http-helpers.js";
/**
 * Metrics route module — Effect HttpRouter.Layer (PAN-428 B16)
 *
 * Implements all /api/metrics/*, and /api/activity/* endpoints:
 *
 *   GET  /api/metrics/summary
 *   GET  /api/metrics/costs
 *   GET  /api/metrics/stuck
 *   GET  /api/activity
 *   GET  /api/activity/:id
 */

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';
import { activityEntriesFromStoredEvents } from '../read-model.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { getBackendPanes } from '../services/backend-inventory.js';
import { getDerivedIssueState } from '../services/derived-issue-state.js';
import { getTodayCost } from '../../../lib/overdeck/cost-sync.js';
import { getEventLoopDelaySample } from '../services/event-loop-monitor.js';
import { readDurableCloisterStatus } from '../services/cloister-control-surface.js';

// ─── Stuck issues, derived ────────────────────────────────────────────────────
// PAN-3917 FR-6: "stuck" is the derived `stuck` attention (idle N minutes with
// unpushed commits), not a persisted flag on a review-status row. Cached for
// 5s so the metrics endpoints do not re-read the forge per request.
let _cachedStuckIssueIds: Set<string> | null = null;
let _cachedStuckAt = 0;
const STUCK_CACHE_TTL_MS = 5_000;

async function getStuckIssueIdsCached(): Promise<Set<string>> {
  const now = Date.now();
  if (_cachedStuckIssueIds && now - _cachedStuckAt < STUCK_CACHE_TTL_MS) {
    return _cachedStuckIssueIds;
  }
  const issueIds = [...new Set(
    (await getBackendPanes())
      .filter((pane) => pane.state !== 'exited' && pane.issue)
      .map((pane) => pane.issue as string),
  )];
  const stuck = new Set<string>();
  const derived = await Promise.allSettled(issueIds.map((issueId) => getDerivedIssueState(issueId)));
  for (const outcome of derived) {
    if (outcome.status === 'fulfilled' && outcome.value.attention === 'stuck') {
      stuck.add(outcome.value.issueId.toUpperCase());
    }
  }
  _cachedStuckIssueIds = stuck;
  _cachedStuckAt = now;
  return stuck;
}

/** Test seam: drop the derived stuck cache. */
export function _resetStuckCacheForTests(): void {
  _cachedStuckIssueIds = null;
  _cachedStuckAt = 0;
}
import { listGitOperations, type GitOperation } from '../../../lib/git-activity.js';
import { httpHandler } from './http-handler.js';

/** Live panes in the shape the metrics helpers read. */
async function listRunningPanes(): Promise<Array<{ id: string; issueId?: string; tmuxActive: boolean }>> {
  return (await getBackendPanes())
    .filter((pane) => pane.state !== 'exited')
    .map((pane) => ({ id: pane.id, ...(pane.issue ? { issueId: pane.issue } : {}), tmuxActive: true }));
}

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
  stuckIssueIds: ReadonlySet<string>,
): number {
  const persistentSet = new Set([...stuckIssueIds].map((issueId) => issueId.toUpperCase()));
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

export function buildMetricsSummaryPayload(params: {
  todayCost: number;
  status: {
    summary: {
      total: number;
      active: number;
      warning: number;
    };
    agentsNeedingAttention: string[];
  };
  costSummary: {
    topAgents: unknown[];
    topIssues: unknown[];
  };
  runningAgents: Array<{ id: string; issueId?: string; tmuxActive: boolean }>;
  stuckIssueIds: ReadonlySet<string>;
  getAgentHealth: (id: string) => { state: string } | null | undefined;
  eventLoop: ReturnType<typeof getEventLoopDelaySample>;
}) {
  const topAgents = params.costSummary.topAgents.slice(0, 5);
  const topIssues = params.costSummary.topIssues.slice(0, 5);
  const stuckCount = computeStuckCount(
    params.status.agentsNeedingAttention,
    params.getAgentHealth,
    buildAgentIssueMap(params.runningAgents),
    params.stuckIssueIds,
  );

  return {
    today: {
      totalCost: Math.round(params.todayCost * 100) / 100,
      agentCount: params.status.summary.total,
      activeCount: params.status.summary.active,
      stuckCount,
      warningCount: params.status.summary.warning,
    },
    topSpenders: {
      agents: topAgents,
      issues: topIssues,
    },
    eventLoop: params.eventLoop,
  };
}

// ─── Route: GET /api/metrics/summary ─────────────────────────────────────────

const getMetricsSummaryRoute = HttpRouter.add(
  'GET',
  '/api/metrics/summary',
  httpHandler(Effect.gen(function* () {
    const service = getCloisterService();
    const status = yield* Effect.promise(() => readDurableCloisterStatus());

    const costSummary = service.getCostSummary();
    const todayCost = getTodayCost();

    const runningAgents = yield* Effect.promise(() => listRunningPanes());
    return jsonResponse(buildMetricsSummaryPayload({
      todayCost,
      status,
      costSummary,
      runningAgents,
      stuckIssueIds: yield* Effect.promise(() => getStuckIssueIdsCached()),
      getAgentHealth: (id) => service.getAgentHealth(id),
      eventLoop: getEventLoopDelaySample(),
    }));
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

// ─── Route: GET /api/metrics/stuck ───────────────────────────────────────────

const getMetricsStuckRoute = HttpRouter.add(
  'GET',
  '/api/metrics/stuck',
  httpHandler(Effect.gen(function* () {
    const service = getCloisterService();
    const status = yield* Effect.promise(() => readDurableCloisterStatus());
    const runningAgents = yield* Effect.promise(() => listRunningPanes());
    const current = computeStuckCount(
      status.agentsNeedingAttention,
      (id) => service.getAgentHealth(id),
      buildAgentIssueMap(runningAgents),
      yield* Effect.promise(() => getStuckIssueIdsCached()),
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
    // Query enough transitions to return the latest 100 logical activities.
    const events = yield* eventStore.queryByType('activity.entry', 300);
    return jsonResponse(activityEntriesFromStoredEvents(events, 100));
  })),
);

// ─── Route: GET /api/activity/detailed ────────────────────────────────────────

const getActivityDetailedRoute = HttpRouter.add(
  'GET',
  '/api/activity/detailed',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const events = yield* eventStore.queryByType('activity.detailed', 200);
    return jsonResponse(events.map((e) => ({
      id: (e.payload as Record<string, unknown>)['id'] as string,
      timestamp: e.timestamp,
      source: (e.payload as Record<string, unknown>)['source'] as string,
      level: (e.payload as Record<string, unknown>)['level'] as string,
      message: (e.payload as Record<string, unknown>)['message'] as string,
      details: (e.payload as Record<string, unknown>)['details'] as string | null,
      issueId: (e.payload as Record<string, unknown>)['issueId'] as string | null,
      triggeringEvent: (e.payload as Record<string, unknown>)['triggeringEvent'] as string | null,
    })));
  })),
);

// ─── Route: GET /api/activity/tts ─────────────────────────────────────────────

const getActivityTtsRoute = HttpRouter.add(
  'GET',
  '/api/activity/tts',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const events = yield* eventStore.queryByType('activity.tts', 50);
    return jsonResponse(events.map((e) => ({
      id: (e.payload as Record<string, unknown>)['id'] as string,
      timestamp: e.timestamp,
      utterance: (e.payload as Record<string, unknown>)['utterance'] as string,
      priority: (e.payload as Record<string, unknown>)['priority'] as number | null,
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
    const activity = (activityEntriesFromStoredEvents(events, 1000) as Array<Record<string, unknown>>)
      .find(entry => entry['id'] === id);
    if (!activity) {
      return jsonResponse({ error: 'Activity not found' }, { status: 404 });
    }
    return jsonResponse({
      id: activity['id'],
      timestamp: activity['timestamp'],
      source: activity['source'],
      level: activity['level'],
      status: activity['status'],
      command: activity['command'],
      message: activity['message'],
      details: activity['details'],
      output: activity['output'],
      issueId: activity['issueId'],
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
  getMetricsStuckRoute,
  getActivityRoute,
  getActivityDetailedRoute,
  getActivityTtsRoute,
  getActivityByIdRoute,
  getGitActivityRoute,
);

export default metricsRouteLayer;
