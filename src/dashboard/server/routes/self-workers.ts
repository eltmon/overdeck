/**
 * Self worker routes (PAN-4938, PAN-4927 W-DEL1): an agent delegates a worker
 * on its own issue and follows the workers it started.
 *
 * - `POST /api/self/workers { task, harness?, model?, effort?, readOnly?, name?, machine?, needs? }`
 *   (`operate`, D-1) → `fleet-work.handleFleetWorker` with `issueId` = the
 *   caller's issue and `parentId` = `workerParentOf(caller)` (D-2). Body
 *   `issueId` and `parentId` are never read. A caller without an issue gets
 *   409 `no-issue`. Answers `{ workerId, machine, remote, reason, next }`,
 *   `next` being the `task_wait` call to make.
 * - `GET /api/self/workers/:id/wait?afterSeq=<n>&timeoutMs=<1..50000>`
 *   (`read:state`, D-3, D-5) → `worker/wait-any.waitForAnyWorker` for one of
 *   the caller's workers, local or a stand-in, for at most 50 s. Answers
 *   `done` with the report, `ended` (`exited-without-report` or
 *   `idle-without-report`) with the last assistant message, or `running` with
 *   `next`. The startup grace is what remains of 60 s since the worker's
 *   launch, so a worker that died before this chunk began is judged at once.
 *
 * Ownership (D-3): a worker is the caller's when its `worker.json` or its
 * stand-in `remote.json` names `workerParentOf(caller)` as parent
 * (case-insensitive). Any other id, including another agent's worker,
 * answers 404 `unknown-worker`.
 *
 * Auth: the route-scope table judges the scope; the handler then requires an
 * agent token (`self-caller.ts`), so every other credential gets 403
 * `not-an-agent-token` and a token whose agent is gone gets 404 `agent-gone`.
 * The agent, its issue and the worker's parent come from the token only.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { readWorkerFacts } from '../../../lib/agents/worker/facts.js';
import { isWorkerId } from '../../../lib/agents/worker/ids.js';
import { readRemoteStandIn, type RemoteStandIn } from '../../../lib/agents/worker/remote-standin.js';
import { WAIT_STARTUP_GRACE_MS, waitForWorkerReport, type WaitOptions, type WaitOutcome } from '../../../lib/agents/worker/wait.js';
import { waitForAnyWorker } from '../../../lib/agents/worker/wait-any.js';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCaller, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { type FleetCaller, fleetCaller, handleFleetWorker, readFleetBody } from './fleet-work.js';
import { httpHandler } from './http-handler.js';
import { refuseFleetRequest } from './machines-fleet.js';
import { readJsonResponse } from './machines-work.js';
import { parseWaitTimeoutMs, type SelfRouteResult } from './self-jobs.js';

/** D-2: the parentId a worker started for `caller` records, as `pan worker run` would. */
export function workerParentOf(caller: SelfCaller): string {
  return caller.agentKind === 'agent' ? caller.agentId : caller.tmuxSession ?? `conv-${caller.agentId}`;
}

export const NO_ISSUE = { code: 'no-issue', error: 'delegate_task needs an issue; use start_conversation' } as const;
export const UNKNOWN_WORKER = { code: 'unknown-worker', error: 'no such worker' } as const;
const BAD_TIMEOUT = { code: 'bad-timeout', error: 'timeoutMs must be an integer from 1 to 50000' } as const;
const BAD_AFTER_SEQ = { code: 'bad-after-seq', error: 'afterSeq must be a non-negative integer' } as const;

export interface OwnedWorker {
  id: string;
  issueId: string;
  name: string | null;
  launchedAt: string;
  remote: RemoteStandIn | null;
}

export interface OwnedWorkerDeps {
  readFacts?: typeof readWorkerFacts;
  readStandIn?: typeof readRemoteStandIn;
}

const sameParent = (parentId: string | null | undefined, caller: SelfCaller): boolean =>
  typeof parentId === 'string' && parentId.toLowerCase() === workerParentOf(caller).toLowerCase();

/** D-3: the worker when `caller` is its parent (local worker.json or stand-in remote.json), else null. */
export async function ownedWorker(id: string, caller: SelfCaller, deps: OwnedWorkerDeps = {}): Promise<OwnedWorker | null> {
  if (!isWorkerId(id)) return null;
  const facts = await (deps.readFacts ?? readWorkerFacts)(id);
  if (facts && sameParent(facts.parentId, caller)) {
    return { id, issueId: facts.issueId, name: facts.name, launchedAt: facts.startedAt, remote: null };
  }
  const standIn = await (deps.readStandIn ?? readRemoteStandIn)(id);
  if (standIn && sameParent(standIn.parentId, caller)) {
    return { id, issueId: standIn.issueId, name: null, launchedAt: standIn.createdAt, remote: standIn };
  }
  return null;
}

/** Optional worker fields copied as-is from the body; `handleFleetWorker` validates them. */
const PASSED_FIELDS = ['model', 'harness', 'effort', 'readOnly', 'name', 'machine', 'needs'] as const;

