/**
 * Lane work doors (.pan/drafts/PAN-4638.md WI-3, FR-3, FR-11, D-4638-12): the
 * owner routes through which a linked machine (home) runs a gauntlet lane here.
 *
 * Every door takes exactly a `machine` credential (403 `machine-only`).
 *
 * - `POST /api/machines/work/lanes` with an `OwnerLaneSpec` plus `gitOrigin`
 *   → `workDoorPreflight` by git origin alone, so the lane runs in this
 *   machine's own project for that repository (home's project key is never
 *   used) → `launchOwnedLane`, stamping the caller's environment id. 201
 *   `OwnerLaneResult`; a `LaneLaunchError` answers its status with `{ error, code? }`.
 * - `GET /api/machines/work/lanes/:name/status?after=<seq>` → the lane's
 *   activity, git facts, cost, spawn error, at most 20 reports after `seq`
 *   (oldest first) and, while it is stopped or idle, its last assistant message.
 * - `POST /api/machines/work/lanes/:name/reap { park?, keep? }` → `reapLane`,
 *   answering as `POST /api/lanes/:name/reap` does.
 *
 * Status and reap answer 404 `unknown-lane` unless the lane was started here by
 * the caller's environment (`started_by_environment_id`), so one machine
 * never reads or reaps another machine's lanes.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import type { LaneActivity } from '@overdeck/contracts';

import { listWorkerReports, type WorkerReport } from '../../../lib/agents/worker/report.js';
import type { LaneAnswering } from '../../../lib/lanes/contract.js';
import { launchOwnedLane, type OwnerLaneContext, type OwnerLaneResult, type OwnerLaneSpec } from '../../../lib/lanes/owner-launch.js';
import { LaneReapError, reapLane, type LaneReapOptions, type LaneReapResult } from '../../../lib/lanes/reap.js';
import { LaneLaunchError, type LaneGitFacts } from '../../../lib/lanes/types.js';
import { invalidateLaneViews, listLaneViews, type LaneView } from '../../../lib/lanes/views.js';
import { conversationStartedBy } from '../../../lib/overdeck/conversation-provenance.js';
import { getConversationMessagesRead } from '../../../lib/overdeck/conversation-reads.js';
import { getConversationByName, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../http-helpers.js';
import { conversationArchiveDependencies, conversationReadDependencies } from './conversations.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { defaultWorkDoorDeps, machineOnly, readWorkDoorBody, workDoorPreflight, type WorkDoorDeps } from './machines-work.js';
import { validateOrigin } from './origin-validation.js';

/** Reports per status answer; the follower asks again with the last `seq` it mirrored (NFR-5). */
export const LANE_STATUS_REPORT_LIMIT = 20;

export interface LaneStatusBody {
  activity: LaneActivity;
  lastActivityAt: string | null;
  archived: boolean;
  git: LaneGitFacts | null;
  costUsd: number | null;
  cwd: string;
  spawnError: string | null;
  reports: WorkerReport[];
  lastAssistantMessage: string | null;
}

export interface LaneDoorDeps extends WorkDoorDeps {
  launch: (spec: OwnerLaneSpec, context: OwnerLaneContext) => Promise<OwnerLaneResult>;
  laneRow: (name: string) => LegacyConversation | null;
  startedBy: (name: string) => string | null;
  laneView: (row: LegacyConversation) => Promise<LaneView | null>;
  listReports: (id: string) => Promise<WorkerReport[]>;
  lastAssistantMessage: (name: string) => Promise<string | null>;
  reap: (name: string, options: LaneReapOptions) => Promise<LaneReapResult>;
}

/** The newest assistant text of a conversation, from the reader behind `GET /api/conversations/:name/messages`. */
async function lastAssistantMessageOf(name: string): Promise<string | null> {
  const result = await getConversationMessagesRead(name, conversationReadDependencies);
  const messages = (result.body as { messages?: Array<{ role?: string; text?: unknown }> } | null)?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && typeof message.text === 'string' && message.text.trim()) return message.text;
  }
  return null;
}

