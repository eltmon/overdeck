/**
 * PAN-1696 merge-train-routes: the aggregate `/api/merge-train/*` namespace.
 *
 * The merge-train (conflict-aware merge order + UAT batch trains) is a
 * per-project pipeline concern, but its only HTTP surface used to live under
 * `/api/flywheel/*` and answered for the Overdeck repo alone. These routes
 * answer for EVERY tracked project and require no active flywheel run: the
 * ready set is derived from the forge — approvals, checks, and mergeability.
 *
 * PAN-3917 W6: the flywheel routes are gone, and the merge-train config and
 * auto-merge surface that lived under `/api/flywheel/*` moved here, under
 * `/api/merge-train/config` and `/api/merge-train/auto-merge/*`. Scheduling an
 * auto-merge no longer consults a flywheel run or a review-status record: it
 * gates on the derived issue state, which is approvals plus green checks plus
 * forge mergeability (FR-9, D3).
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { resolve } from 'node:path';
import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { hasDashboardInternalToken, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getProjectSync, listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig, type ResolvedProject } from '../../../lib/projects.js';
import type { MergeQueueItem } from '../../../lib/flywheel-merge-order.js';
import { gatherMergeEligibility, isMergeEligible } from '../../../lib/cloister/merge-eligibility.js';
import { emitActivityTts } from '../../../lib/activity-logger.js';
import { parseArtifactRef } from '../../../lib/forge.js';
import { validateOrigin } from './origin-validation.js';
import { AUTO_MERGE_COOLDOWN_MS } from '../../../lib/cloister/auto-merge-config.js';
import { autoMergeFromLabels, isAutoMergeEligible, issueHoldsForUat, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';
import {
  getProjectAutoMergeDefault,
  projectHoldsForUat,
  shouldHoldForUat,
  type ProjectAutoMergeDefault,
} from '../../../lib/cloister/auto-merge-policy.js';
import { getMergeBlockersPayload } from '../../../lib/cloister/merge-blockers.js';
import {
  isFlywheelAutoPickupBacklog,
  isFlywheelRequireUatBeforeMerge,
  isMergeTrainEnabled,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
  setMergeTrainEnabled,
} from '../../../lib/overdeck/control-settings.js';
import {
  cancelPending,
  countActionableAutoMerges,
  getActionableAutoMerge,
  listActiveAutoMerges,
  listProblemAutoMerges,
  scheduleAutoMergeWithResult,
  type PendingAutoMerge,
  type ScheduleAutoMergeInput,
  type ScheduleAutoMergeResult,
} from '../../../lib/overdeck/merge-sync.js';
import { listReadyIssuesForProject } from '../services/derived-issue-state.js';
import { evaluateIssueMergeGate, type MergeGateResult } from '../../../lib/cloister/merge-gate.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
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
  /**
   * PAN-3965: one ready feature still gets a batch (its UAT stack). With
   * exactly one feature queued this is that feature's own hold (its label,
   * then the project, then global); otherwise the project-level hold.
   * False = one ready feature merges directly.
   */
  holdsForUat: boolean;
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
  const globalRequireUat = isFlywheelRequireUatBeforeMerge();
  const holdsForUat = projectHoldsForUat(config, globalRequireUat);
  const base = { projectKey: key, projectName: config.name, enabled, holdsForUat };
  if (!enabled) return { ...base, queue: [] };

  const projectPath = resolve(config.path);
  // PAN-3917 FR-9: the ready set is the forge's — approvals, green checks, and
  // mergeability — not a scan of review-status records.
  const candidates = await listReadyIssuesForProject(projectPath);
  if (candidates.length === 0) return { ...base, queue: [] };

  // Imported here so the conflict-ordering module's git work is only loaded
  // when a queue is actually computed.
  const { computeMergeQueueFromCandidates } = await import('../../../lib/flywheel-merge-order.js');
  const queue = await Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, projectPath).pipe(Effect.provide(nodeServicesLayer)),
  );
  // Review of #4017: a lone ready feature's hold is its own (label, then
  // project, then global), the same one the reconciler applies — the page must
  // not say "merges directly" for a feature that gets a UAT batch.
  if (queue.length === 1) {
    return { ...base, holdsForUat: await issueHoldsForUat(queue[0]!.issueId, config, globalRequireUat), queue };
  }
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
    return [{ projectKey: entry.key, projectName: entry.config.name, enabled: true, holdsForUat: projectHoldsForUat(entry.config, isFlywheelRequireUatBeforeMerge()), queue: [] }];
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
  const candidates = await listReadyIssuesForProject(projectPath);
  if (candidates.length === 0) return [];
  const { computeMergeQueueFromCandidates } = await import('../../../lib/flywheel-merge-order.js');
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
  const { getUatGeneration } = await import('../../../lib/overdeck/merge-sync.js');
  const generation = getUatGeneration(name);
  if (!generation) return { status: 404, body: { error: `No UAT generation named ${name}` } };

  const { shipPromotedBatch, ShipPromotedBatchError } = await import('../services/generation-ship.js');
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


