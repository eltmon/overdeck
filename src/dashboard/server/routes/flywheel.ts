/**
 * `/api/flywheel/*` (PAN-3964 FR-7) — the Flywheel page's HTTP surface.
 *
 * Every GET is a derived read: the status comes from `deriveFlywheelStatus()`
 * (the same function `pan flywheel status` prints), the state and report are
 * the loop's own `.pan/flywheel/*.md` files, and the stats are computed from
 * the tracker and the forge. Every POST is a thin wrapper over the same
 * `src/lib/flywheel/actions.ts` functions the CLI verbs call. There is no
 * `POST /api/flywheel/status`: the loop reports through its transcript's tick
 * markers, not through an endpoint (D3).
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  abortFlywheel,
  pauseFlywheel,
  requestFlywheelReport,
  resumeFlywheel,
  startFlywheel,
  stopFlywheel,
  type FlywheelStartOptions,
} from '../../../lib/flywheel/actions.js';
import {
  deriveFlywheelStatus,
  readFlywheelRun,
  resolveFlywheelProjectRoot,
  type DeriveFlywheelStatusDeps,
} from '../../../lib/flywheel/derive-status.js';
import {
  FlywheelAlreadyRunning,
  FlywheelNotRunning,
  FlywheelOrphanSession,
  FlywheelPausedExists,
} from '../../../lib/flywheel/errors.js';
import { FLYWHEEL_CONVERSATION_SESSION } from '../../../lib/flywheel/constants.js';
import { readFlywheelReportFile, readFlywheelStateFile } from '../../../lib/flywheel/files.js';
import { deriveFlywheelHealth, type FlywheelHealthResult } from '../../../lib/flywheel/health.js';
import { computeSubstrateStats } from '../../../lib/flywheel/substrate-stats.js';
import { conversationStoppedSince } from '../../../lib/overdeck/conversation-stop-marks.js';
import type { TrackerIssueFacts } from '../../../lib/overdeck/derived-issue-state.js';
import { jsonResponse } from '../http-helpers.js';
import { getBackendPanes } from '../services/backend-inventory.js';
import { loadIssueStatesForProject } from '../services/derived-issue-state.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { hasDashboardInternalToken, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

export interface RouteResult {
  status: number;
  body: unknown;
}

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  if (hasDashboardInternalToken(request)) return null;
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  return rejectUnsafeDashboardMutationRequest(request);
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ok: true as const, body: parsed as Record<string, unknown> }
      : { ok: false as const, error: 'Request body must be a JSON object' };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

/** Typed flywheel errors → 409/404; anything else → 500 with its message. */
export function flywheelErrorResult(error: unknown): RouteResult {
  if (error instanceof FlywheelAlreadyRunning || error instanceof FlywheelPausedExists || error instanceof FlywheelOrphanSession) {
    return { status: 409, body: { error: error.message, code: error._tag } };
  }
  if (error instanceof FlywheelNotRunning) return { status: 404, body: { error: error.message, code: error._tag } };
  const message = error instanceof Error ? error.message : String(error);
  console.error('[flywheel] action failed:', message);
  return { status: 500, body: { error: message || 'Internal server error' } };
}

async function guarded(action: () => Promise<unknown>): Promise<RouteResult> {
  try {
    return { status: 200, body: (await action()) ?? { success: true } };
  } catch (error) {
    return flywheelErrorResult(error);
  }
}

// ─── payloads (exported for tests) ───────────────────────────────────────────

/**
 * The server's reads for the deriver: the tracker row comes from the shared
 * `IssueDataService` cache and the derived states from the server adapter, so
 * a status poll re-reads neither the tracker nor the forge. Without them the
 * deriver falls back to its own per-issue tracker reads (PAN-4199 FR-4).
 */
