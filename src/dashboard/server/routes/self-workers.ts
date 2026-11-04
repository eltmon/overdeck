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
 *
 * Auth: the route-scope table judges the scope; the handler then requires an
 * agent token (`self-caller.ts`), so every other credential gets 403
 * `not-an-agent-token` and a token whose agent is gone gets 404 `agent-gone`.
 * The agent, its issue and the worker's parent come from the token only.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCaller, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { type FleetCaller, fleetCaller, handleFleetWorker, readFleetBody } from './fleet-work.js';
import { httpHandler } from './http-handler.js';
import { refuseFleetRequest } from './machines-fleet.js';
import { readJsonResponse } from './machines-work.js';
import type { SelfRouteResult } from './self-jobs.js';

/** D-2: the parentId a worker started for `caller` records, as `pan worker run` would. */
export function workerParentOf(caller: SelfCaller): string {
  return caller.agentKind === 'agent' ? caller.agentId : caller.tmuxSession ?? `conv-${caller.agentId}`;
}

export const NO_ISSUE = { code: 'no-issue', error: 'delegate_task needs an issue; use start_conversation' } as const;

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

  return Layer.mergeAll(startSelfWorkerRoute);
}

export const selfWorkersRouteLayer = makeSelfWorkersRouteLayer();