export interface SelfWorkerStartDeps {
  caller?: SelfCallerDeps;
  startFleetWorker?: (body: Record<string, unknown>, caller: FleetCaller) => Promise<HttpServerResponse.HttpServerResponse>;
}

/** `POST /api/self/workers`. */
export async function handleSelfWorkerStart(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: SelfWorkerStartDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { status: 400, body: { error: 'body must be an object' } };
  const input = raw as Record<string, unknown>;
  if (caller.issueId === null) return { status: 409, body: NO_ISSUE };
  const task = input['task'];
  if (typeof task !== 'string' || !task.trim()) return { status: 400, body: { error: 'task is required' } };
  const body: Record<string, unknown> = { issueId: caller.issueId, prompt: task, parentId: workerParentOf(caller) };
  for (const field of PASSED_FIELDS) {
    if (input[field] !== undefined) body[field] = input[field];
  }
  // A token credential always yields a fleet caller.
  const fleet = fleetCaller(credential, undefined)!;
  const answer = readJsonResponse(await (deps.startFleetWorker ?? handleFleetWorker)(body, fleet));
  if (answer.status !== 200) return answer;
  const started = answer.body as { id: string; machine: unknown; remote: unknown; reason: unknown };
  return {
    status: 200,
    body: {
      workerId: started.id,
      machine: started.machine,
      remote: started.remote,
      reason: started.reason,
      next: { tool: 'task_wait', arguments: { workerId: started.id } },
    },
  };
}

export interface SelfWorkerWaitDeps extends OwnedWorkerDeps {
  caller?: SelfCallerDeps;
  wait?: (id: string, options: WaitOptions) => Promise<WaitOutcome>;
  now?: () => number;
}

const defaultWait = (id: string, options: WaitOptions): Promise<WaitOutcome> => waitForAnyWorker(id, options, waitForWorkerReport);

/** `GET /api/self/workers/:id/wait?afterSeq=<n>&timeoutMs=<1..50000>`. */
export async function handleSelfWorkerWait(
  credential: DashboardCredential | null,
  id: string,
  rawAfterSeq: string | null,
  rawTimeout: string | null,
  signal?: AbortSignal,
  deps: SelfWorkerWaitDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const timeout = parseWaitTimeoutMs(rawTimeout);
  if (!timeout.ok) return { status: 400, body: BAD_TIMEOUT };
  if (rawAfterSeq !== null && !/^\d{1,9}$/.test(rawAfterSeq)) return { status: 400, body: BAD_AFTER_SEQ };
  const afterSeq = rawAfterSeq === null ? undefined : Number(rawAfterSeq);
  const owned = await ownedWorker(id, resolved.caller, deps);
  if (!owned) return { status: 404, body: UNKNOWN_WORKER };
  const now = deps.now ?? Date.now;
  // D-5: each chunk is a new wait, so the startup grace counts from the worker's launch, not the chunk.
  const launchedAtMs = Date.parse(owned.launchedAt);
  const startupGraceMs = Number.isFinite(launchedAtMs) ? Math.max(0, WAIT_STARTUP_GRACE_MS - (now() - launchedAtMs)) : WAIT_STARTUP_GRACE_MS;
  const outcome = await (deps.wait ?? defaultWait)(id, { afterSeq, timeoutMs: timeout.value, startupGraceMs, signal });
  switch (outcome.kind) {
    case 'report':
      return { status: 200, body: { status: 'done', workerId: id, report: outcome.report } };
    case 'timeout':
      return {
        status: 200,
        body: { status: 'running', workerId: id, next: { tool: 'task_wait', arguments: { workerId: id, ...(afterSeq !== undefined ? { afterSeq } : {}) } } },
      };
    default:
      return {
        status: 200,
        body: { status: 'ended', workerId: id, kind: outcome.kind, lastAssistantMessage: outcome.lastAssistantMessage, transcriptPath: outcome.transcriptPath },
      };
  }
}

export function makeSelfWorkersRouteLayer() {
  const startSelfWorkerRoute = HttpRouter.add(
    'POST',
    '/api/self/workers',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnsafeDashboardMutationRequest(request));
      if (refused) return refused;
      const body = yield* readFleetBody;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise(() => handleSelfWorkerStart(credential, body));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const waitSelfWorkerRoute = HttpRouter.add(
    'GET',
    '/api/self/workers/:id/wait',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const url = HttpServerRequest.toURL(request);
      const rawAfterSeq = Option.isSome(url) ? url.value.searchParams.get('afterSeq') : null;
      const rawTimeout = Option.isSome(url) ? url.value.searchParams.get('timeoutMs') : null;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfWorkerWait(credential, params['id'] ?? '', rawAfterSeq, rawTimeout, signal));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(startSelfWorkerRoute, waitSelfWorkerRoute);
}

export const selfWorkersRouteLayer = makeSelfWorkersRouteLayer();
