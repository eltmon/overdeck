import { Effect, Layer } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { isMergeTrainEnabledForProject } from '../../../lib/cloister/auto-merge-policy.js';
import { getProjectSync, listProjectsSync } from '../../../lib/projects.js';
import {
  computeMergeQueueFromCandidates,
  listEligibleCandidatesByProject,
  resolveMergeQueuePrUrl,
  type MergeQueueItem,
} from '../../../lib/flywheel-merge-order.js';
import { buildIssueTitleMap } from '../services/issue-title-map.js';

interface MergeTrainQueuePayload {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  queue: MergeQueueItem[];
}

interface MergeTrainMergeNextDeps {
  getOrderedIssueIds?: (projectKey: string) => Promise<string[]>;
  merge?: (issueId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

const readUnknownJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

function uatGenerationNameFromParam(param: string): string {
  const decoded = decodeURIComponent(param);
  return decoded.startsWith('uat/') ? decoded : `uat/${decoded}`;
}

function projectByKey(projectKey: string) {
  return listProjectsSync().find((project) => project.key === projectKey) ?? null;
}

async function queueForProject(projectKey: string, projectRoot: string): Promise<MergeQueueItem[]> {
  const issueTitles = await buildIssueTitleMap();
  const candidates = listEligibleCandidatesByProject({
    titleFor: (issueId) => issueTitles.get(issueId) ?? issueTitles.get(issueId.toLowerCase()),
  }).get(projectKey)?.candidates ?? [];

  return Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, projectRoot, {
      getPrUrl: resolveMergeQueuePrUrl,
    }).pipe(Effect.provide(nodeServicesLayer)),
  );
}

export async function getMergeTrainQueuesPayload(): Promise<MergeTrainQueuePayload[]> {
  const payload: MergeTrainQueuePayload[] = [];
  for (const { key, config } of listProjectsSync()) {
    payload.push({
      projectKey: key,
      projectName: config.name,
      enabled: isMergeTrainEnabledForProject(key),
      queue: await queueForProject(key, config.path),
    });
  }
  return payload;
}

async function defaultGetOrderedIssueIds(projectKey: string): Promise<string[]> {
  const project = projectByKey(projectKey);
  if (!project) return [];
  const queue = await queueForProject(projectKey, project.config.path);
  return queue.map((item) => item.issueId);
}

async function defaultMergeOne(issueId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { triggerMerge } = await import('./workspaces.js');
  const result = await triggerMerge(issueId);
  return result.success ? { ok: true } : { ok: false, reason: result.error ?? result.message ?? 'merge failed' };
}

export async function postMergeTrainMergeNextPayload(payload: unknown, deps: MergeTrainMergeNextDeps = {}) {
  const body = (payload ?? {}) as { n?: unknown; project?: unknown };
  const n = typeof body.n === 'number' && Number.isFinite(body.n) ? Math.floor(body.n) : 0;
  if (n <= 0) return { status: 400, body: { error: 'n must be a positive integer' } };

  const projectKey = typeof body.project === 'string' ? body.project : '';
  if (!projectKey || !getProjectSync(projectKey)) {
    return { status: 404, body: { error: `Unknown project: ${projectKey || '(missing)'}` } };
  }

  const issueIds = (await (deps.getOrderedIssueIds ?? defaultGetOrderedIssueIds)(projectKey)).slice(0, n);
  const { shipMergeBatch } = await import('../../../lib/cloister/merge-batch.js');
  const outcomes = await shipMergeBatch(issueIds, { merge: deps.merge ?? defaultMergeOne });
  return { status: 200, body: { outcomes } };
}

const getMergeTrainQueuesRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/queues',
  httpHandler(Effect.gen(function* () {
    const payload = yield* Effect.promise(() => getMergeTrainQueuesPayload());
    return jsonResponse(payload);
  })),
);

const getMergeTrainGenerationsRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/generations',
  httpHandler(Effect.gen(function* () {
    const { getUatGenerationsPayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const payload = yield* Effect.promise(() => getUatGenerationsPayload());
    return jsonResponse(payload);
  })),
);

const postMergeTrainGenerationStackRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/generations/:name/stack',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const name = uatGenerationNameFromParam(params['name'] ?? '');
    const { postUatGenerationStackPayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const result = yield* Effect.promise(() => postUatGenerationStackPayload(name));
    if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
    return jsonResponse({ frontendUrl: result.frontendUrl, evicted: result.evicted });
  })),
);

const postMergeTrainGenerationPromoteRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/generations/:name/promote',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const name = uatGenerationNameFromParam(params['name'] ?? '');
    const { postUatGenerationPromotePayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const { firePostMergeLifecycle } = yield* Effect.promise(() => import('./specialists.js'));
    const result = yield* Effect.promise(() => postUatGenerationPromotePayload(name, firePostMergeLifecycle));
    if (!result.success) {
      const status = result.reason === 'not-found' ? 404 : result.reason === 'merge-failed' ? 500 : 409;
      return jsonResponse(result, { status });
    }
    return jsonResponse(result);
  })),
);

const postMergeTrainAssembleRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/assemble',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    const body = (parsed.body ?? {}) as { project?: unknown };
    const projectKey = typeof body.project === 'string' ? body.project : undefined;
    if (projectKey && !getProjectSync(projectKey)) {
      return jsonResponse({ error: `Unknown project: ${projectKey}` }, { status: 404 });
    }

    const { runUatTrainReconcile } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const result = yield* Effect.promise(() => runUatTrainReconcile({ force: true, ...(projectKey ? { projectKey } : {}) }));
    return jsonResponse(result);
  })),
);

const postMergeTrainMergeNextRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/merge-next',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const result = yield* Effect.promise(() => postMergeTrainMergeNextPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

export const mergeTrainRouteLayer = Layer.mergeAll(
  getMergeTrainQueuesRoute,
  getMergeTrainGenerationsRoute,
  postMergeTrainGenerationStackRoute,
  postMergeTrainGenerationPromoteRoute,
  postMergeTrainAssembleRoute,
  postMergeTrainMergeNextRoute,
);

export default mergeTrainRouteLayer;