export function serverFlywheelStatusDeps(): DeriveFlywheelStatusDeps {
  return {
    readTrackerIssues: async (issueIds) => Object.fromEntries(issueIds.map((raw) => {
      const issueId = raw.toUpperCase();
      let facts: TrackerIssueFacts | null = null;
      try {
        facts = getSharedIssueService().getTrackerIssue(issueId);
      } catch {
        // No issue service in this process — unknown, never a silent "open".
      }
      return [issueId, facts];
    })),
    listPanes: () => getBackendPanes(),
    loadStates: (projectPath, issueIds, opts) =>
      loadIssueStatesForProject(projectPath, issueIds, { issues: opts.issues, panes: opts.panes }),
  };
}

/** The health strip and shipped-today read the route merges into the status (PAN-5283 D7). */
export type FlywheelHealthReader = (projectRoot: string) => Promise<FlywheelHealthResult>;

/** Server health read: titles come from the shared issue cache, never a tracker call. */
export function readServerFlywheelHealth(projectRoot: string): Promise<FlywheelHealthResult> {
  return deriveFlywheelHealth({
    projectRoot,
    deps: {
      trackerTitle: (issueId) => {
        try {
          return getSharedIssueService().getTrackerIssue(issueId.toUpperCase())?.title ?? null;
        } catch {
          return null;
        }
      },
    },
  });
}

const loggedHealthFailures = new Set<string>();

export function getFlywheelStatusPayload(
  deps: DeriveFlywheelStatusDeps = serverFlywheelStatusDeps(),
  readHealth: FlywheelHealthReader = readServerFlywheelHealth,
): Promise<RouteResult> {
  return guarded(async () => {
    const status = await deriveFlywheelStatus({ deps });
    if (typeof status?.projectRoot !== 'string') return status;
    try {
      const { health, shipped } = await readHealth(status.projectRoot);
      return { ...status, health, shipped };
    } catch (error) {
      // The status stands without the strip; say why once, not every 5 s poll.
      const message = error instanceof Error ? error.message : String(error);
      if (!loggedHealthFailures.has(message)) {
        loggedHealthFailures.add(message);
        console.warn('[flywheel] health strip unavailable:', message);
      }
      return status;
    }
  });
}

export function getFlywheelStatePayload(): Promise<RouteResult> {
  return guarded(async () => readFlywheelStateFile((await resolveFlywheelProjectRoot()).planHome));
}

export function getFlywheelReportPayload(): Promise<RouteResult> {
  return guarded(async () => readFlywheelReportFile((await resolveFlywheelProjectRoot()).planHome));
}

export async function getFlywheelStatsPayload(windowParam: string | null): Promise<RouteResult> {
  const windowDays = windowParam === null || windowParam === '' ? undefined : Number(windowParam);
  if (windowDays !== undefined && (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 365)) {
    return { status: 400, body: { error: 'window must be a whole number of days between 1 and 365' } };
  }
  return guarded(async () => computeSubstrateStats({
    projectPath: (await resolveFlywheelProjectRoot()).projectRoot,
    ...(windowDays !== undefined ? { windowDays } : {}),
  }));
}

export function parseStartBody(body: Record<string, unknown>): { ok: true; options: FlywheelStartOptions } | { ok: false; error: string } {
  const options: FlywheelStartOptions = {};
  for (const key of ['model', 'harness', 'orders'] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `${key} must be a non-empty string` };
    options[key] = value.trim();
  }
  if (body['fresh'] !== undefined) {
    if (typeof body['fresh'] !== 'boolean') return { ok: false, error: 'fresh must be a boolean' };
    options.fresh = body['fresh'];
  }
  return { ok: true, options };
}

export async function postFlywheelStartPayload(body: Record<string, unknown>): Promise<RouteResult> {
  const parsed = parseStartBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  return guarded(() => startFlywheel(parsed.options));
}

/**
 * `unlessStoppedSince` (epoch ms, PAN-5667) is the deacon's reboot resume: it
 * asks this route to refuse when the conversation was stopped on purpose at or
 * after that time. The stop marks live only in this process
 * (`conversation-stop-marks.ts`), which is why the deacon child asks here.
 */
