/**
 * `GET /api/self/jobs/:id` and `GET /api/self/jobs/:id/wait` (PAN-4927
 * W-SELF1, D-10, D-12): an agent reads, or waits on, a job a self route
 * started for it.
 *
 * Auth: the route-scope table maps both to `read:state`; the handler then
 * requires an agent token (`self-caller.ts`), so every other credential,
 * including the internal token, the root session and an unauthenticated local
 * call, gets 403 `not-an-agent-token`, and a token whose agent is gone gets
 * 404 `agent-gone`. The agent comes from the token, never the request. Order
 * (D-1): caller, then `timeoutMs` (400 `bad-timeout`), then the job (404
 * `unknown-job` for an unknown id and for another agent's job alike).
 *
 * The state route answers at once. The wait route blocks until the job ends
 * or `timeoutMs` (1..50,000, default 50,000) passes, and stops early when the
 * request is cancelled. Both answer `selfJobAnswer`: `done` with the result,
 * or `running` with `next`, the wait call to make again. Jobs live in
 * dashboard memory (`services/self-jobs.ts`); a restart forgets them.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { selfJobAnswer, selfJobs, type SelfJobs } from '../services/self-jobs.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

export interface SelfJobsRouteDeps {
  jobs?: SelfJobs;
  caller?: SelfCallerDeps;
}
export type SelfRouteResult = { status: number; body: unknown };

const UNKNOWN_JOB = { error: 'no such job', code: 'unknown-job' } as const;
const BAD_TIMEOUT = { error: `timeoutMs must be an integer from 1 to ${WAIT_CHUNK_MS}`, code: 'bad-timeout' } as const;

/** null → WAIT_CHUNK_MS; an integer string in 1..WAIT_CHUNK_MS → that number; anything else is refused. */
export function parseWaitTimeoutMs(raw: string | null): { ok: true; value: number } | { ok: false } {
  if (raw === null) return { ok: true, value: WAIT_CHUNK_MS };
  if (!/^\d{1,5}$/.test(raw)) return { ok: false };
  const value = Number(raw);
  return value >= 1 && value <= WAIT_CHUNK_MS ? { ok: true, value } : { ok: false };
}

/** `GET /api/self/jobs/:id`. */
export function handleSelfJobGet(credential: DashboardCredential | null, jobId: string, deps: SelfJobsRouteDeps = {}): SelfRouteResult {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const state = (deps.jobs ?? selfJobs).get(jobId, resolved.caller);
  return state ? { status: 200, body: selfJobAnswer(state) } : { status: 404, body: UNKNOWN_JOB };
}

/** `GET /api/self/jobs/:id/wait?timeoutMs=<1..50000>`. */
export async function handleSelfJobWait(
  credential: DashboardCredential | null,
  jobId: string,
  rawTimeout: string | null,
  signal?: AbortSignal,
  deps: SelfJobsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const timeout = parseWaitTimeoutMs(rawTimeout);
  if (!timeout.ok) return { status: 400, body: BAD_TIMEOUT };
  const state = await (deps.jobs ?? selfJobs).wait(jobId, resolved.caller, timeout.value, signal);
  return state ? { status: 200, body: selfJobAnswer(state) } : { status: 404, body: UNKNOWN_JOB };
}

export function makeSelfJobsRouteLayer(deps: SelfJobsRouteDeps = {}) {
  const getSelfJobRoute = HttpRouter.add(
    'GET',
    '/api/self/jobs/:id',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const result = handleSelfJobGet(resolveRequestCredential(request), params['id'] ?? '', deps);
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const waitSelfJobRoute = HttpRouter.add(
    'GET',
    '/api/self/jobs/:id/wait',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const url = HttpServerRequest.toURL(request);
      const rawTimeout = Option.isSome(url) ? url.value.searchParams.get('timeoutMs') : null;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfJobWait(credential, params['id'] ?? '', rawTimeout, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(getSelfJobRoute, waitSelfJobRoute);
}

export const selfJobsRouteLayer = makeSelfJobsRouteLayer();
