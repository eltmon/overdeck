/**
 * PAN-1696 merge-train-routes: the aggregate `/api/merge-train/*` namespace.
 *
 * The merge-train (conflict-aware merge order + UAT batch trains) is a
 * per-project pipeline concern, but its only HTTP surface used to live under
 * `/api/flywheel/*` and answered for the Overdeck repo alone. These routes
 * answer for EVERY tracked project and require no active flywheel run: the
 * ready set comes from the review-status records via
 * `listEligibleCandidatesByProject`, not from a run's `activePipeline`.
 *
 * The legacy `/api/flywheel/*` merge-train routes stay in place until the
 * frontend migrates — removing them is the remove-legacy-routes item.
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { resolve } from 'node:path';
import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getProjectSync, listProjectsSync, type ProjectConfig } from '../../../lib/projects.js';
import {
  computeMergeQueueFromCandidates,
  listEligibleCandidatesByProject,
  type MergeQueueItem,
} from '../../../lib/flywheel-merge-order.js';
import { gatherMergeEligibility, isMergeEligible } from '../../../lib/cloister/merge-eligibility.js';
import type { PipelineMembership } from '../../../lib/pipeline-membership.js';

const readUnknownJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

/** A plain JSON object — not null, not an array, not a primitive. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One project's merge-train queue as served by GET /api/merge-train/queues. */
export interface MergeTrainQueueEntry {
  projectKey: string;
  projectName: string;
  /** Effective per-project flag: the project override, else the global setting. */
  enabled: boolean;
  queue: MergeQueueItem[];
}

/** One project's UAT generation chain as served by GET /api/merge-train/generations. */
export interface MergeTrainGenerationsEntry {
  projectKey: string;
  projectName: string;
  enabled: boolean;
  generations: unknown[];
}

/**
 * A disabled project reports an empty queue rather than being omitted, so the
 * multi-project view can render it as an explicitly-off row instead of making
 * "off" and "no ready work" look identical.
 */
async function queueEntryForProject(
  key: string,
  config: ProjectConfig,
  enabled: boolean,
): Promise<MergeTrainQueueEntry> {
  const base = { projectKey: key, projectName: config.name, enabled };
  if (!enabled) return { ...base, queue: [] };

  const projectPath = resolve(config.path);
  const candidates = await listEligibleCandidatesByProject(projectPath);
  if (candidates.length === 0) return { ...base, queue: [] };

  const queue = await Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, projectPath).pipe(Effect.provide(nodeServicesLayer)),
  );
  return { ...base, queue };
}

/**
 * PAN-1696 AC1: one entry per tracked project, with that project's effective
 * flag and queue, with no flywheel run active. One project's git failure must
 * not blank the whole response, so a failed project reports an empty queue.
 */
export async function getMergeTrainQueuesPayload(): Promise<MergeTrainQueueEntry[]> {
  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');
  const projects = listProjectsSync();
  const settled = await Promise.allSettled(
    projects.map(({ key, config }) =>
      queueEntryForProject(key, config, isMergeTrainEnabledForProject(config)),
    ),
  );
  return settled.flatMap((outcome, i) => {
    if (outcome.status === 'fulfilled') return [outcome.value];
    const entry = projects[i];
    if (!entry) return [];
    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    console.warn(`[merge-train] queue for project ${entry.key} failed: ${reason}`);
    return [{ projectKey: entry.key, projectName: entry.config.name, enabled: true, queue: [] }];
  });
}

/** PAN-1696 AC2: per-project generation chains across every tracked project. */
export async function getMergeTrainGenerationsPayload(): Promise<MergeTrainGenerationsEntry[]> {
  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');
  const { getUatGenerationsPayload } = await import('../services/uat-train.js');

  const settled = await Promise.allSettled(
    listProjectsSync().map(async ({ key, config }) => ({
      projectKey: key,
      projectName: config.name,
      enabled: isMergeTrainEnabledForProject(config),
      generations: await getUatGenerationsPayload(resolve(config.path)),
    })),
  );
  return settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
}

/**
 * PAN-1696 AC3: merge the first N issues of the named project's ready set,
 * one at a time, stopping at the first failure (the rest would need
 * re-rebasing). An unknown project key is a 4xx, never a silent empty merge.
 */
