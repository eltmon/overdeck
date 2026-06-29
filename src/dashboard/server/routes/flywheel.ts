import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Effect, Layer, Option, Schema } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { FlywheelRunId, FlywheelStats, FlywheelStatus, type FlywheelStats as FlywheelStatsPayload } from '@overdeck/contracts';
import { emitActivityTtsSync } from '../../../lib/activity-logger.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';
import {
  getFlywheelRunDetail,
  isFlywheelRunId,
  listFlywheelRuns,
  resolveLiveFlywheelRunId,
  writeLatestFlywheelStatus,
  type FlywheelRunListOptions,
  type FlywheelRunStateOptions,
} from '../services/flywheel-run-state.js';
import { hasDashboardInternalToken, rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { sessionExists } from '../../../lib/tmux.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';
import {
  abortFlywheelRunForDashboard,
  openFlywheelRunReportForDashboard,
  pauseFlywheelRunForDashboard,
  readCurrentFlywheelStatusForDashboard,
  resumeFlywheelRunForDashboard,
  startFlywheelRunForDashboard,
} from '../services/flywheel-actions.js';
import { readFlywheelState } from '../services/flywheel-state.js';
import { computeFlywheelStats, parseFlywheelStatsWindow } from '../services/flywheel-telemetry.js';
import { derivePipelineRunStatsInputs } from '../services/pipeline-run-metrics.js';
import {
  isFlywheelAutoPickupBacklog,
  isFlywheelGloballyPaused,
  isFlywheelRequireUatBeforeMerge,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
  isMergeTrainEnabled,
  setMergeTrainEnabled,
} from '../../../lib/overdeck/control-settings.js';
import { AUTO_MERGE_COOLDOWN_MS } from '../../../lib/cloister/auto-merge-config.js';
import { isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';
import { shouldHoldForUat, getProjectAutoMergeDefault, type ProjectAutoMergeDefault } from '../../../lib/cloister/auto-merge-policy.js';
import { parseArtifactRef } from '../../../lib/forge.js';
import { getReviewStatusSync, type ReviewStatus } from '../../../lib/review-status.js';
import { getAllReviewStatusesFromDb } from '../../../lib/overdeck/review-status-sync.js';
import { resolveProjectFromIssueSync, type ResolvedProject } from '../../../lib/projects.js';
import {
  cancelPending,
  getActionableAutoMerge,
  listActiveAutoMerges,
  listProblemAutoMerges,
  scheduleAutoMergeWithResult,
  type PendingAutoMerge,
  type ScheduleAutoMergeInput,
  type ScheduleAutoMergeResult,
} from '../../../lib/overdeck/merge-sync.js';
import { getMergeBackendRoute } from './flywheel-merge-backend.js';

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';
const FLYWHEEL_CONVERSATION_NAME = 'flywheel-orchestrator';
const AUTO_MERGE_POLL_LIMIT = 100;

interface BriefRequestBody {
  content?: unknown;
  path?: unknown;
}

interface StartRequestBody {
  brief?: unknown;
}

interface FlywheelConfigRequestBody {
  auto_pickup_backlog?: unknown;
  require_uat_before_merge?: unknown;
  merge_train_enabled?: unknown;
}

interface FlywheelConfigResponseBody {
  auto_pickup_backlog: boolean;
  require_uat_before_merge: boolean;
  merge_train_enabled: boolean;
}

interface AutoMergeScheduleRequestBody {
  issueId?: unknown;
}

interface ReportOpenRequestBody {
  runId?: unknown;
}

interface FlywheelStatusResponse {
  status: number;
  body: { ok: true; runId: string } | { error: string; details: string[] };
}

interface FlywheelStatsResponse {
  status: number;
  body: FlywheelStatsPayload | { error: string; details?: string[] };
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const decodeFlywheelStats = Schema.decodeUnknownSync(FlywheelStats);
const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunId);

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  if (hasDashboardInternalToken(request)) return null;
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
}

function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function parseRunIdParam(runId: string): { ok: true; runId: string } | { ok: false; error: string } {
  try {
    return { ok: true, runId: decodeFlywheelRunId(runId) };
  } catch {
    return { ok: false, error: 'Flywheel run id must match RUN-<number>' };
  }
}

function parseRunsLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

export function resolveFlywheelBriefPath(projectRoot: string): { ok: true; path: string } | { ok: false; error: string } {
  const root = resolve(projectRoot);
  const resolvedPath = resolve(root, DEFAULT_BRIEF_PATH);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  const displayPath = relative(root, resolvedPath);
  return { ok: true, path: resolvedPath.startsWith(normalizedRoot) ? displayPath : resolvedPath };
}

function resolveBriefAbsolutePath(projectRoot: string): { ok: true; absolutePath: string; displayPath: string } | { ok: false; error: string } {
  const resolved = resolveFlywheelBriefPath(projectRoot);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    absolutePath: resolve(projectRoot, resolved.path),
    displayPath: resolved.path,
  };
}