// ─── Moved from /api/flywheel/* (PAN-3917 W6, D3) ────────────────────────────
//
// `config` and the auto-merge surface belong to the merge train, not to a
// flywheel run. The flywheel is a loop skill now (D12), so these gate on the
// derived issue state instead of a run id or a review-status record.

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  if (hasDashboardInternalToken(request)) return null;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  return rejectUnsafeDashboardMutationRequest(request);
}

export interface MergeTrainConfigBody {
  auto_pickup_backlog: boolean;
  require_uat_before_merge: boolean;
  merge_train_enabled: boolean;
}

export function getMergeTrainConfigPayload(): MergeTrainConfigBody {
  return {
    auto_pickup_backlog: isFlywheelAutoPickupBacklog(),
    require_uat_before_merge: isFlywheelRequireUatBeforeMerge(),
    merge_train_enabled: isMergeTrainEnabled(),
  };
}

export async function postMergeTrainConfigPayload(payload: unknown): Promise<{ status: number; body: unknown }> {
  if (!isJsonObject(payload)) {
    return { status: 400, body: { error: 'Request body must be a JSON object' } };
  }
  for (const key of ['auto_pickup_backlog', 'require_uat_before_merge', 'merge_train_enabled'] as const) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
      return { status: 400, body: { error: `${key} must be a boolean` } };
    }
  }
  if (payload['auto_pickup_backlog'] !== undefined) setFlywheelAutoPickupBacklog(payload['auto_pickup_backlog'] as boolean);
  if (payload['require_uat_before_merge'] !== undefined) setFlywheelRequireUatBeforeMerge(payload['require_uat_before_merge'] as boolean);
  if (payload['merge_train_enabled'] !== undefined) setMergeTrainEnabled(payload['merge_train_enabled'] as boolean);
  return { status: 200, body: getMergeTrainConfigPayload() };
}

export interface AutoMergeScheduleDeps {
  now?: () => Date;
  isRequireUatBeforeMerge?: () => boolean;
  isMergeTrainEnabled?: () => boolean;
  isEligible?: (issueId: string) => Promise<AutoMergeEligibility>;
  /** The one merge gate (#4040); `evaluateIssueMergeGate` by default. */
  mergeGate?: (issueId: string) => Promise<MergeGateResult>;
  resolveProject?: (issueId: string) => ResolvedProject | null;
  schedule?: (input: ScheduleAutoMergeInput) => ScheduleAutoMergeResult;
  announce?: (issueId: string, entry: PendingAutoMerge) => void;
  getProjectAutoMergeDefault?: (issueId: string) => ProjectAutoMergeDefault;
  /** The issue's tracker labels; defaults to the dashboard's cached tracker row. */
  getIssueLabels?: (issueId: string) => readonly string[];
  /** #3983: true when the cached tracker row says the issue is closed. */
  isIssueClosed?: (issueId: string) => boolean;
}