export interface MergeTrainMergeNextDeps {
  getOrderedIssueIds?: (projectPath: string) => Promise<string[]>;
  merge?: (issueId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  gatherEligibility?: (issueIds: string[]) => Promise<Map<string, PipelineMembership>>;
}

async function defaultOrderedIssueIdsForProject(projectPath: string): Promise<string[]> {
  const candidates = await listEligibleCandidatesByProject(projectPath);
  if (candidates.length === 0) return [];
  const queue = await Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, projectPath).pipe(Effect.provide(nodeServicesLayer)),
  );
  return queue.map((item) => item.issueId);
}

async function defaultMergeOne(issueId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { triggerMerge } = await import('./workspaces/merge-ops.js');
  const r = await triggerMerge(issueId);
  return r.success ? { ok: true } : { ok: false, reason: r.error ?? r.message ?? 'merge failed' };
}

export async function postMergeTrainMergeNextPayload(
  payload: unknown,
  deps: MergeTrainMergeNextDeps = {},
): Promise<{ status: number; body: unknown }> {
  if (!isJsonObject(payload)) {
    return { status: 400, body: { error: 'body must be a JSON object: { n, project }' } };
  }
  const body = payload as { n?: unknown; project?: unknown };
  const n = typeof body.n === 'number' && Number.isFinite(body.n) ? Math.floor(body.n) : 0;
  if (n <= 0) return { status: 400, body: { error: 'n must be a positive integer' } };

  if (typeof body.project !== 'string' || body.project.trim() === '') {
    return { status: 400, body: { error: 'project must be a non-empty string' } };
  }
  const projectKey = body.project.trim();
  const config = getProjectSync(projectKey);
  if (!config) return { status: 404, body: { error: `Unknown project key: ${projectKey}` } };

  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');
  if (!isMergeTrainEnabledForProject(config)) {
    return { status: 409, body: { error: `merge-train is disabled for project ${projectKey}` } };
  }

  const ordered = await (deps.getOrderedIssueIds ?? defaultOrderedIssueIdsForProject)(resolve(config.path));
  const issueIds = ordered.slice(0, n);
  const memberships = await (deps.gatherEligibility ?? gatherMergeEligibility)(issueIds);
  for (const issueId of issueIds) {
    const membership = memberships.get(issueId.toUpperCase());
    if (!membership || !isMergeEligible(membership)) {
      const reason = membership?.reasons.join('; ') || 'pipeline membership unavailable';
      return { status: 409, body: { error: `${issueId} is not merge-eligible: ${reason}` } };
    }
  }
  const { shipMergeBatch } = await import('../../../lib/cloister/merge-batch.js');
  const outcomes = await shipMergeBatch(issueIds, { merge: deps.merge ?? defaultMergeOne });
  return { status: 200, body: { projectKey, outcomes } };
}

/**
 * PAN-1696: forced reconcile. With `{ project }` it rebuilds that one project's
 * generation; with no body it reconciles every merge-train-enabled project.
 */
export async function postMergeTrainAssemblePayload(payload: unknown): Promise<{ status: number; body: unknown }> {
  // Only a JSON OBJECT may reach the all-projects path. `"x"`, `123`, `null` and
  // `[…]` are all valid JSON that would otherwise read as "no project named" and
  // force a git fetch/worktree sweep across every tracked repo. An absent body
  // arrives here as {} from readUnknownJsonBody, which is the deliberate form.
  if (!isJsonObject(payload)) {
    return { status: 400, body: { error: 'body must be a JSON object: {} for all projects, or { project }' } };
  }
  // Only an ABSENT project field means "every project". A PRESENT but unusable one
  // (42, null, "", {}) is a malformed SCOPED request, and letting it fall through
  // would silently widen it into the broadest git/UAT write we have.
  if ('project' in payload) {
    const raw = payload['project'];
    if (typeof raw !== 'string' || raw.trim() === '') {
      return {
        status: 400,
        body: { error: 'project must be a non-empty string; omit the field entirely to reconcile every project' },
      };
    }
    const projectKey = raw.trim();
    const config = getProjectSync(projectKey);
    if (!config) return { status: 404, body: { error: `Unknown project key: ${projectKey}` } };
    const { runUatTrainReconcile } = await import('../services/uat-train.js');
    const result = await runUatTrainReconcile({ force: true, projectRoot: resolve(config.path) });
    return { status: 200, body: { projects: [{ projectKey, result }] } };
  }

  const { runUatTrainReconcileAllProjects } = await import('../services/uat-train.js');
  const results = await runUatTrainReconcileAllProjects({ force: true });
  return { status: 200, body: { projects: results } };
}