async function assertExistingPathInsideRoot(projectRoot: string, candidate: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [realRoot, realCandidate] = await Promise.all([realpath(projectRoot), realpath(candidate)]);
  return isInsideRoot(realRoot, realCandidate)
    ? { ok: true }
    : { ok: false, error: 'Brief path must stay inside the project root' };
}

async function assertWritePathInsideRoot(projectRoot: string, candidate: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const realRoot = await realpath(projectRoot);
  const realParent = await realpath(dirname(candidate));
  if (!isInsideRoot(realRoot, realParent)) return { ok: false, error: 'Brief path must stay inside the project root' };

  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      const realCandidate = await realpath(candidate);
      if (!isInsideRoot(realRoot, realCandidate)) return { ok: false, error: 'Brief path must stay inside the project root' };
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') throw error;
  }

  return { ok: true };
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as BriefRequestBody) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

const readUnknownJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

export async function postFlywheelStatusPayload(payload: unknown, options: FlywheelRunStateOptions = {}): Promise<FlywheelStatusResponse> {
  try {
    const status = decodeFlywheelStatus(payload);
    await writeLatestFlywheelStatus(status, options);
    return { status: 200, body: { ok: true, runId: status.runId } };
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'Invalid FlywheelStatus payload',
        details: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

export async function getFlywheelRunsPayload(options: FlywheelRunListOptions = {}) {
  return listFlywheelRuns(options);
}

export async function getFlywheelRunPayload(runId: string, options: FlywheelRunStateOptions = {}) {
  if (!isFlywheelRunId(runId)) return null;
  return getFlywheelRunDetail(runId, options);
}

export function getFlywheelConfigPayload(): FlywheelConfigResponseBody {
  return {
    auto_pickup_backlog: isFlywheelAutoPickupBacklog(),
    require_uat_before_merge: isFlywheelRequireUatBeforeMerge(),
    merge_train_enabled: isMergeTrainEnabled(),
  };
}

export async function postFlywheelConfigPayload(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { status: 400, body: { error: 'Request body must be a JSON object' } };
  }

  const body = payload as FlywheelConfigRequestBody;
  if (body.auto_pickup_backlog !== undefined && typeof body.auto_pickup_backlog !== 'boolean') {
    return { status: 400, body: { error: 'auto_pickup_backlog must be a boolean' } };
  }
  if (body.require_uat_before_merge !== undefined && typeof body.require_uat_before_merge !== 'boolean') {
    return { status: 400, body: { error: 'require_uat_before_merge must be a boolean' } };
  }
  if (body.merge_train_enabled !== undefined && typeof body.merge_train_enabled !== 'boolean') {
    return { status: 400, body: { error: 'merge_train_enabled must be a boolean' } };
  }

  if (body.auto_pickup_backlog !== undefined) setFlywheelAutoPickupBacklog(body.auto_pickup_backlog);
  if (body.require_uat_before_merge !== undefined) setFlywheelRequireUatBeforeMerge(body.require_uat_before_merge);
  if (body.merge_train_enabled !== undefined) setMergeTrainEnabled(body.merge_train_enabled);

  return { status: 200, body: getFlywheelConfigPayload() };
}

interface AutoMergeScheduleDeps {
  now?: () => Date;
  isRequireUatBeforeMerge?: () => boolean;
  isFlywheelPaused?: () => boolean;
  resolveLiveRunId?: () => Promise<string | null>;
  isEligible?: (issueId: string) => Promise<AutoMergeEligibility>;
  getReviewStatus?: (issueId: string) => ReviewStatus | null;
  resolveProject?: (issueId: string) => ResolvedProject | null;
  schedule?: (input: ScheduleAutoMergeInput) => ScheduleAutoMergeResult;
  announce?: (issueId: string, entry: PendingAutoMerge) => void;
  getProjectAutoMergeDefault?: (issueId: string) => ProjectAutoMergeDefault;
}

interface AutoMergeCancelDeps {
  now?: () => Date;
  getPending?: (issueId: string) => PendingAutoMerge | null;
  cancel?: (id: number, cancelledBy: string) => boolean;
  announce?: (issueId: string) => void;
}

function announceAutoMergeScheduled(issueId: string, entry: PendingAutoMerge): void {
  emitActivityTtsSync({
    utterance: `${issueId} auto-merging in 5 minutes; pan merge cancel ${issueId} to abort`,
    priority: 1,
    issueId,
    source: 'dashboard',
    eventType: 'auto-merge-scheduled',
  });
}

function announceAutoMergeCancelled(issueId: string): void {
  emitActivityTtsSync({
    utterance: `auto-merge cancelled for ${issueId}`,
    priority: 1,
    issueId,
    source: 'dashboard',
    eventType: 'auto-merge-cancelled',
  });
}

export async function postAutoMergeSchedulePayload(payload: unknown, deps: AutoMergeScheduleDeps = {}) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { status: 400, body: { error: 'Request body must be a JSON object' } };
  }

  const body = payload as AutoMergeScheduleRequestBody;
  if (typeof body.issueId !== 'string' || body.issueId.trim().length === 0) {
    return { status: 400, body: { error: 'issueId must be a non-empty string' } };
  }
  const issueId = body.issueId.trim().toUpperCase();

  const reviewStatus = (deps.getReviewStatus ?? getReviewStatusSync)(issueId);

  // PAN-1691/1695: resolve the hold-for-UAT decision across three tiers —
  // per-issue autoMerge (true=auto / false=hold) → per-project default →
  // global require-UAT. Auto is the only state that overrides a hold default.
  const projectDefault = (deps.getProjectAutoMergeDefault ?? getProjectAutoMergeDefault)(issueId);
  const globalRequireUat = (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)();
  if (shouldHoldForUat(reviewStatus?.autoMerge, projectDefault, globalRequireUat)) {
    return { status: 412, body: { error: 'UAT is still required before merge' } };
  }
  if ((deps.isFlywheelPaused ?? isFlywheelGloballyPaused)()) {
    return { status: 423, body: { error: 'Flywheel is paused' } };
  }
  if (!await (deps.resolveLiveRunId ?? resolveLiveFlywheelRunId)()) {
    return { status: 412, body: { error: 'Flywheel is not running' } };
  }

  const eligibility = await (deps.isEligible ?? isAutoMergeEligible)(issueId);
  if (!eligibility.eligible) {
    return { status: 422, body: { error: eligibility.reason } };
  }

  if (!reviewStatus?.prUrl) {
    return { status: 422, body: { error: 'review status PR URL is missing or invalid' } };
  }
  const artifactRef = parseArtifactRef(reviewStatus.prUrl);
  if (artifactRef === null) {
    return { status: 422, body: { error: 'review status PR URL is missing or invalid' } };
  }

  const project = (deps.resolveProject ?? resolveProjectFromIssueSync)(issueId);
  if (!project) return { status: 422, body: { error: `Unknown project for issue ${issueId}` } };

  const scheduledAt = (deps.now ?? (() => new Date()))();
  const scheduledMergeAt = new Date(scheduledAt.getTime() + AUTO_MERGE_COOLDOWN_MS);
  const result = (deps.schedule ?? scheduleAutoMergeWithResult)({
    issueId,
    prUrl: reviewStatus.prUrl,
    prNumber: artifactRef.number,
    projectKey: project.projectKey,
    forge: artifactRef.forge,
    scheduledMergeAt: scheduledMergeAt.toISOString(),
    scheduledAt: scheduledAt.toISOString(),
  });
  if (result.created) (deps.announce ?? announceAutoMergeScheduled)(issueId, result.entry);
  return { status: 200, body: result.entry };
}
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
    },
  };
}

