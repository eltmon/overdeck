/**
 * Self lane routes (PAN-4938, PAN-4927 W-DEL1, D-11, D-12): a conversation
 * launches gauntlet lanes under itself.
 *
 * - `POST /api/self/lanes { role, brief, key?, for?, run?, project?, model?, harness?, effort?, title?, branch?, from?, at?, machine?, needs?, reuse?, replace? }`
 *   (`operate`, D-11) → `lanes.handleLaneLaunch` with `parent` = the calling
 *   conversation. Any `parent` and `force` in the body are dropped. An
 *   agent-kind caller gets 409 `not-a-conversation`: a lane's parent must be a
 *   conversation, and an agent delegates with `delegate_task`.
 * - `POST /api/self/lanes/wait { run?, after?, timeoutMs? }` (`read:state`,
 *   D-12) → `lanes/wait.waitForLaneSet` in process over `listLaneViews`, for
 *   at most 50 s: the next report of any lane of `run`, or else of any lane
 *   the calling conversation launched. Answers `done` with the lane, report
 *   and cursor, or `running`; both carry `next` (pass the cursor as `after`)
 *   and `warnings` (one line per stopped lane that never reported). An
 *   agent-kind caller without `run` gets 409 `not-a-conversation`; a malformed
 *   cursor is 400 `bad-cursor`. A cancelled request keeps polling until its
 *   deadline: `waitForLaneSet` takes no signal (bounded by 50 s).
 * - `POST /api/self/lanes/report { report, status?, verdict?, defects? }`
 *   (`tell`, D-12) → the existing `lane-report` self job, `pan lane report
 *   --status=<s> --stdin [--verdict=<v>] [--defects=<n>]` with the report on
 *   stdin, waited on for up to 50 s; answers `selfJobAnswer` (a job still
 *   running names `wait_job` as `next`). Only a lane conversation may report:
 *   any other caller gets 409 `not-a-lane`.
 *
 * Auth: the route-scope table judges the scope; the handler then requires an
 * agent token (`self-caller.ts`), so every other credential gets 403
 * `not-an-agent-token` and a token whose conversation is gone gets 404
 * `agent-gone`. The parent comes from the token only.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { isLaneVerdict, isWorkerReportStatus, MAX_WORKER_REPORT_BYTES } from '../../../lib/agents/worker/report.js';
import { waitForLaneSet } from '../../../lib/lanes/wait.js';
import { listLaneViews, type LaneView, type LaneViewFilter } from '../../../lib/lanes/views.js';
import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import type { SelfJobArg } from '../services/self-job-argv.js';
import { selfJobAnswer, selfJobs, type SelfJobs } from '../services/self-jobs.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { fleetCaller } from './fleet-work.js';
import { httpHandler } from './http-handler.js';
import { handleLaneLaunch, parseLaneLaunchBody } from './lanes.js';
import { readJsonResponse } from './machines-work.js';
import { validateOrigin } from './origin-validation.js';
import type { SelfRouteResult } from './self-jobs.js';

export const NOT_A_CONVERSATION = {
  code: 'not-a-conversation',
  error: 'lane_start needs a launching conversation; an agent delegates with delegate_task',
} as const;

export interface SelfLaneStartDeps {
  caller?: SelfCallerDeps;
  launch?: typeof handleLaneLaunch;
}

/** `POST /api/self/lanes`. */
export async function handleSelfLaneStart(
  credential: DashboardCredential | null,
  raw: unknown,
  viaChannel: boolean,
  deps: SelfLaneStartDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;
  if (caller.agentKind !== 'conversation') return { status: 409, body: NOT_A_CONVERSATION };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { status: 400, body: { error: 'body must be a JSON object' } };
  const { parent: _parent, force: _force, ...rest } = raw as Record<string, unknown>;
  const parsed = parseLaneLaunchBody({ ...rest, parent: caller.agentId });
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  // A token credential always yields a fleet caller.
  return readJsonResponse(await (deps.launch ?? handleLaneLaunch)(parsed.request, { viaChannel, caller: fleetCaller(credential, undefined)! }));
}

const BAD_TIMEOUT = { code: 'bad-timeout', error: `timeoutMs must be an integer from 1 to ${WAIT_CHUNK_MS}` } as const;
const NO_LANE_SET = { code: 'not-a-conversation', error: 'lane_wait needs run, or a launching conversation' } as const;

export interface SelfLaneWaitDeps {
  caller?: SelfCallerDeps;
  waitSet?: typeof waitForLaneSet;
  listLanes?: (filter: LaneViewFilter) => Promise<LaneView[]>;
}