export const defaultLaneDoorDeps: LaneDoorDeps = {
  ...defaultWorkDoorDeps,
  launch: (spec, context) => launchOwnedLane(spec, context),
  laneRow: getConversationByName,
  startedBy: conversationStartedBy,
  laneView: async (row) => {
    if (!row.gauntletRun || !row.laneKey || !row.laneRole) return null;
    const views = await listLaneViews({ run: row.gauntletRun, key: row.laneKey, role: row.laneRole });
    return views.find((view) => view.name === row.name) ?? null;
  },
  listReports: listWorkerReports,
  lastAssistantMessage: lastAssistantMessageOf,
  reap: (name, options) => reapLane(name, options, { archive: conversationArchiveDependencies }),
};

const badRequest = (error: string): HttpServerResponse.HttpServerResponse => jsonResponse({ error }, { status: 400 });
const unknownLane = (): HttpServerResponse.HttpServerResponse => jsonResponse({ code: 'unknown-lane', error: 'no such lane started by your machine' }, { status: 404 });

function isAnswering(value: unknown): value is LaneAnswering {
  const answering = value as Partial<LaneAnswering> | null;
  return !!answering && typeof answering === 'object'
    && (answering.criticId === null || typeof answering.criticId === 'number') && typeof answering.criticName === 'string'
    && (answering.role === 'critic' || answering.role === 'verifier')
    && typeof answering.iteration === 'number' && typeof answering.verdict === 'string'
    && (answering.file === null || typeof answering.file === 'string');
}

const STRING_FIELDS = ['name', 'run', 'key', 'role', 'brief', 'briefHeader', 'title', 'model', 'harness'] as const;
const NULLABLE_STRING_FIELDS = ['effort', 'branch', 'base', 'at', 'reuseCwd'] as const;

/** Type-check a launch body; `launchOwnedLane` validates the values. */
export function parseOwnerLaneBody(raw: unknown): { ok: true; spec: OwnerLaneSpec; gitOrigin: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object' };
  const body = raw as Record<string, unknown>;
  const gitOrigin = body['gitOrigin'];
  if (typeof gitOrigin !== 'string' || gitOrigin.trim() === '') return { ok: false, error: 'gitOrigin is required' };
  for (const field of STRING_FIELDS) if (typeof body[field] !== 'string') return { ok: false, error: `${field} must be a string` };
  for (const field of NULLABLE_STRING_FIELDS) {
    if (body[field] !== null && body[field] !== undefined && typeof body[field] !== 'string') return { ok: false, error: `${field} must be a string or null` };
  }
  if (typeof body['iteration'] !== 'number') return { ok: false, error: 'iteration must be a number' };
  if (body['force'] !== undefined && typeof body['force'] !== 'boolean') return { ok: false, error: 'force must be a boolean' };
  const answering = body['answering'] ?? null;
  if (answering !== null && !isAnswering(answering)) return { ok: false, error: 'answering is malformed' };
  const nullable = (field: (typeof NULLABLE_STRING_FIELDS)[number]): string | null => (typeof body[field] === 'string' ? body[field] : null);
  return {
    ok: true,
    gitOrigin: gitOrigin.trim(),
    spec: {
      name: body['name'] as string,
      run: body['run'] as string,
      key: body['key'] as string,
      role: body['role'] as OwnerLaneSpec['role'],
      iteration: body['iteration'],
      brief: body['brief'] as string,
      briefHeader: body['briefHeader'] as string,
      title: body['title'] as string,
      model: body['model'] as string,
      harness: body['harness'] as string,
      effort: nullable('effort'),
      branch: nullable('branch'),
      base: nullable('base'),
      at: nullable('at'),
      reuseCwd: nullable('reuseCwd'),
      answering,
      force: body['force'] === true,
    },
  };
}