export async function getFlywheelCurrentPayload() {
  return readCurrentFlywheelStatusForDashboard();
}

export async function getFlywheelConversationPayload() {
  const conversation = await runDashboardDbJob<{ tmuxSession: string } | null>('getConversationByName', FLYWHEEL_CONVERSATION_NAME);
  if (!conversation) return null;
  const sessionAlive = await Effect.runPromise(sessionExists(conversation.tmuxSession));
  return { ...conversation, sessionAlive };
}

export async function postFlywheelReportPayload() {
  const { flywheelReportCommand } = await import('../../../cli/commands/flywheel.js');
  await flywheelReportCommand({ cwd: process.cwd() });
  return { status: 200, body: { ok: true } };
}

interface FlywheelActionDeps {
  start?: typeof startFlywheelRunForDashboard;
  pause?: typeof pauseFlywheelRunForDashboard;
  resume?: typeof resumeFlywheelRunForDashboard;
  abort?: typeof abortFlywheelRunForDashboard;
  openReport?: typeof openFlywheelRunReportForDashboard;
}

interface FlywheelStatsDeps {
  compute?: typeof computeFlywheelStats;
  deriveInputs?: typeof derivePipelineRunStatsInputs;
  now?: () => Date;
}

export async function getFlywheelStatsPayload(window: string | null | undefined, deps: FlywheelStatsDeps = {}): Promise<FlywheelStatsResponse> {
  const selectedWindow = window ?? '30d';
  try {
    const generatedAt = (deps.now ?? (() => new Date()))();
    const parsedWindow = parseFlywheelStatsWindow(selectedWindow);
    const since = new Date(generatedAt.getTime() - parsedWindow.ms).toISOString();
    const until = generatedAt.toISOString();
    const stats = deps.compute
      ? await deps.compute(selectedWindow)
      : await computeFlywheelStats(selectedWindow, {
          generatedAt,
          ...await (deps.deriveInputs ?? derivePipelineRunStatsInputs)(since, until),
        });
    return { status: 200, body: decodeFlywheelStats(stats) };
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'Invalid Flywheel stats window or payload',
        details: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

export async function postFlywheelStartPayload(payload: unknown, deps: FlywheelActionDeps = {}) {
  const body = (payload ?? {}) as StartRequestBody;
  if (body.brief !== undefined && typeof body.brief !== 'string') {
    return { status: 400, body: { error: 'brief must be a string when provided' } };
  }
  const result = await (deps.start ?? startFlywheelRunForDashboard)({ cwd: process.cwd(), brief: body.brief });
  return { status: 200, body: { ok: true, runId: result.runId } };
}

export async function postFlywheelPausePayload(deps: FlywheelActionDeps = {}) {
  const result = await (deps.pause ?? pauseFlywheelRunForDashboard)();
  return { status: 200, body: { ok: true, changed: result.changed } };
}

export async function postFlywheelResumePayload(deps: FlywheelActionDeps = {}) {
  const result = await (deps.resume ?? resumeFlywheelRunForDashboard)();
  return { status: 200, body: { ok: true, changed: result.changed } };
}

export async function postFlywheelAbortPayload(deps: FlywheelActionDeps = {}) {
  const result = await (deps.abort ?? abortFlywheelRunForDashboard)();
  return { status: 200, body: { ok: true, aborted: result.aborted } };
}

export async function postFlywheelReportOpenPayload(payload: unknown, deps: FlywheelActionDeps = {}) {
  const body = (payload ?? {}) as ReportOpenRequestBody;
  if (body.runId !== undefined && typeof body.runId !== 'string') {
    return { status: 400, body: { error: 'runId must be a string when provided' } };
  }
  if (typeof body.runId === 'string') {
    const parsed = parseRunIdParam(body.runId);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  }
  const result = await (deps.openReport ?? openFlywheelRunReportForDashboard)({ runId: body.runId });
  return { status: 200, body: { ok: true, runId: result.runId, path: result.path } };
}

const getFlywheelRunsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/runs',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const limit = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => parseRunsLimit(url.searchParams.get('limit')),
    }));
    return yield* Effect.promise(async () => jsonResponse(await getFlywheelRunsPayload({ limit })));
  })),
);

const getFlywheelRunRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/runs/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const runId = params['id'] ?? '';
    const parsed = parseRunIdParam(runId);
    if (!parsed.ok) return jsonResponse({ error: parsed.error, runId }, { status: 400 });
    const run = yield* Effect.promise(() => getFlywheelRunPayload(parsed.runId));
    if (!run) return jsonResponse({ error: 'Flywheel run not found', runId: parsed.runId }, { status: 404 });
    return jsonResponse(run);
  })),
);

const getFlywheelConversationRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/conversation',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => jsonResponse(await getFlywheelConversationPayload()));
  })),
);

const getFlywheelCurrentRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/current',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => jsonResponse(await getFlywheelCurrentPayload()));
  })),
);

const getFlywheelStatsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/stats',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const window = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => url.searchParams.get('window'),
    }));
    const result = yield* Effect.promise(() => getFlywheelStatsPayload(window));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getFlywheelConfigRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/config',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getFlywheelConfigPayload());
  })),
);

const postFlywheelConfigRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/config',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    const result = yield* Effect.promise(() => postFlywheelConfigPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getPendingAutoMergeRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/auto-merge/pending',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getPendingAutoMergePayload());
  })),
);

const getAutoMergeProblemsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/auto-merge/problems',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getAutoMergeProblemPayload());
  })),
);