/**
 * PAN-1737 generation names contain a slash (`uat/pan-otter-0610`); URL params
 * carry the name WITHOUT the `uat/` prefix and handlers reconstitute it. Same
 * reconstruction as the legacy flywheel routes so links stay interchangeable.
 */
function uatGenerationNameFromParam(param: string): string {
  const decoded = decodeURIComponent(param);
  return decoded.startsWith('uat/') ? decoded : `uat/${decoded}`;
}

export async function postMergeTrainGenerationShipPayload(
  name: string,
  version: string,
): Promise<{ status: number; body: unknown }> {
  const { getUatGenerationSync } = await import('../../../lib/overdeck/merge-sync.js');
  const generation = getUatGenerationSync(name);
  if (!generation) return { status: 404, body: { error: `No UAT generation named ${name}` } };

  const { shipPromotedBatch, ShipPromotedBatchError } = await import('../../../lib/cloister/ship-record.js');
  try {
    return {
      status: 200,
      body: await shipPromotedBatch({
        generationName: name,
        projectRoot: generation.projectRoot,
        version,
      }),
    };
  } catch (error) {
    if (error instanceof ShipPromotedBatchError) {
      const status = error.reason === 'not-found' ? 404 : error.reason === 'wrong-status' ? 409 : 422;
      return { status, body: { error: error.message } };
    }
    throw error;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const getMergeTrainQueuesRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/queues',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(yield* Effect.promise(() => getMergeTrainQueuesPayload()));
  })),
);

const getMergeTrainGenerationsRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/generations',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(yield* Effect.promise(() => getMergeTrainGenerationsPayload()));
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
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    if (!isJsonObject(parsed.body)) {
      return jsonResponse({ error: 'body must be a JSON object: { shipVersion? }' }, { status: 400 });
    }
    const rawShipVersion = parsed.body['shipVersion'];
    if (rawShipVersion !== undefined && (typeof rawShipVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(rawShipVersion))) {
      return jsonResponse({ error: 'shipVersion must look like 48.8.0' }, { status: 400 });
    }
    const params = yield* HttpRouter.params;
    const name = uatGenerationNameFromParam(params['name'] ?? '');
    const { postUatGenerationPromotePayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const { firePostMergeLifecycle } = yield* Effect.promise(() => import('./specialists.js'));
    const result = yield* Effect.promise(() => postUatGenerationPromotePayload(
      name,
      firePostMergeLifecycle,
      rawShipVersion,
    ));
    if (!result.success) {
      const status = result.reason === 'not-found' ? 404 : result.reason === 'merge-failed' ? 500 : 409;
      return jsonResponse(result, { status });
    }
    return jsonResponse(result);
  })),
);

const postMergeTrainGenerationShipRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/generations/:name/ship',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    if (!isJsonObject(parsed.body)) {
      return jsonResponse({ error: 'version must look like 48.8.0' }, { status: 400 });
    }
    const version = parsed.body['version'];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      return jsonResponse({ error: 'version must look like 48.8.0' }, { status: 400 });
    }

    const params = yield* HttpRouter.params;
    const name = uatGenerationNameFromParam(params['name'] ?? '');
    const result = yield* Effect.promise(() => postMergeTrainGenerationShipPayload(name, version));
    return jsonResponse(result.body, { status: result.status });
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
    // Malformed JSON must 400. Coercing it to {} would silently mean "no project
    // named", i.e. a forced reconcile of EVERY tracked project — a git-heavy
    // fetch/worktree sweep across every repo triggered by a typo'd body. A
    // genuinely empty body still parses to {} in readUnknownJsonBody, so the
    // all-projects form keeps working.
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const result = yield* Effect.promise(() => postMergeTrainAssemblePayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
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
  postMergeTrainGenerationShipRoute,
  postMergeTrainAssembleRoute,
  postMergeTrainMergeNextRoute,
);

export default mergeTrainRouteLayer;