/**
 * PAN-3932: the issue's `auto-merge` / `hold-for-uat` labels from the cached
 * tracker row. The auto-merge policy map is polled across every in-flight
 * issue, so it reads the cache rather than asking the forge per issue.
 */
function cachedIssueLabels(issueId: string): readonly string[] {
  try {
    return getSharedIssueService().getTrackerIssue(issueId)?.labels ?? [];
  } catch {
    return [];
  }
}

/**
 * #3983: whether the cached tracker row says the issue is closed. An issue the
 * cache does not know reads as open here; the executor reads the tracker live
 * before it merges.
 */
function cachedIssueClosed(issueId: string): boolean {
  try {
    return getSharedIssueService().getTrackerIssue(issueId)?.open === false;
  } catch {
    return false;
  }
}

export interface AutoMergeCancelDeps {
  now?: () => Date;
  getPending?: (issueId: string) => PendingAutoMerge | null;
  cancel?: (id: number, cancelledBy: string) => boolean;
  countRemaining?: (issueId: string) => number;
  announce?: (issueId: string) => void;
}

function announceAutoMergeScheduled(issueId: string, _entry: PendingAutoMerge): void {
  emitActivityTts({
    utterance: `${issueId} auto-merging in 5 minutes; pan merge cancel ${issueId} to abort`,
    priority: 1,
    issueId,
    source: 'dashboard',
    eventType: 'auto-merge-scheduled',
  });
}

function announceAutoMergeCancelled(issueId: string): void {
  emitActivityTts({
    utterance: `auto-merge cancelled for ${issueId}`,
    priority: 1,
    issueId,
    source: 'dashboard',
    eventType: 'auto-merge-cancelled',
  });
}

type AutoMergePolicyDeps = Pick<
  AutoMergeScheduleDeps,
  'getIssueLabels' | 'getProjectAutoMergeDefault' | 'isRequireUatBeforeMerge' | 'isMergeTrainEnabled' | 'isIssueClosed'
>;

/**
 * The schedule door's policy check, which reads no forge: the issue's UAT hold
 * (its `auto-merge` / `hold-for-uat` label (PAN-3932), then the project
 * default, then global), the merge-train switch, and a closed tracker issue
 * (from the cached tracker row). The scheduler (#3983) asks it first, so a held
 * PR costs no forge read per tick.
 */
export function autoMergePolicyRefusal(
  issueId: string,
  deps: AutoMergePolicyDeps = {},
): { status: 412 | 422; body: { error: string } } | null {
  if ((deps.isIssueClosed ?? cachedIssueClosed)(issueId)) {
    return { status: 422, body: { error: `${issueId} is closed in the tracker` } };
  }
  const labels = (deps.getIssueLabels ?? cachedIssueLabels)(issueId);
  const projectDefault = (deps.getProjectAutoMergeDefault ?? getProjectAutoMergeDefault)(issueId);
  const globalRequireUat = (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)();
  if (shouldHoldForUat(autoMergeFromLabels(labels), projectDefault, globalRequireUat)) {
    return { status: 412, body: { error: 'UAT is still required before merge' } };
  }
  if (!(deps.isMergeTrainEnabled ?? isMergeTrainEnabled)()) {
    return { status: 412, body: { error: 'Merge train is disabled' } };
  }
  return null;
}

/**
 * Schedule an auto-merge. The gate is the one merge gate, `evaluateIssueMergeGate`
 * (#4040): approved (a forge review or a trusted verdict marker), green checks,
 * and `mergeable` on the PR the gate links to the issue (FR-9).
 */