export async function postFlywheelResumePayload(
  body: Record<string, unknown>,
  stoppedSince: (name: string, sinceMs: number) => boolean = conversationStoppedSince,
): Promise<RouteResult> {
  const since = body['unlessStoppedSince'];
  if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since))) {
    return { status: 400, body: { error: 'unlessStoppedSince must be a number' } };
  }
  if (typeof since === 'number' && stoppedSince(FLYWHEEL_CONVERSATION_SESSION, since)) {
    return {
      status: 409,
      body: { error: 'The flywheel was stopped on purpose after that time', code: 'FlywheelStoppedOnPurpose' },
    };
  }
  return guarded(() => resumeFlywheel());
}

/**
 * Graceful stop waits up to two minutes for the loop's report. The route
 * checks the flywheel is running, starts the stop, and answers 202; the page
 * sees the run flip to `paused` on its next status poll.
 */
export async function postFlywheelStopPayload(body: Record<string, unknown>): Promise<RouteResult> {
  const timeoutMs = body['timeoutMs'];
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    return { status: 400, body: { error: 'timeoutMs must be a non-negative number' } };
  }
  const { run } = await readFlywheelRun();
  if (run !== 'running') return flywheelErrorResult(new FlywheelNotRunning());
  void stopFlywheel(typeof timeoutMs === 'number' ? { timeoutMs } : {}).catch((error: unknown) => {
    console.error('[flywheel] stop failed:', error instanceof Error ? error.message : String(error));
  });
  return { status: 202, body: { stopping: true } };
}

// ─── routes ──────────────────────────────────────────────────────────────────

function respond(result: RouteResult) {
  return jsonResponse(result.body, { status: result.status });
}

const getFlywheelStatusRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/status',
  httpHandler(Effect.gen(function* () {
    return respond(yield* Effect.promise(() => getFlywheelStatusPayload()));
  })),
);

const getFlywheelStateRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/state',
  httpHandler(Effect.gen(function* () {
    return respond(yield* Effect.promise(() => getFlywheelStatePayload()));
  })),
);

const getFlywheelReportRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/report',
  httpHandler(Effect.gen(function* () {
    return respond(yield* Effect.promise(() => getFlywheelReportPayload()));
  })),
);

const getFlywheelStatsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/stats',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const windowParam = new URL(request.url, 'http://localhost').searchParams.get('window');
    return respond(yield* Effect.promise(() => getFlywheelStatsPayload(windowParam)));
  })),
);

function mutation(run: (body: Record<string, unknown>) => Promise<RouteResult>) {
  return httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const parsed = yield* readJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    return respond(yield* Effect.promise(() => run(parsed.body)));
  }));
}

const postFlywheelStartRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/start',
  mutation((body) => postFlywheelStartPayload(body)),
);

const postFlywheelPauseRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/pause',
  mutation(() => guarded(() => pauseFlywheel())),
);

const postFlywheelResumeRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/resume',
  mutation((body) => postFlywheelResumePayload(body)),
);

const postFlywheelStopRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/stop',
  mutation((body) => postFlywheelStopPayload(body)),
);

const postFlywheelAbortRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/abort',
  mutation(() => guarded(() => abortFlywheel())),
);

const postFlywheelReportRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/report',
  mutation(() => guarded(() => requestFlywheelReport())),
);

export const flywheelRouteLayer = Layer.mergeAll(
  getFlywheelStatusRoute,
  getFlywheelStateRoute,
  getFlywheelReportRoute,
  getFlywheelStatsRoute,
  postFlywheelStartRoute,
  postFlywheelPauseRoute,
  postFlywheelResumeRoute,
  postFlywheelStopRoute,
  postFlywheelAbortRoute,
  postFlywheelReportRoute,
);

export default flywheelRouteLayer;
