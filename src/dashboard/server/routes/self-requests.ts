/**
 * `POST /api/self/secret-requests` and `GET /api/self/secret-requests/:id/wait`
 * (PAN-4927 W-SEC1, D-5, D-6, D-8, D-10, D-11): an agent asks the operator for
 * a secret, then waits for the answer.
 *
 * Auth: the route-scope table maps the ask to `tell` and the wait to
 * `read:state`; the handler then requires an agent token (`self-caller.ts`),
 * so every other credential gets 403 `not-an-agent-token` and a token whose
 * agent is gone gets 404 `agent-gone`. Only a bearer token passes that check,
 * so the ask skips the CSRF helper (D-5). The agent comes from the token,
 * never the request.
 *
 * The ask answers 201 with the new request, or 200 with the agent's pending
 * request for the same name (D-6), plus `next`, the wait call to make. The
 * wait blocks until the request leaves `pending`, it expires, or `timeoutMs`
 * (1..50,000, default 50,000) passes. A delivered request answers the file
 * path, never the value. Requests live in dashboard memory
 * (`services/agent-requests.ts`); after a restart a wait answers 404
 * `unknown-request` (D-8).
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import {
  AGENT_REQUEST_PENDING_LIMIT,
  type AgentRequests,
  agentRequests,
  type AgentRequestView,
  SECRET_NAME_PATTERN,
  SECRET_REQUEST_DEFAULT_TIMEOUT_MS,
  SECRET_REQUEST_MAX_TIMEOUT_MS,
  SECRET_REQUEST_MIN_TIMEOUT_MS,
} from '../services/agent-requests.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { parseWaitTimeoutMs, type SelfRouteResult } from './self-jobs.js';

export interface SelfRequestsRouteDeps {
  requests?: AgentRequests;
  caller?: SelfCallerDeps;
}

export const SECRET_PROMPT_MAX_LENGTH = 300;

const BAD_BODY = { error: 'body must be a JSON object', code: 'bad-body' } as const;
const BAD_NAME = { error: 'name must match ^[A-Z][A-Z0-9_]{0,63}$', code: 'bad-name' } as const;
const BAD_PROMPT = { error: `prompt must be 1 to ${SECRET_PROMPT_MAX_LENGTH} characters`, code: 'bad-prompt' } as const;
const BAD_CREATE_TIMEOUT = {
  error: `timeoutMs must be an integer from ${SECRET_REQUEST_MIN_TIMEOUT_MS} to ${SECRET_REQUEST_MAX_TIMEOUT_MS}`,
  code: 'bad-timeout',
} as const;
const BAD_WAIT_TIMEOUT = { error: 'timeoutMs must be an integer from 1 to 50000', code: 'bad-timeout' } as const;
const TOO_MANY = { error: `this agent already has ${AGENT_REQUEST_PENDING_LIMIT} pending requests`, code: 'too-many-requests' } as const;
export const UNKNOWN_REQUEST = {
  error: 'no such request; a dashboard restart forgets requests, so call request_secret again',
  code: 'unknown-request',
} as const;

/** A JSON object, or null for anything else. Never throws, so a parse error cannot quote the body. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function next(requestId: string) {
  return { tool: 'secret_wait', arguments: { requestId } };
}

/** The wait route's answer for a request view. */
function secretWaitAnswer(view: AgentRequestView): Record<string, unknown> {
  if (view.status === 'pending') return { requestId: view.id, status: 'pending', next: next(view.id) };
  if (view.status === 'delivered') return { requestId: view.id, status: 'delivered', file: view.result?.file };
  return { requestId: view.id, status: view.status };
}

/** `POST /api/self/secret-requests` with `{ name, prompt, timeoutMs? }`. */
export function handleSecretRequestCreate(
  credential: DashboardCredential | null,
  bodyText: string,
  deps: SelfRequestsRouteDeps = {},
): SelfRouteResult {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const { caller } = resolved;

  const body = parseJsonObject(bodyText);
  if (body === null) return { status: 400, body: BAD_BODY };
  const { name, prompt: rawPrompt, timeoutMs: rawTimeout } = body;
  if (typeof name !== 'string' || !SECRET_NAME_PATTERN.test(name)) return { status: 400, body: BAD_NAME };
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
  if (prompt.length < 1 || prompt.length > SECRET_PROMPT_MAX_LENGTH) return { status: 400, body: BAD_PROMPT };
  let timeoutMs = SECRET_REQUEST_DEFAULT_TIMEOUT_MS;
  if (rawTimeout !== undefined) {
    if (
      typeof rawTimeout !== 'number'
      || !Number.isInteger(rawTimeout)
      || rawTimeout < SECRET_REQUEST_MIN_TIMEOUT_MS
      || rawTimeout > SECRET_REQUEST_MAX_TIMEOUT_MS
    ) {
      return { status: 400, body: BAD_CREATE_TIMEOUT };
    }
    timeoutMs = rawTimeout;
  }

  const label = caller.issueId ? `${caller.agentId} · ${caller.issueId}` : caller.agentId;
  const created = (deps.requests ?? agentRequests).createSecret(caller, { name, prompt, timeoutMs, label });
  if (!created.ok) return { status: 429, body: TOO_MANY };
  const { request } = created;
  return {
    status: created.created ? 201 : 200,
    body: { requestId: request.id, status: 'pending', expiresAt: request.expiresAt, next: next(request.id) },
  };
}

/** `GET /api/self/secret-requests/:id/wait?timeoutMs=<1..50000>`. */
export async function handleSecretRequestWait(
  credential: DashboardCredential | null,
  id: string,
  rawTimeout: string | null,
  signal?: AbortSignal,
  deps: SelfRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const timeout = parseWaitTimeoutMs(rawTimeout);
  if (!timeout.ok) return { status: 400, body: BAD_WAIT_TIMEOUT };
  const view = await (deps.requests ?? agentRequests).wait(id, resolved.caller, timeout.value, signal);
  return view ? { status: 200, body: secretWaitAnswer(view) } : { status: 404, body: UNKNOWN_REQUEST };
}

export function makeSelfRequestsRouteLayer(deps: SelfRequestsRouteDeps = {}) {
  const createSecretRequestRoute = HttpRouter.add(
    'POST',
    '/api/self/secret-requests',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bodyText = yield* request.text;
      const result = handleSecretRequestCreate(resolveRequestCredential(request), bodyText, deps);
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  const waitSecretRequestRoute = HttpRouter.add(
    'GET',
    '/api/self/secret-requests/:id/wait',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const url = HttpServerRequest.toURL(request);
      const rawTimeout = Option.isSome(url) ? url.value.searchParams.get('timeoutMs') : null;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSecretRequestWait(credential, params['id'] ?? '', rawTimeout, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(createSecretRequestRoute, waitSecretRequestRoute);
}

export const selfRequestsRouteLayer = makeSelfRequestsRouteLayer();