/**
 * Issues that passed review but are blocked from merging by a GitHub-native
 * reason (conflict, failing CI, not mergeable). PAN-1620: the flywheel polls
 * this per tick and dispatches a rebase fix so a blocked PR does not sit forever
 * waiting on a webhook that may never fire — distinct from auto-merge *scheduling*
 * problems, which live in /auto-merge/problems.
 */
const MERGE_BLOCKER_TYPES = new Set(['merge_conflict', 'failing_checks', 'not_mergeable']);

export function getMergeBlockersPayload(): Array<{
  issueId: string;
  prUrl?: string;
  reasons: Array<{ type: string; summary: string }>;
}> {
  const statuses = getAllReviewStatusesFromDb();
  const out: Array<{ issueId: string; prUrl?: string; reasons: Array<{ type: string; summary: string }> }> = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (status.reviewStatus !== 'passed') continue;
    if (status.mergeStatus === 'merged') continue;
    const reasons = (status.blockerReasons ?? []).filter((b) => MERGE_BLOCKER_TYPES.has(b.type));
    if (reasons.length === 0) continue;
    out.push({ issueId, prUrl: status.prUrl, reasons: reasons.map((b) => ({ type: b.type, summary: b.summary })) });
  }
  return out;
}

const getMergeBlockersRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/merge-blockers',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(getMergeBlockersPayload());
  })),
);