export async function postAutoMergeSchedulePayload(payload: unknown, deps: AutoMergeScheduleDeps = {}) {
  if (!isJsonObject(payload)) {
    return { status: 400, body: { error: 'Request body must be a JSON object' } };
  }
  const rawIssueId = payload['issueId'];
  if (typeof rawIssueId !== 'string' || rawIssueId.trim().length === 0) {
    return { status: 400, body: { error: 'issueId must be a non-empty string' } };
  }
  const issueId = rawIssueId.trim().toUpperCase();

  const refusal = autoMergePolicyRefusal(issueId, deps);
  if (refusal) return refusal;

  // #3983: the automatic path needs an approval bound to the PR head.
  const gate = await (deps.mergeGate ?? ((id: string) => evaluateIssueMergeGate(id, {}, { requireApprovalAtHead: true })))(issueId);
  if (!gate.ready) {
    return { status: 422, body: { error: `${issueId} is not ready to merge: ${gate.reason ?? 'the merge gate refused it'}` } };
  }

  const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(issueId);
  if (!eligibility.eligible) {
    return { status: 422, body: { error: eligibility.reason } };
  }

  const prUrl = gate.facts.url;
  if (!prUrl) {
    return { status: 422, body: { error: `No pull request for ${issueId}` } };
  }
  const artifactRef = parseArtifactRef(prUrl);
  if (artifactRef === null) {
    return { status: 422, body: { error: `Pull request URL for ${issueId} is not a recognized forge artifact` } };
  }

  const project = (deps.resolveProject ?? resolveProjectFromIssueSync)(issueId);
  if (!project) return { status: 422, body: { error: `Unknown project for issue ${issueId}` } };

  const scheduledAt = (deps.now ?? (() => new Date()))();
  const scheduledMergeAt = new Date(scheduledAt.getTime() + AUTO_MERGE_COOLDOWN_MS);
  const result = (deps.schedule ?? scheduleAutoMergeWithResult)({
    issueId,
    prUrl,
    prNumber: artifactRef.number,
    projectKey: project.projectKey,
    forge: artifactRef.forge,
    scheduledMergeAt: scheduledMergeAt.toISOString(),
    scheduledAt: scheduledAt.toISOString(),
    ...(gate.facts.headSha ? { headSha: gate.facts.headSha } : {}),
  });
  if (result.created) (deps.announce ?? announceAutoMergeScheduled)(issueId, result.entry);
  return { status: 200, body: result.entry };
}

const AUTO_MERGE_POLL_LIMIT = 100;

export function getPendingAutoMergePayload(): PendingAutoMerge[] {
  return listActiveAutoMerges(AUTO_MERGE_POLL_LIMIT);
}

export function getAutoMergeProblemPayload(): PendingAutoMerge[] {
  return listProblemAutoMerges(AUTO_MERGE_POLL_LIMIT);
}

export function deleteAutoMergePayload(issueIdParam: string, deps: AutoMergeCancelDeps = {}) {
  const issueId = issueIdParam.trim().toUpperCase();
  if (!issueId) return { status: 400, body: { error: 'issueId must be a non-empty string' } };

  const entry = (deps.getPending ?? getActionableAutoMerge)(issueId);
  if (!entry) return { status: 404, body: { error: `No pending auto-merge for ${issueId}` } };
  if (entry.status === 'merging') {
    return { status: 409, body: { error: `Auto-merge cooldown has expired for ${issueId}; merge is in progress` } };
  }

  const cancelledAt = (deps.now ?? (() => new Date()))().toISOString();
  const cancelled = (deps.cancel ?? cancelPending)(entry.id, 'operator');
  if (!cancelled) {
    const raced = (deps.getPending ?? getActionableAutoMerge)(issueId);
    if (raced?.status === 'merging') {
      return { status: 409, body: { error: `Auto-merge cooldown has expired for ${issueId}; merge is in progress` } };
    }
    return { status: 404, body: { error: `No pending auto-merge for ${issueId}` } };
  }

  (deps.announce ?? announceAutoMergeCancelled)(issueId);
  return {
    status: 200,
    body: {
      ...entry,
      status: 'cancelled' as const,
      cancelledAt,
      cancelledBy: 'operator',
      remainingActionable: (deps.countRemaining ?? countActionableAutoMerges)(issueId),
    },
  };
}

