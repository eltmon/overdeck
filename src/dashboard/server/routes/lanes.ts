/**
 * The lanes API (.pan/drafts/pan-4223.md WI-5 step 3): the HTTP door of the
 * lane core. `pan lane start` calls `POST /api/lanes`, so there is one creation
 * path (FR-2). Every handler checks the Origin first, like routes/conversations.ts.
 *
 * - `POST /api/lanes` → `launchLane(body)`; 201 with the LaneLaunchResult, a
 *   LaneLaunchError maps to its status with `{ error, code? }`. PAN-4638: a
 *   `machine` (label, environment id or `auto`, with optional `needs`) runs the
 *   lane on a linked machine through its lane work door, acting as the caller
 *   (`x-overdeck-sender`); a request that arrived through a secure channel may
 *   not place a lane on another machine (403 `no-chained-hops`).
 * - `GET /api/lanes?run=&parent=&key=&role=` → `{ generatedAt, lanes }`.
 * - `GET /api/lanes/:name` → one LaneView (a local lane, or a stand-in for a
 *   lane on another machine), or 404 when the name is not a lane.
 * - `POST /api/lanes/:name/reap` with `{ park?, keep? }` → `reapLane` with the
 *   archive route's own dependencies (D14), never a second copy of them. A
 *   lane on another machine is reaped by its owner's lane reap door; home then
 *   archives the stand-in unless `keep` (PAN-4638 D-4638-13).
 * - `POST /api/lanes/:name/stop` → the conversation stop door for a local lane,
 *   or the owner's `POST /api/conversations/<name>/stop` as the caller for a
 *   lane on another machine. 200 `{ stopped: true }`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { listFlyMachines } from '../../../lib/anywhere/fly/machine-store.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { launchLane, type LaneLaunchDeps, type RemoteLaneTarget } from '../../../lib/lanes/launch.js';
import { LaneReapError, reapLane } from '../../../lib/lanes/reap.js';
import { markRemoteLaneArchived, readRemoteLane } from '../../../lib/lanes/remote-lanes.js';
import { LaneLaunchError, type LaneLaunchRequest } from '../../../lib/lanes/types.js';
import { invalidateLaneViews, listLaneViews, type LaneViewFilter } from '../../../lib/lanes/views.js';
import { stopConversationRuntime } from '../../../lib/overdeck/conversation-runtime.js';
import { getConversationByName, LANE_ROLES, markConversationEnded, type LaneRole, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { SENDER_HEADER } from '../linked-conversation-proxy.js';
import { followRemoteLane } from '../services/remote-lane-follower.js';
import { conversationArchiveDependencies } from './conversations.js';
import { resolveRequestCredential } from './dashboard-auth.js';
import { defaultFleetSpawnDeps, fleetCaller, type FleetCaller, type FleetSpawnDeps, ownerRefusal, parseNeeds, postWorkDoor } from './fleet-work.js';
import { readJsonResponse } from './machines-work.js';
import { validateOrigin } from './origin-validation.js';

const STRING_FIELDS = ['parent', 'run', 'key', 'for', 'role', 'project', 'model', 'harness', 'effort', 'brief', 'briefSource', 'title', 'branch', 'from', 'at', 'machine'] as const;
const BOOLEAN_FIELDS = ['reuse', 'replace', 'force'] as const;

/** Validate a POST /api/lanes body into a launch request; the core validates values. */
export function parseLaneLaunchBody(body: unknown): { ok: true; request: LaneLaunchRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const raw = body as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') return { ok: false, error: `${field} must be a string` };
  }
  for (const field of BOOLEAN_FIELDS) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') return { ok: false, error: `${field} must be a boolean` };
  }
  for (const field of ['parent', 'role', 'brief'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') return { ok: false, error: `${field} is required` };
  }
  // A critic or verifier with `for` takes its builder's key (WI-19).
  if ((typeof raw.key !== 'string' || raw.key === '') && (typeof raw.for !== 'string' || raw.for === '')) {
    return { ok: false, error: 'key is required (or for, for a critic or verifier)' };
  }
  const needs = parseNeeds(raw.needs);
  if (typeof needs === 'string') return { ok: false, error: needs };
  const { needs: _needs, ...rest } = raw;
  return { ok: true, request: { ...(rest as unknown as LaneLaunchRequest), ...(needs.length > 0 ? { needs } : {}) } };
}