/** `POST /api/self/lanes/wait`. */
export async function handleSelfLaneWait(credential: DashboardCredential | null, raw: unknown, deps: SelfLaneWaitDeps = {}): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { status: 400, body: { error: 'body must be a JSON object' } };
  const input = raw as Record<string, unknown>;
  for (const field of ['run', 'after'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'string') return { status: 400, body: { error: `${field} must be a string` } };
  }
  const run = (input['run'] as string | undefined) || undefined;
  const after = (input['after'] as string | undefined) || undefined;
  const rawTimeout = input['timeoutMs'];
  if (rawTimeout !== undefined && (typeof rawTimeout !== 'number' || !Number.isInteger(rawTimeout) || rawTimeout < 1 || rawTimeout > WAIT_CHUNK_MS)) {
    return { status: 400, body: BAD_TIMEOUT };
  }
  const timeoutMs = (rawTimeout as number | undefined) ?? WAIT_CHUNK_MS;
  let filter: { run?: string; parent?: string };
  if (run) filter = { run };
  else if (caller.agentKind === 'conversation') filter = { parent: caller.agentId };
  else return { status: 409, body: NO_LANE_SET };

  const warnings: string[] = [];
  const listLanes = deps.listLanes ?? listLaneViews;
  let outcome: Awaited<ReturnType<typeof waitForLaneSet>>;
  try {
    outcome = await (deps.waitSet ?? waitForLaneSet)(filter, { after, timeoutMs }, {
      listLanes: (f) => listLanes({ ...(f.run ? { run: f.run } : {}), ...(f.parent ? { parentName: f.parent } : {}) }),
      warn: (line) => warnings.push(line),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('invalid cursor')) return { status: 400, body: { code: 'bad-cursor', error: message } };
    throw error;
  }
  const runArg = run ? { run } : {};
  if (outcome.kind === 'report') {
    return {
      status: 200,
      body: {
        status: 'done',
        lane: { name: outcome.lane.name, run: outcome.lane.run, key: outcome.lane.key },
        report: outcome.report,
        cursor: outcome.cursor,
        warnings,
        next: { tool: 'lane_wait', arguments: { ...runArg, after: outcome.cursor } },
      },
    };
  }
  return {
    status: 200,
    body: {
      status: 'running',
      cursor: outcome.cursor,
      warnings,
      next: { tool: 'lane_wait', arguments: { ...runArg, ...(outcome.cursor ? { after: outcome.cursor } : {}) } },
    },
  };
}

export const NOT_A_LANE = { code: 'not-a-lane', error: 'lane_report runs only inside a lane conversation' } as const;

export interface SelfLaneReportDeps {
  caller?: SelfCallerDeps;
  jobs?: SelfJobs;
  laneOf?: (name: string) => { laneKey: string | null } | null;
}

/** `POST /api/self/lanes/report`. */
export async function handleSelfLaneReport(
  credential: DashboardCredential | null,
  raw: unknown,
  signal?: AbortSignal,
  deps: SelfLaneReportDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;
  if (caller.agentKind !== 'conversation' || !(deps.laneOf ?? getConversationByName)(caller.agentId)?.laneKey) return { status: 409, body: NOT_A_LANE };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { status: 400, body: { error: 'body must be a JSON object' } };
  const input = raw as Record<string, unknown>;
  const report = input['report'];
  if (typeof report !== 'string' || !report.trim()) return { status: 400, body: { error: 'report is required' } };
  if (Buffer.byteLength(report, 'utf8') > MAX_WORKER_REPORT_BYTES) {
    return { status: 400, body: { error: `report is larger than ${MAX_WORKER_REPORT_BYTES} bytes; write a summary and point at files instead` } };
  }
  const status = input['status'] ?? 'done';
  if (!isWorkerReportStatus(status)) return { status: 400, body: { error: 'status must be done, blocked or failed' } };
  const verdict = input['verdict'];
  if (verdict !== undefined && !isLaneVerdict(verdict)) return { status: 400, body: { error: 'verdict must be WOWED, IMPRESSED, NOT_YET, PASS or DEFECTS' } };
  const defects = input['defects'];
  if (defects !== undefined && (typeof defects !== 'number' || !Number.isInteger(defects) || defects < 0)) {
    return { status: 400, body: { error: 'defects must be a non-negative integer' } };
  }
  const args: SelfJobArg[] = [
    { flag: 'status', value: status },
    { switch: 'stdin' },
    ...(verdict !== undefined ? [{ flag: 'verdict', value: verdict }] : []),
    ...(defects !== undefined ? [{ flag: 'defects', value: String(defects) }] : []),
  ];
  const jobs = deps.jobs ?? selfJobs;
  const started = jobs.start(caller, 'lane-report', args, { stdin: report });
  if (!started.ok) return { status: 429, body: { code: started.code, error: started.error } };
  const state = await jobs.wait(started.jobId, caller, WAIT_CHUNK_MS, signal);
  // The job was started for this caller a moment ago, so the store holds it.
  return { status: 200, body: selfJobAnswer(state!) };
}

/** The JSON body of a request; `undefined` when it is not JSON. */
const readJsonBody = (request: HttpServerRequest.HttpServerRequest) => Effect.gen(function* () {
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return undefined;
  }
});

export function makeSelfLanesRouteLayer() {
  const startSelfLaneRoute = HttpRouter.add(
    'POST',
    '/api/self/lanes',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
      const body = yield* readJsonBody(request);
      if (body === undefined) return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
      const credential = resolveRequestCredential(request);
      const viaChannel = channelOfRequest(request) !== null;
      const result = yield* Effect.promise(() => handleSelfLaneStart(credential, body, viaChannel));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const waitSelfLanesRoute = HttpRouter.add(
    'POST',
    '/api/self/lanes/wait',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
      const body = yield* readJsonBody(request);
      if (body === undefined) return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise(() => handleSelfLaneWait(credential, body));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const reportSelfLaneRoute = HttpRouter.add(
    'POST',
    '/api/self/lanes/report',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
      const body = yield* readJsonBody(request);
      if (body === undefined) return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfLaneReport(credential, body, signal));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(startSelfLaneRoute, waitSelfLanesRoute, reportSelfLaneRoute);
}

export const selfLanesRouteLayer = makeSelfLanesRouteLayer();