/**
 * The effective auto-merge routing key per in-flight issue (PAN-3917, D3).
 *
 * There is no per-issue routing key record any more. The answer is derived:
 * the issue's own `auto-merge` / `hold-for-uat` tracker label (PAN-3932),
 * then its project default, then the global `require_uat_before_merge`.
 * `autoMerge: true` means the train may ship it when green; `false` means
 * hold for UAT.
 */
export async function getAutoMergePolicyPayload(): Promise<{
  issues: Array<{ issueId: string; autoMerge: boolean }>;
}> {
  const globalRequireUat = isFlywheelRequireUatBeforeMerge();
  const { loadIssueStatesForProject } = await import('../services/derived-issue-state.js');
  const IN_FLIGHT = new Set(['working', 'in-review', 'changes-requested', 'ready']);

  const issues: Array<{ issueId: string; autoMerge: boolean }> = [];
  for (const { config } of listProjectsSync()) {
    const projectPath = resolve(config.path);
    let states;
    try {
      states = await loadIssueStatesForProject(projectPath, await listCandidateIssueIds(projectPath));
    } catch (error) {
      console.warn(`[merge-train] auto-merge policy for ${config.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const [issueId, derived] of states) {
      if (!IN_FLIGHT.has(derived.state)) continue;
      const held = shouldHoldForUat(
        autoMergeFromLabels(cachedIssueLabels(issueId)),
        getProjectAutoMergeDefault(issueId),
        globalRequireUat,
      );
      issues.push({ issueId, autoMerge: !held });
    }
  }
  return { issues };
}

/** Issue ids with an open PR in the project — the only ones the train can route. */
async function listCandidateIssueIds(projectPath: string): Promise<string[]> {
  const { listRepoPullRequests, issueIdFromBranch } = await import('../services/derived-issue-state.js');
  const rows = await listRepoPullRequests(projectPath);
  return rows.flatMap((row) => {
    const issueId = issueIdFromBranch(row.headRefName);
    return issueId ? [issueId] : [];
  });
}

const getAutoMergePolicyRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/auto-merge',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(yield* Effect.promise(() => getAutoMergePolicyPayload()));
  })),
);

/** Whether an autonomous merge can actually be performed (GitHub App or gh CLI). */
const getMergeBackendRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/merge-backend',
  httpHandler(Effect.gen(function* () {
    const { getMergeBackendStatus } = yield* Effect.promise(() => import('../../../lib/github-app.js'));
    return jsonResponse(yield* Effect.promise(() => getMergeBackendStatus()));
  })),
);

const getMergeTrainConfigRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/config',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getMergeTrainConfigPayload());
  })),
);

const postMergeTrainConfigRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/config',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const result = yield* Effect.promise(() => postMergeTrainConfigPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getPendingAutoMergeRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/auto-merge/pending',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getPendingAutoMergePayload());
  })),
);

const getAutoMergeProblemsRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/auto-merge/problems',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getAutoMergeProblemPayload());
  })),
);

const postAutoMergeScheduleRoute = HttpRouter.add(
  'POST',
  '/api/merge-train/auto-merge/schedule',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const result = yield* Effect.promise(() => postAutoMergeSchedulePayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const deleteAutoMergeRoute = HttpRouter.add(
  'DELETE',
  '/api/merge-train/auto-merge/:id',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const params = yield* HttpRouter.params;
    const result = deleteAutoMergePayload(params['id'] ?? '');
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getMergeBlockersRoute = HttpRouter.add(
  'GET',
  '/api/merge-train/merge-blockers',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getMergeBlockersPayload());
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
  getMergeTrainConfigRoute,
  postMergeTrainConfigRoute,
  getAutoMergePolicyRoute,
  getMergeBackendRoute,
  getPendingAutoMergeRoute,
  getAutoMergeProblemsRoute,
  postAutoMergeScheduleRoute,
  deleteAutoMergeRoute,
  getMergeBlockersRoute,
);

export default mergeTrainRouteLayer;
