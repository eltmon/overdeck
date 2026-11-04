/**
 * The six `/api/self/` workflow routes (PAN-4927 W-SELF2, epic D-10, D-11,
 * D-12): `task_claim`, `task_done`, `task_block`, `done`, `handoff` and
 * `worker_report`.
 *
 * Each needs an agent token (`self-caller.ts`), takes the agent and its issue
 * from the token, builds argv only from `buildSelfJobArgv` pieces, starts a
 * job, waits up to `WAIT_CHUNK_MS` and answers `selfJobAnswer`. There is no
 * CSRF check: only a header-borne agent token is accepted, never a cookie
 * (D-8).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCaller, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { SelfJobArgError, type SelfJobArg, type SelfJobVerb } from '../services/self-job-argv.js';
import { selfJobAnswer, selfJobs, type SelfJobs } from '../services/self-jobs.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { SelfRouteResult } from './self-jobs.js';

export interface SelfWorkflowRouteDeps {
  jobs?: SelfJobs;
  caller?: SelfCallerDeps;
}

const BAD_BODY = { error: 'request body must be a JSON object', code: 'bad-body' } as const;
const NO_ISSUE = { error: 'this agent has no issue', code: 'no-issue' } as const;
const UNKNOWN_JOB = { error: 'no such job', code: 'unknown-job' } as const;

/** '' → {}; a JSON object → it; anything else → null (400 bad-body). */
export function parseSelfBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const badRequest = (error: string): SelfRouteResult => ({ status: 400, body: { error, code: 'bad-request' } });

/** A required string field, non-empty after trim, at most `max` characters; the error names the field. */
export function requiredBodyString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: string } | { ok: false; result: SelfRouteResult } {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, result: badRequest(`${field} is required and must be a non-empty string`) };
  }
  if (value.length > max) return { ok: false, result: badRequest(`${field} must be at most ${max} characters`) };
  return { ok: true, value };
}

/** Start the job, wait up to WAIT_CHUNK_MS, answer it (D-2, D-3). */
export async function startSelfJobAnswer(
  jobs: SelfJobs,
  caller: SelfCaller,
  verb: SelfJobVerb,
  args: readonly SelfJobArg[],
  options: { stdin?: string },
  signal?: AbortSignal,
): Promise<SelfRouteResult> {
  let started;
  try {
    started = jobs.start(caller, verb, args, options);
  } catch (error) {
    if (error instanceof SelfJobArgError) return { status: 400, body: { error: error.message, code: error.code } };
    throw error;
  }
  if (!started.ok) return { status: 429, body: { error: started.error, code: started.code } };
  const state = await jobs.wait(started.jobId, caller, WAIT_CHUNK_MS, signal);
  return state === null ? { status: 404, body: UNKNOWN_JOB } : { status: 200, body: selfJobAnswer(state) };
}

type PreludeResult = { ok: true; caller: SelfCaller; body: Record<string, unknown>; jobs: SelfJobs } | { ok: false; result: SelfRouteResult };

function prelude(credential: DashboardCredential | null, text: string, deps: SelfWorkflowRouteDeps): PreludeResult {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { ok: false, result: { status: resolved.status, body: resolved.body } };
  const body = parseSelfBody(text);
  if (body === null) return { ok: false, result: { status: 400, body: BAD_BODY } };
  return { ok: true, caller: resolved.caller, body, jobs: deps.jobs ?? selfJobs };
}

export async function handleSelfTaskClaim(
  credential: DashboardCredential | null,
  text: string,
  signal?: AbortSignal,
  deps: SelfWorkflowRouteDeps = {},
): Promise<SelfRouteResult> {
  const prepared = prelude(credential, text, deps);
  if (!prepared.ok) return prepared.result;
  const { caller, body, jobs } = prepared;
  const itemId = requiredBodyString(body, 'itemId', 200);
  if (!itemId.ok) return itemId.result;
  if (caller.issueId === null) return { status: 409, body: NO_ISSUE };
  return startSelfJobAnswer(jobs, caller, 'task-claim', [{ ref: caller.issueId }, { ref: itemId.value }, { switch: 'json' }], {}, signal);
}