export interface LaneRouteDeps extends Pick<FleetSpawnDeps, 'resolveTarget' | 'projectOrigin' | 'thisLabel' | 'fetchPeer'> {
  launch: (request: LaneLaunchRequest, deps: LaneLaunchDeps) => ReturnType<typeof launchLane>;
  flyEnvironmentIds: () => Promise<string[]>;
  follow: (name: string) => void;
  /** The conversation stop door: stop the runtime, then mark the row ended. */
  stopLocal: (conv: LegacyConversation) => Promise<void>;
  now: () => Date;
}

export const defaultLaneRouteDeps = (): LaneRouteDeps => {
  const fleet = defaultFleetSpawnDeps();
  return {
    resolveTarget: fleet.resolveTarget,
    projectOrigin: fleet.projectOrigin,
    thisLabel: fleet.thisLabel,
    fetchPeer: fleet.fetchPeer,
    launch: launchLane,
    flyEnvironmentIds: async () => (await listFlyMachines()).flatMap((record) => (record.environmentId ? [record.environmentId] : [])),
    follow: followRemoteLane,
    stopLocal: async (conv) => {
      await stopConversationRuntime(conv, conv.name);
      markConversationEnded(conv.name);
    },
    now: () => new Date(),
  };
};

/** The owner's link for a remote lane; a refusal answers 503 machine-unreachable when it is offline. */
async function ownerLinkOf(
  environmentId: string,
  deps: LaneRouteDeps,
): Promise<{ ok: true; link: MachineLink } | { ok: false; response: HttpServerResponse.HttpServerResponse }> {
  const target = await deps.resolveTarget(environmentId, null, []);
  if (target.ok && !target.self) return { ok: true, link: target.link };
  if (target.ok) return { ok: false, response: jsonResponse({ error: 'the stand-in names this machine' }, { status: 409 }) };
  const body = target.body as { code?: unknown; error?: unknown };
  if (target.status === 503) return { ok: false, response: jsonResponse({ ...body, code: 'machine-unreachable' }, { status: 503 }) };
  return { ok: false, response: jsonResponse(body, { status: target.status }) };
}

/** `POST /api/lanes/:name/stop`. */
export async function handleLaneStop(name: string, caller: FleetCaller, deps: LaneRouteDeps = defaultLaneRouteDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const row = getConversationByName(name);
  if (row?.laneKey) {
    await deps.stopLocal(row);
    invalidateLaneViews();
    return jsonResponse({ stopped: true });
  }
  const remote = await readRemoteLaneIfNamed(name);
  if (!remote) return jsonResponse({ error: `${name} is not a lane` }, { status: 404 });
  const owner = await ownerLinkOf(remote.facts.environmentId, deps);
  if (!owner.ok) return owner.response;
  const answer = await postWorkDoor(deps, owner.link, `/api/conversations/${encodeURIComponent(name)}/stop`, {}, caller);
  if (answer.status !== 200) return jsonResponse(answer.json, { status: answer.status });
  invalidateLaneViews();
  return jsonResponse({ stopped: true });
}

/** `POST /api/lanes/:name/reap` for a lane on another machine (D-4638-13). */
export async function handleRemoteLaneReap(
  name: string,
  options: { park: boolean; keep: boolean },
  caller: FleetCaller,
  deps: LaneRouteDeps = defaultLaneRouteDeps(),
): Promise<HttpServerResponse.HttpServerResponse | null> {
  const remote = await readRemoteLaneIfNamed(name);
  if (!remote) return null;
  const owner = await ownerLinkOf(remote.facts.environmentId, deps);
  if (!owner.ok) return owner.response;
  const answer = await postWorkDoor(deps, owner.link, `/api/machines/work/lanes/${encodeURIComponent(name)}/reap`, options, caller);
  if (answer.status === 200) {
    if (!options.keep) await markRemoteLaneArchived(name, deps.now().toISOString());
    invalidateLaneViews();
    return jsonResponse(answer.json);
  }
  if (answer.status === 404 && (answer.json as { code?: unknown } | null)?.code === 'unknown-lane') {
    await markRemoteLaneArchived(name, deps.now().toISOString());
    invalidateLaneViews();
    const warning = `the lane is gone from ${remote.facts.label}; archived it here`;
    return jsonResponse({ removed: false, archived: true, parkedPatch: null, warnings: [warning] });
  }
  return jsonResponse(answer.json, { status: answer.status });
}

