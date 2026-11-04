/**
 * `GET /api/agent-requests`, `POST /api/agent-requests/:id/secret` and
 * `POST /api/agent-requests/:id/decline` (PAN-4927 W-SEC1, D-4, D-7, D-10):
 * the operator's side of agent requests.
 *
 * The list route (`read:conversations`) answers the pending requests for the
 * Decisions panel: never a value, a result or an owner directory.
 *
 * The answer routes have no route-scope row, so the gate refuses every
 * registry credential (token, device, machine, phone) with 403
 * `insufficient_scope`, and the handler accepts only the internal token or
 * the root session (403 `root-only`) as a second line (D-4): a secret comes
 * from the operator at this machine. Both call
 * `rejectUnsafeDashboardMutationRequest` first, because a root session is a
 * cookie, and answer `Cache-Control: no-store`.
 *
 * Delivery writes the value to `<owner dir>/secrets/<name>` (0600 in a 0700
 * directory) and marks the request `delivered`. An agent that no longer
 * holds an active agent token gets no file: its request is marked `expired`
 * and the answer is 409 `agent-stopped` (D-7). The value is never logged,
 * never echoed and never put in an error: a parse error is swallowed, and a
 * failed write logs only the error's name.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { listAccessTokens } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { jsonResponse } from '../http-helpers.js';
import {
  type AgentRequests,
  agentRequests,
  SECRET_VALUE_MAX_BYTES,
  writeAgentSecretFile,
} from '../services/agent-requests.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { SelfRouteResult } from './self-jobs.js';
import { UNKNOWN_REQUEST } from './self-requests.js';

export interface AgentRequestsRouteDeps {
  requests?: AgentRequests;
  /** D-7: whether the agent or conversation still holds an active (not revoked) agent token. */
  hasActiveAgentToken?: (agentId: string, agentKind: 'agent' | 'conversation') => Promise<boolean>;
}

/** A pending request as the list route answers it. */
export interface AgentRequestRow {
  id: string;
  kind: string;
  agentId: string;
  agentKind: 'agent' | 'conversation';
  label: string;
  name?: string;
  prompt?: string;
  createdAt: string;
  expiresAt: string;
}

const ROOT_ONLY = { error: 'only the internal token or the root session can answer agent requests', code: 'root-only' } as const;
const BAD_VALUE = { error: `value must be a non-empty string of at most ${SECRET_VALUE_MAX_BYTES} bytes`, code: 'bad-value' } as const;
const WRONG_KIND = { error: 'request is not a secret request', code: 'wrong-kind' } as const;
const AGENT_STOPPED = { error: 'the agent stopped; its request expired', code: 'agent-stopped' } as const;
const WRITE_FAILED = { error: 'could not write the secret file', code: 'write-failed' } as const;

async function defaultHasActiveAgentToken(agentId: string, agentKind: 'agent' | 'conversation'): Promise<boolean> {
  return (await listAccessTokens()).some((record) =>
    record.kind === 'token' && !record.revokedAt && record.agentId === agentId && record.agentKind === agentKind);
}

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

/** A JSON object, or null for anything else. Never throws, so a parse error cannot quote the body. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isRootCredential(credential: DashboardCredential | null): boolean {
  return credential?.kind === 'internal-token' || credential?.kind === 'root-session';
}

/** The held request when it is a pending secret request, else the refusal for it. */
function pendingSecret(requests: AgentRequests, id: string):
  | { ok: true; held: NonNullable<ReturnType<AgentRequests['getForAnswer']>> }
  | { ok: false; result: SelfRouteResult } {
  const held = requests.getForAnswer(id);
  if (!held) return { ok: false, result: { status: 404, body: UNKNOWN_REQUEST } };
  if (held.view.kind !== 'secret') return { ok: false, result: { status: 409, body: WRONG_KIND } };
  if (held.view.status !== 'pending') {
    return { ok: false, result: { status: 409, body: { error: `request is ${held.view.status}`, code: 'not-pending', status: held.view.status } } };
  }
  return { ok: true, held };
}