interface MergeNextDeps {
  getOrderedIssueIds?: () => Promise<string[]>;
  merge?: (issueId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

async function defaultGetOrderedIssueIds(): Promise<string[]> {
  const status = await readCurrentFlywheelStatusForDashboard();
  if (!status) return [];
  const { computeMergeQueue } = await import('../../../lib/flywheel-merge-order.js');
  const queue = await Effect.runPromise(
    computeMergeQueue(status.activePipeline, process.cwd()).pipe(Effect.provide(nodeServicesLayer)),
  );
  return queue.map((i) => i.issueId);
}

async function defaultMergeOne(issueId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { triggerMerge } = await import('./workspaces/merge-ops.js');
  const r = await triggerMerge(issueId);
  return r.success ? { ok: true } : { ok: false, reason: r.error ?? r.message ?? 'merge failed' };
}

/**
 * PAN-1691 "merge next N" / "ship the UAT candidate": merge the first N issues
 * of the conflict-aware merge order, one at a time, stopping at the first
 * failure (the rest would need re-rebasing). Pure-ish + DI for testing.
 */
export async function postFlywheelMergeNextPayload(payload: unknown, deps: MergeNextDeps = {}) {
  const body = (payload ?? {}) as { n?: unknown };
  const n = typeof body.n === 'number' && Number.isFinite(body.n) ? Math.floor(body.n) : 0;
  if (n <= 0) return { status: 400, body: { error: 'n must be a positive integer' } };

  const issueIds = (await (deps.getOrderedIssueIds ?? defaultGetOrderedIssueIds)()).slice(0, n);
  const { shipMergeBatch } = await import('../../../lib/cloister/merge-batch.js');
  const outcomes = await shipMergeBatch(issueIds, { merge: deps.merge ?? defaultMergeOne });
  return { status: 200, body: { outcomes } };
}
const postAutoMergeScheduleRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/auto-merge/schedule',
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

const postFlywheelMergeNextRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/merge-next',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const result = yield* Effect.promise(() => postFlywheelMergeNextPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const deleteAutoMergeRoute = HttpRouter.add(
  'DELETE',
  '/api/flywheel/auto-merge/:id',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const result = deleteAutoMergePayload(params['id'] ?? '');
    return jsonResponse(result.body, { status: result.status });
  })),
);

const postFlywheelStatusRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error, details: [] }, { status: 400 });

    const result = yield* Effect.promise(() => postFlywheelStatusPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const postFlywheelStartRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    try {
      const result = yield* Effect.promise(() => postFlywheelStartPayload(parsed.body));
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelPauseRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/pause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelPausePayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelResumeRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/resume',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelResumePayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelAbortRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/abort',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelAbortPayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelReportRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/report',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelReportPayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelReportOpenRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/report/open',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    try {
      const result = yield* Effect.promise(() => postFlywheelReportOpenPayload(parsed.body));
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const getFlywheelBriefRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const hasPathOverride = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => false,
      onSome: (url) => url.searchParams.has('path'),
    }));
    if (hasPathOverride) return jsonResponse({ error: 'Flywheel brief path is server-controlled' }, { status: 400 });
    const resolved = resolveBriefAbsolutePath(process.cwd());
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      try {
        const containment = await assertExistingPathInsideRoot(process.cwd(), resolved.absolutePath);
        if (!containment.ok) return jsonResponse({ error: containment.error }, { status: 400 });
        const content = await readFile(resolved.absolutePath, 'utf8');
        return jsonResponse({ path: resolved.displayPath, content });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') {
          return jsonResponse({ error: 'Flywheel brief not found', path: resolved.displayPath }, { status: 404 });
        }
        throw error;
      }
    });
  })),
);

const postFlywheelBriefRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const parsed = yield* readJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const body = parsed.body;
    if (typeof body.content !== 'string') {
      return jsonResponse({ error: 'content must be a string' }, { status: 400 });
    }
    if (body.path !== undefined) {
      return jsonResponse({ error: 'Flywheel brief path is server-controlled' }, { status: 400 });
    }

    const bodyContent: string = body.content;

    const resolved = resolveBriefAbsolutePath(process.cwd());
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      await mkdir(dirname(resolved.absolutePath), { recursive: true });
      const containment = await assertWritePathInsideRoot(process.cwd(), resolved.absolutePath);
      if (!containment.ok) return jsonResponse({ error: containment.error }, { status: 400 });
      await writeFile(resolved.absolutePath, bodyContent, 'utf8');
      return jsonResponse({ ok: true, path: resolved.displayPath });
    });
  })),
);

const getFlywheelMergeQueueRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/merge-queue',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      const status = await readCurrentFlywheelStatusForDashboard();
      if (!status) return jsonResponse([]);
      const { computeMergeQueue, resolveMergeQueuePrUrl } = await import('../../../lib/flywheel-merge-order.js');
      const queue = await Effect.runPromise(
        computeMergeQueue(status.activePipeline, process.cwd(), { getPrUrl: resolveMergeQueuePrUrl }).pipe(
          Effect.provide(nodeServicesLayer),
        ),
      );
      return jsonResponse(queue);
    });
  })),
);

/**
 * PAN-1737 UAT batch trains. Generation names contain a slash
 * (`uat/pan-otter-0610`); URL params carry the name WITHOUT the `uat/`
 * prefix and handlers reconstitute it.
 */
function uatGenerationNameFromParam(param: string): string {
  const decoded = decodeURIComponent(param);
  return decoded.startsWith('uat/') ? decoded : `uat/${decoded}`;
}

const getUatGenerationsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/uat-generations',
  httpHandler(Effect.gen(function* () {
    const { getUatGenerationsPayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const payload = yield* Effect.promise(() => getUatGenerationsPayload());
    return jsonResponse(payload);
  })),
);

const getUatCandidateRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/uat-candidate',
  httpHandler(Effect.gen(function* () {
    const { getUatCandidatePayload } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const payload = yield* Effect.promise(() => getUatCandidatePayload());
    return jsonResponse(payload);
  })),
);

const postUatGenerationStackRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/uat-generations/:name/stack',
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

const postUatGenerationPromoteRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/uat-generations/:name/promote',
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

/**
 * PAN-1737: repurposed from the PAN-1691 one-shot candidate assembly. Now a
 * FORCED reconcile — rebuild the current generation even when the chain
 * already answers the ready set (operator suspects staleness).
 */
const postFlywheelAssembleUatRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/assemble-uat',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const { runUatTrainReconcile } = yield* Effect.promise(() => import('../services/uat-train.js'));
    const result = yield* Effect.promise(() => runUatTrainReconcile({ force: true }));
    return jsonResponse(result);
  })),
);

const getFlywheelStateRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/state',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => jsonResponse(await readFlywheelState()));
  })),
);

export const flywheelRouteLayer = Layer.mergeAll(
  getFlywheelRunsRoute,
  getFlywheelRunRoute,
  getFlywheelConversationRoute,
  getFlywheelCurrentRoute,
  getFlywheelStatsRoute,
  getFlywheelConfigRoute,
  postFlywheelConfigRoute,
  getPendingAutoMergeRoute,
  getAutoMergeProblemsRoute,
  getMergeBlockersRoute,
  getMergeBackendRoute,
  postAutoMergeScheduleRoute,
  postFlywheelMergeNextRoute,
  deleteAutoMergeRoute,
  getFlywheelMergeQueueRoute,
  getUatGenerationsRoute,
  getUatCandidateRoute,
  postUatGenerationStackRoute,
  postUatGenerationPromoteRoute,
  postFlywheelAssembleUatRoute,
  getFlywheelStateRoute,
  postFlywheelStatusRoute,
  postFlywheelStartRoute,
  postFlywheelPauseRoute,
  postFlywheelResumeRoute,
  postFlywheelAbortRoute,
  postFlywheelReportRoute,
  postFlywheelReportOpenRoute,
  getFlywheelBriefRoute,
  postFlywheelBriefRoute,
);

export default flywheelRouteLayer;