const LANE_ERROR_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 429, 503]);
const laneStatus = (status: number): LaneLaunchError['status'] => (LANE_ERROR_STATUSES.has(status) ? status : 500) as LaneLaunchError['status'];

/** PAN-4638 WI-5: resolves a lane's machine for `launchLane`; null = this machine. */
export function laneMachineResolver(
  context: { viaChannel: boolean; caller: FleetCaller },
  deps: LaneRouteDeps,
): NonNullable<LaneLaunchDeps['resolveMachine']> {
  return async (machine, needs, projectKey): Promise<RemoteLaneTarget | null> => {
    // D-4638-12: no chained hops, the same rule as the fleet routes.
    if (context.viaChannel) {
      throw new LaneLaunchError(403, 'a linked machine cannot place a lane on another machine through this one', 'no-chained-hops');
    }
    const gitOrigin = deps.projectOrigin(projectKey)?.gitOrigin ?? null;
    const target = await deps.resolveTarget(machine, gitOrigin, needs);
    if (!target.ok) {
      const body = target.body as { code?: unknown; error?: unknown };
      throw new LaneLaunchError(laneStatus(target.status), String(body.error ?? `HTTP ${target.status}`), typeof body.code === 'string' ? body.code : undefined);
    }
    if (target.self) return null;
    if (gitOrigin === null) {
      throw new LaneLaunchError(409, `${projectKey} has no github_repo or gitlab_repo, so ${target.label} cannot find it`, 'project-has-no-origin');
    }
    const { link } = target;
    return {
      environmentId: target.environmentId,
      label: target.label,
      reason: target.reason,
      isFly: (await deps.flyEnvironmentIds()).includes(target.environmentId),
      launch: async (spec) => {
        const answer = await postWorkDoor(deps, link, '/api/machines/work/lanes', { ...spec, gitOrigin }, context.caller);
        if (answer.status === 201) return { status: 201, body: (answer.json ?? {}) as Record<string, unknown> };
        const refusal = readJsonResponse(ownerRefusal(answer.status, answer.json, link, { thisLabel: await deps.thisLabel(), projectKey }));
        return { status: refusal.status, body: (refusal.body ?? {}) as Record<string, unknown> };
      },
      stop: async (name) => {
        const answer = await postWorkDoor(deps, link, `/api/conversations/${encodeURIComponent(name)}/stop`, {}, context.caller);
        if (answer.status === 200) return;
        const error = (answer.json as { error?: unknown } | null)?.error;
        throw new LaneLaunchError(laneStatus(answer.status), `${link.label}: could not stop ${name}: ${String(error ?? `HTTP ${answer.status}`)}`);
      },
    };
  };
}

/** `POST /api/lanes` after the body parsed: launch here or on the resolved machine, then follow a remote lane. */
export async function handleLaneLaunch(
  request: LaneLaunchRequest,
  context: { viaChannel: boolean; caller: FleetCaller },
  deps: LaneRouteDeps = defaultLaneRouteDeps(),
): Promise<HttpServerResponse.HttpServerResponse> {
  try {
    const result = await deps.launch(request, { resolveMachine: laneMachineResolver(context, deps) });
    invalidateLaneViews();
    if (result.machine) deps.follow(result.conversation.name);
    return jsonResponse(result, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, 'launch');
  }
}

/** A stand-in by name; null for a name the stand-in store does not accept. */
async function readRemoteLaneIfNamed(name: string): ReturnType<typeof readRemoteLane> {
  try {
    return await readRemoteLane(name);
  } catch {
    return null;
  }
}

function laneFilter(url: URL): LaneViewFilter {
  const filter: LaneViewFilter = {};
  const run = url.searchParams.get('run');
  const parent = url.searchParams.get('parent');
  const key = url.searchParams.get('key');
  const role = url.searchParams.get('role');
  if (run) filter.run = run;
  if (parent) filter.parentName = parent.startsWith('conv-') ? parent.slice('conv-'.length) : parent;
  if (key) filter.key = key;
  if (role && (LANE_ROLES as readonly string[]).includes(role)) filter.role = role as LaneRole;
  return filter;
}