/** `GET /api/agent-requests`. */
export function handleAgentRequestList(deps: AgentRequestsRouteDeps = {}): SelfRouteResult {
  const rows: AgentRequestRow[] = (deps.requests ?? agentRequests).listPending().map((view) => ({
    id: view.id,
    kind: view.kind,
    agentId: view.agentId,
    agentKind: view.agentKind,
    label: view.label,
    name: view.name,
    prompt: view.prompt,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
  }));
  return { status: 200, body: { requests: rows } };
}

/** `POST /api/agent-requests/:id/secret` with `{ value }`. */
export async function handleAgentRequestSecret(
  credential: DashboardCredential | null,
  id: string,
  bodyText: string,
  deps: AgentRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  if (!isRootCredential(credential)) return { status: 403, body: ROOT_ONLY };
  const value = parseJsonObject(bodyText)?.value;
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > SECRET_VALUE_MAX_BYTES) {
    return { status: 400, body: BAD_VALUE };
  }

  const requests = deps.requests ?? agentRequests;
  const found = pendingSecret(requests, id);
  if (!found.ok) return found.result;
  const { view, ownerDir } = found.held;
  const name = view.name ?? '';

  const hasActiveAgentToken = deps.hasActiveAgentToken ?? defaultHasActiveAgentToken;
  if (!(await hasActiveAgentToken(view.agentId, view.agentKind))) {
    requests.settle(id, 'expired');
    return { status: 409, body: AGENT_STOPPED };
  }

  let file: string;
  try {
    file = await writeAgentSecretFile(ownerDir, name, value);
  } catch (error) {
    // The name only: an fs message can quote input.
    console.warn(`[agent-requests] secret write failed for ${id}: ${(error as Error).name}`);
    return { status: 500, body: WRITE_FAILED };
  }

  if (!requests.settle(id, 'delivered', { file })) {
    const status = requests.getForAnswer(id)?.view.status ?? 'expired';
    return { status: 409, body: { error: `request is ${status}`, code: 'not-pending', status } };
  }
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Secret ${name} delivered to ${view.label}` });
  return { status: 200, body: { requestId: id, status: 'delivered' } };
}

/** `POST /api/agent-requests/:id/decline`. */
export function handleAgentRequestDecline(
  credential: DashboardCredential | null,
  id: string,
  deps: AgentRequestsRouteDeps = {},
): SelfRouteResult {
  if (!isRootCredential(credential)) return { status: 403, body: ROOT_ONLY };
  const requests = deps.requests ?? agentRequests;
  const found = pendingSecret(requests, id);
  if (!found.ok) return found.result;
  requests.settle(id, 'declined');
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Secret ${found.held.view.name ?? ''} declined for ${found.held.view.label}` });
  return { status: 200, body: { requestId: id, status: 'declined' } };
}

export function makeAgentRequestsRouteLayer(deps: AgentRequestsRouteDeps = {}) {
  const listAgentRequestsRoute = HttpRouter.add(
    'GET',
    '/api/agent-requests',
    httpHandler(Effect.sync(() => {
      const result = handleAgentRequestList(deps);
      return noStore(jsonResponse(result.body, { status: result.status }));
    })),
  );

  const answerSecretRequestRoute = HttpRouter.add(
    'POST',
    '/api/agent-requests/:id/secret',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = rejectUnsafeDashboardMutationRequest(request);
      if (authError) return noStore(authError);
      const params = yield* HttpRouter.params;
      const credential = resolveRequestCredential(request);
      const bodyText = yield* request.text;
      const result = yield* Effect.promise(() => handleAgentRequestSecret(credential, params['id'] ?? '', bodyText, deps));
      return noStore(jsonResponse(result.body, { status: result.status }));
    })),
  );

  const declineAgentRequestRoute = HttpRouter.add(
    'POST',
    '/api/agent-requests/:id/decline',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = rejectUnsafeDashboardMutationRequest(request);
      if (authError) return noStore(authError);
      const params = yield* HttpRouter.params;
      const result = handleAgentRequestDecline(resolveRequestCredential(request), params['id'] ?? '', deps);
      return noStore(jsonResponse(result.body, { status: result.status }));
    })),
  );

  return Layer.mergeAll(listAgentRequestsRoute, answerSecretRequestRoute, declineAgentRequestRoute);
}

export const agentRequestsRouteLayer = makeAgentRequestsRouteLayer();