function laneErrorResponse(error: unknown, context: string): HttpServerResponse.HttpServerResponse {
  if (error instanceof LaneLaunchError) {
    return jsonResponse({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  }
  if (error instanceof LaneReapError) return jsonResponse({ error: error.message }, { status: error.status });
  console.error(`[lanes] owner ${context} failed:`, error instanceof Error ? error.message : String(error));
  return jsonResponse({ error: 'Internal server error' }, { status: 500 });
}

/** `POST /api/machines/work/lanes`. */
export async function handleWorkLaneLaunch(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: LaneDoorDeps = defaultLaneDoorDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const parsed = parseOwnerLaneBody(raw);
  if (!parsed.ok) return badRequest(parsed.error);
  // By origin alone: this machine may hold the repository under another project key.
  const preflight = await workDoorPreflight(credential, { gitOrigin: parsed.gitOrigin }, deps);
  if (!preflight.ok) return preflight.response;
  if (!preflight.projectKey) return badRequest('gitOrigin names no project');
  try {
    const result = await deps.launch(parsed.spec, { projectKey: preflight.projectKey, startedBy: credential.environmentId });
    return jsonResponse(result, { status: 201 });
  } catch (error: unknown) {
    return laneErrorResponse(error, 'launch');
  }
}

/** The lane row the caller's environment started here; null otherwise. */
function ownLaneRow(credential: Extract<DashboardCredential, { kind: 'machine' }>, name: string, deps: LaneDoorDeps): LegacyConversation | null {
  const row = deps.laneRow(name);
  if (!row?.laneKey || !row.gauntletRun || !row.laneRole) return null;
  return deps.startedBy(name) === credential.environmentId ? row : null;
}

/** `GET /api/machines/work/lanes/:name/status?after=<seq>`. */
export async function handleWorkLaneStatus(
  credential: DashboardCredential | null,
  name: string,
  after: number,
  deps: LaneDoorDeps = defaultLaneDoorDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const row = ownLaneRow(credential, name, deps);
  if (!row) return unknownLane();
  try {
    const view = await deps.laneView(row);
    if (!view) return unknownLane();
    // Reports are read after the view: a lane that reported just before it stopped is never missed.
    const reports = (await deps.listReports(`conv-${name}`))
      .filter((report) => report.seq > after)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, LANE_STATUS_REPORT_LIMIT);
    const quiet = view.activity === 'stopped' || view.activity === 'idle';
    const body: LaneStatusBody = {
      activity: view.activity,
      lastActivityAt: view.lastActivityAt,
      archived: view.archived,
      git: view.git,
      costUsd: view.costUsd,
      cwd: view.cwd,
      spawnError: row.spawnError,
      reports,
      lastAssistantMessage: quiet ? await deps.lastAssistantMessage(name).catch(() => null) : null,
    };
    return jsonResponse(body);
  } catch (error: unknown) {
    return laneErrorResponse(error, 'status');
  }
}

/** `POST /api/machines/work/lanes/:name/reap`. */
export async function handleWorkLaneReap(
  credential: DashboardCredential | null,
  name: string,
  raw: unknown,
  deps: LaneDoorDeps = defaultLaneDoorDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const body = raw ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) return badRequest('body must be a JSON object');
  const options = body as Record<string, unknown>;
  for (const field of ['park', 'keep'] as const) {
    if (options[field] !== undefined && typeof options[field] !== 'boolean') return badRequest(`${field} must be a boolean`);
  }
  if (!ownLaneRow(credential, name, deps)) return unknownLane();
  try {
    const result = await deps.reap(name, { park: options['park'] === true, keep: options['keep'] === true });
    invalidateLaneViews();
    return jsonResponse(result);
  } catch (error: unknown) {
    return laneErrorResponse(error, 'reap');
  }
}

const originRefusal = (request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null => {
  const check = validateOrigin(request);
  return check.ok ? null : jsonResponse({ error: check.error }, { status: 403 });
};

const workLaneLaunchRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/lanes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = originRefusal(request);
    if (refused) return refused;
    const body = yield* readWorkDoorBody;
    return yield* Effect.promise(() => handleWorkLaneLaunch(resolveRequestCredential(request), body));
  }),
);

const workLaneStatusRoute = HttpRouter.add(
  'GET',
  '/api/machines/work/lanes/:name/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = originRefusal(request);
    if (refused) return refused;
    const name = (yield* HttpRouter.params)['name'] ?? '';
    const after = Number(new URL(request.url, 'http://localhost').searchParams.get('after') ?? '0');
    return yield* Effect.promise(() => handleWorkLaneStatus(resolveRequestCredential(request), name, Number.isFinite(after) ? after : 0));
  }),
);

const workLaneReapRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/lanes/:name/reap',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = originRefusal(request);
    if (refused) return refused;
    const name = (yield* HttpRouter.params)['name'] ?? '';
    const body = yield* readWorkDoorBody;
    return yield* Effect.promise(() => handleWorkLaneReap(resolveRequestCredential(request), name, body));
  }),
);

export const machinesWorkLanesRouteLayer = Layer.mergeAll(workLaneLaunchRoute, workLaneStatusRoute, workLaneReapRoute);