function errorResponse(error: unknown, context: string) {
  if (error instanceof LaneLaunchError) {
    return jsonResponse({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  }
  if (error instanceof LaneReapError) return jsonResponse({ error: error.message }, { status: error.status });
  console.error(`[lanes] ${context} failed:`, error instanceof Error ? error.message : String(error));
  return jsonResponse({ error: 'Internal server error' }, { status: 500 });
}

const postLaneRoute = HttpRouter.add(
  'POST',
  '/api/lanes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const text = yield* request.text;
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    const parsed = parseLaneLaunchBody(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const sender = (request.headers as Record<string, string | string[] | undefined>)[SENDER_HEADER];
    const caller = fleetCaller(resolveRequestCredential(request), Array.isArray(sender) ? sender[0] : sender);
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    const viaChannel = channelOfRequest(request) !== null;
    return yield* Effect.promise(() => handleLaneLaunch(parsed.request, { viaChannel, caller }));
  }),
);

const listLanesRoute = HttpRouter.add(
  'GET',
  '/api/lanes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const filter = laneFilter(new URL(request.url, 'http://localhost'));
    return yield* Effect.promise(async () => {
      try {
        const lanes = await listLaneViews(filter);
        return jsonResponse({ generatedAt: new Date().toISOString(), lanes });
      } catch (error: unknown) {
        return errorResponse(error, 'list');
      }
    });
  }),
);

const getLaneRoute = HttpRouter.add(
  'GET',
  '/api/lanes/:name',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const rawName = params['name'] ?? '';
    const name = rawName.startsWith('conv-') ? rawName.slice('conv-'.length) : rawName;
    return yield* Effect.promise(async () => {
      try {
        const row = getConversationByName(name);
        // PAN-4638 WI-6: a lane on another machine has no local row, only a stand-in.
        const facts = row?.laneKey ? null : (await readRemoteLaneIfNamed(name))?.facts;
        const lane = row?.gauntletRun && row.laneKey && row.laneRole
          ? { run: row.gauntletRun, key: row.laneKey, role: row.laneRole }
          : facts ? { run: facts.run, key: facts.key, role: facts.role } : null;
        if (!lane) return jsonResponse({ error: `${rawName} is not a lane` }, { status: 404 });
        const lanes = await listLaneViews(lane);
        const view = lanes.find((candidate) => candidate.name === name);
        return view ? jsonResponse(view) : jsonResponse({ error: `${rawName} is not a lane` }, { status: 404 });
      } catch (error: unknown) {
        return errorResponse(error, 'get');
      }
    });
  }),
);

const reapLaneRoute = HttpRouter.add(
  'POST',
  '/api/lanes/:name/reap',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const text = yield* request.text;
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse({ error: 'body must be a JSON object' }, { status: 400 });
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    for (const field of ['park', 'keep'] as const) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') return jsonResponse({ error: `${field} must be a boolean` }, { status: 400 });
    }
    const sender = (request.headers as Record<string, string | string[] | undefined>)[SENDER_HEADER];
    const caller = fleetCaller(resolveRequestCredential(request), Array.isArray(sender) ? sender[0] : sender);
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    const options = { park: body.park === true, keep: body.keep === true };
    return yield* Effect.promise(async () => {
      try {
        if (!getConversationByName(name)?.laneKey) {
          const remote = await handleRemoteLaneReap(name, options, caller);
          if (remote) return remote;
        }
        const result = await reapLane(name, options, { archive: conversationArchiveDependencies });
        invalidateLaneViews();
        return jsonResponse(result);
      } catch (error: unknown) {
        return errorResponse(error, 'reap');
      }
    });
  }),
);

const stopLaneRoute = HttpRouter.add(
  'POST',
  '/api/lanes/:name/stop',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const rawName = (yield* HttpRouter.params)['name'] ?? '';
    const name = rawName.startsWith('conv-') ? rawName.slice('conv-'.length) : rawName;
    const sender = (request.headers as Record<string, string | string[] | undefined>)[SENDER_HEADER];
    const caller = fleetCaller(resolveRequestCredential(request), Array.isArray(sender) ? sender[0] : sender);
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    return yield* Effect.promise(async () => {
      try {
        return await handleLaneStop(name, caller);
      } catch (error: unknown) {
        return errorResponse(error, 'stop');
      }
    });
  }),
);

export const lanesRouteLayer = Layer.mergeAll(postLaneRoute, listLanesRoute, getLaneRoute, reapLaneRoute, stopLaneRoute);