export async function handleSelfTaskDone(
  credential: DashboardCredential | null,
  text: string,
  signal?: AbortSignal,
  deps: SelfWorkflowRouteDeps = {},
): Promise<SelfRouteResult> {
  const prepared = prelude(credential, text, deps);
  if (!prepared.ok) return prepared.result;
  const { caller, body, jobs } = prepared;
  const itemId = requiredBodyString(body, 'itemId', 200);
  if (!itemId.ok) return itemId.result;
  if (caller.issueId === null) return { status: 409, body: NO_ISSUE };
  return startSelfJobAnswer(jobs, caller, 'task-done', [{ ref: caller.issueId }, { ref: itemId.value }, { switch: 'json' }], {}, signal);
}

/** `body.on`: undefined → []; else an array of at most 20 non-empty, at-most-500-char strings, else the refusal. */
function parseOn(body: Record<string, unknown>): { ok: true; value: readonly string[] } | { ok: false; result: SelfRouteResult } {
  const on = body['on'];
  if (on === undefined) return { ok: true, value: [] };
  const bad = { ok: false, result: badRequest('on must be a list of at most 20 issue or PR references') } as const;
  if (!Array.isArray(on) || on.length > 20) return bad;
  for (const value of on) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500) return bad;
  }
  return { ok: true, value: on as readonly string[] };
}

export async function handleSelfTaskBlock(
  credential: DashboardCredential | null,
  text: string,
  signal?: AbortSignal,
  deps: SelfWorkflowRouteDeps = {},
): Promise<SelfRouteResult> {
  const prepared = prelude(credential, text, deps);
  if (!prepared.ok) return prepared.result;
  const { caller, body, jobs } = prepared;
  const itemId = requiredBodyString(body, 'itemId', 200);
  if (!itemId.ok) return itemId.result;
  const on = parseOn(body);
  if (!on.ok) return on.result;
  if (caller.issueId === null) return { status: 409, body: NO_ISSUE };
  const args: SelfJobArg[] = [{ ref: caller.issueId }, { ref: itemId.value }, ...on.value.map((value) => ({ flag: 'on', value })), { switch: 'json' }];
  return startSelfJobAnswer(jobs, caller, 'task-block', args, {}, signal);
}

export async function handleSelfDone(
  credential: DashboardCredential | null,
  text: string,
  signal?: AbortSignal,
  deps: SelfWorkflowRouteDeps = {},
): Promise<SelfRouteResult> {
  const prepared = prelude(credential, text, deps);
  if (!prepared.ok) return prepared.result;
  const { caller, jobs } = prepared;
  if (caller.issueId === null) return { status: 409, body: NO_ISSUE };
  return startSelfJobAnswer(jobs, caller, 'done', [{ ref: caller.issueId }], {}, signal);
}

export function makeSelfWorkflowRouteLayer(deps: SelfWorkflowRouteDeps = {}) {
  const selfTaskClaimRoute = HttpRouter.add(
    'POST',
    '/api/self/tasks/claim',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const text = yield* request.text;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfTaskClaim(credential, text, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const selfTaskDoneRoute = HttpRouter.add(
    'POST',
    '/api/self/tasks/done',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const text = yield* request.text;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfTaskDone(credential, text, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const selfTaskBlockRoute = HttpRouter.add(
    'POST',
    '/api/self/tasks/block',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const text = yield* request.text;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfTaskBlock(credential, text, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const selfDoneRoute = HttpRouter.add(
    'POST',
    '/api/self/done',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const text = yield* request.text;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfDone(credential, text, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(selfTaskClaimRoute, selfTaskDoneRoute, selfTaskBlockRoute, selfDoneRoute);
}

export const selfWorkflowRouteLayer = makeSelfWorkflowRouteLayer();
