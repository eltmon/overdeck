import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Effect, Layer, Option, Schema } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { FlywheelRunId, FlywheelStatus } from '@panctl/contracts';
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
import { hasDashboardInternalToken, rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
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
import {
  isFlywheelAutoPickupBacklog,
  isFlywheelGloballyPaused,
  isFlywheelRequireUatBeforeMerge,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
} from '../../../lib/database/app-settings.js';
import { AUTO_MERGE_COOLDOWN_MS } from '../../../lib/cloister/auto-merge-config.js';
import { isAutoMergeEligible, type AutoMergeEligibility } from '../../../lib/cloister/auto-merge-eligibility.js';
import { getReviewStatusSync, type ReviewStatus } from '../../../lib/review-status.js';
import { resolveProjectFromIssueSync, type ResolvedProject } from '../../../lib/projects.js';
import {
  cancelPending,
  getPendingAutoMerge,
  listPendingAutoMerges,
  scheduleAutoMergeWithResult,
  type PendingAutoMerge,
  type ScheduleAutoMergeInput,
  type ScheduleAutoMergeResult,
} from '../../../lib/database/pending-auto-merges-db.js';

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';
const FLYWHEEL_CONVERSATION_NAME = 'flywheel-orchestrator';

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
}

interface FlywheelConfigResponseBody {
  auto_pickup_backlog: boolean;
  require_uat_before_merge: boolean;
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

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
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

  if (body.auto_pickup_backlog !== undefined) setFlywheelAutoPickupBacklog(body.auto_pickup_backlog);
  if (body.require_uat_before_merge !== undefined) setFlywheelRequireUatBeforeMerge(body.require_uat_before_merge);

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
}

interface AutoMergeCancelDeps {
  now?: () => Date;
  getPending?: (issueId: string) => PendingAutoMerge | null;
  cancel?: (id: number, cancelledBy: string) => boolean;
  announce?: (issueId: string) => void;
}

function parsePrNumber(prUrl: string | undefined): number | undefined {
  const match = prUrl?.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number.parseInt(match[1], 10) : undefined;
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

  if ((deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)()) {
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

  const reviewStatus = (deps.getReviewStatus ?? getReviewStatusSync)(issueId);
  if (!reviewStatus?.prUrl) {
    return { status: 422, body: { error: 'review status PR URL is missing or invalid' } };
  }
  const prNumber = parsePrNumber(reviewStatus.prUrl);
  if (prNumber === undefined) {
    return { status: 422, body: { error: 'review status PR URL is missing or invalid' } };
  }

  const project = (deps.resolveProject ?? resolveProjectFromIssueSync)(issueId);
  if (!project) return { status: 422, body: { error: `Unknown project for issue ${issueId}` } };

  const scheduledAt = (deps.now ?? (() => new Date()))();
  const scheduledMergeAt = new Date(scheduledAt.getTime() + AUTO_MERGE_COOLDOWN_MS);
  const result = (deps.schedule ?? scheduleAutoMergeWithResult)({
    issueId,
    prUrl: reviewStatus.prUrl,
    prNumber,
    projectKey: project.projectKey,
    scheduledMergeAt: scheduledMergeAt.toISOString(),
    scheduledAt: scheduledAt.toISOString(),
  });
  if (result.created) (deps.announce ?? announceAutoMergeScheduled)(issueId, result.entry);
  return { status: 200, body: result.entry };
}

export function getPendingAutoMergePayload(): PendingAutoMerge[] {
  return listPendingAutoMerges()
    .filter((entry) => entry.status === 'pending' || entry.status === 'merging')
    .sort((a, b) => a.scheduledMergeAt.localeCompare(b.scheduledMergeAt) || a.id - b.id);
}

export function deleteAutoMergePayload(issueIdParam: string, deps: AutoMergeCancelDeps = {}) {
  const issueId = issueIdParam.trim().toUpperCase();
  if (!issueId) return { status: 400, body: { error: 'issueId must be a non-empty string' } };

  const entry = (deps.getPending ?? getPendingAutoMerge)(issueId);
  if (!entry) return { status: 404, body: { error: `No pending auto-merge for ${issueId}` } };
  if (entry.status === 'merging') {
    return { status: 409, body: { error: `Auto-merge cooldown has expired for ${issueId}; merge is in progress` } };
  }

  const cancelledAt = (deps.now ?? (() => new Date()))().toISOString();
  const cancelled = (deps.cancel ?? cancelPending)(entry.id, 'operator');
  if (!cancelled) {
    const raced = (deps.getPending ?? getPendingAutoMerge)(issueId);
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
      const { computeMergeQueue } = await import('../../../lib/flywheel-merge-order.js');
      const queue = await Effect.runPromise(
        computeMergeQueue(status.activePipeline, process.cwd()).pipe(
          Effect.provide(nodeServicesLayer),
        ),
      );
      return jsonResponse(queue);
    });
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
  getFlywheelConfigRoute,
  postFlywheelConfigRoute,
  getPendingAutoMergeRoute,
  postAutoMergeScheduleRoute,
  deleteAutoMergeRoute,
  getFlywheelMergeQueueRoute,
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
