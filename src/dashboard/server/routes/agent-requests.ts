/**
 * `GET /api/agent-requests`, `POST /api/agent-requests/:id/secret`,
 * `POST /api/agent-requests/:id/linked` and
 * `POST /api/agent-requests/:id/decline` (PAN-4927 W-SEC1, D-4, D-7, D-10;
 * PAN-4942 W-LINK1, D-6, D-7, D-8): the operator's side of agent requests.
 *
 * The list route (`read:conversations`) answers the pending requests for the
 * Decisions panel, with a secret request's name and prompt or a machine-link
 * request's hint: never a value, a result or an owner directory.
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
 *
 * `/linked` resolves a machine-link request after the operator linked a
 * machine. It reads only `environmentId` from the body and takes the label
 * from the active link with that environment id, so a pairing link or a
 * label in the body is never stored, echoed or logged. An unknown or revoked
 * environment id is 400 `unknown-machine`; a stopped agent gets 409
 * `agent-stopped`, and the machine stays linked. `/decline` declines a
 * pending request of either kind.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { listAccessTokens } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { listLinks } from '../../../lib/anywhere/link-store.js';
import { jsonResponse } from '../http-helpers.js';
import {
  type AgentRequestKind,
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
  /** W-LINK1 D-6: the active (not revoked) link with this environment id, or null. */
  findActiveLink?: (environmentId: string) => Promise<{ environmentId: string; label: string } | null>;
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
  /** Machine-link requests only. */
  hint?: string;
  createdAt: string;
  expiresAt: string;
}

const ROOT_ONLY = { error: 'only the internal token or the root session can answer agent requests', code: 'root-only' } as const;
const BAD_VALUE = { error: `value must be a non-empty string of at most ${SECRET_VALUE_MAX_BYTES} bytes`, code: 'bad-value' } as const;
const BAD_ENVIRONMENT_ID = { error: 'environmentId must be a string of 1 to 200 characters', code: 'bad-environment-id' } as const;
const UNKNOWN_MACHINE = { error: 'no active link to that machine', code: 'unknown-machine' } as const;
const AGENT_STOPPED = { error: 'the agent stopped; its request expired', code: 'agent-stopped' } as const;
const WRITE_FAILED = { error: 'could not write the secret file', code: 'write-failed' } as const;

async function defaultHasActiveAgentToken(agentId: string, agentKind: 'agent' | 'conversation'): Promise<boolean> {
  return (await listAccessTokens()).some((record) =>
    record.kind === 'token' && !record.revokedAt && record.agentId === agentId && record.agentKind === agentKind);
}

async function defaultFindActiveLink(environmentId: string): Promise<{ environmentId: string; label: string } | null> {
  const link = (await listLinks()).find((l) => l.environmentId === environmentId && l.revokedAt === null);
  return link ? { environmentId: link.environmentId, label: link.label } : null;
}

function notPending(status: string): SelfRouteResult {
  return { status: 409, body: { error: `request is ${status}`, code: 'not-pending', status } };
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

/** The held request when it is pending (and of `kind`, when given), else the refusal for it. */
function pendingRequest(requests: AgentRequests, id: string, kind?: AgentRequestKind):
  | { ok: true; held: NonNullable<ReturnType<AgentRequests['getForAnswer']>> }
  | { ok: false; result: SelfRouteResult } {
  const held = requests.getForAnswer(id);
  if (!held) return { ok: false, result: { status: 404, body: UNKNOWN_REQUEST } };
  if (kind && held.view.kind !== kind) {
    return { ok: false, result: { status: 409, body: { error: `request is not a ${kind} request`, code: 'wrong-kind' } } };
  }
  if (held.view.status !== 'pending') return { ok: false, result: notPending(held.view.status) };
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
    hint: view.hint,
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
  const found = pendingRequest(requests, id, 'secret');
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

  if (!requests.settle(id, 'delivered', { file })) return notPending(requests.getForAnswer(id)?.view.status ?? 'expired');
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Secret ${name} delivered to ${view.label}` });
  return { status: 200, body: { requestId: id, status: 'delivered' } };
}

/** `POST /api/agent-requests/:id/linked` with `{ environmentId }`; every other body field is ignored. */
export async function handleAgentRequestLinked(
  credential: DashboardCredential | null,
  id: string,
  bodyText: string,
  deps: AgentRequestsRouteDeps = {},
): Promise<SelfRouteResult> {
  if (!isRootCredential(credential)) return { status: 403, body: ROOT_ONLY };
  const environmentId = parseJsonObject(bodyText)?.environmentId;
  if (typeof environmentId !== 'string' || environmentId.length < 1 || environmentId.length > 200) {
    return { status: 400, body: BAD_ENVIRONMENT_ID };
  }

  const requests = deps.requests ?? agentRequests;
  const found = pendingRequest(requests, id, 'machine-link');
  if (!found.ok) return found.result;
  const { view } = found.held;

  const link = await (deps.findActiveLink ?? defaultFindActiveLink)(environmentId);
  if (!link) return { status: 400, body: UNKNOWN_MACHINE };
  const machine = { environmentId: link.environmentId, label: link.label };

  const hasActiveAgentToken = deps.hasActiveAgentToken ?? defaultHasActiveAgentToken;
  if (!(await hasActiveAgentToken(view.agentId, view.agentKind))) {
    requests.settle(id, 'expired');
    return { status: 409, body: AGENT_STOPPED };
  }

  if (!requests.settle(id, 'linked', { machine })) return notPending(requests.getForAnswer(id)?.view.status ?? 'expired');
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Machine ${machine.label} linked for ${view.label}` });
  return { status: 200, body: { requestId: id, status: 'linked', machine } };
}

/** `POST /api/agent-requests/:id/decline`: a pending request of either kind. */
export function handleAgentRequestDecline(
  credential: DashboardCredential | null,
  id: string,
  deps: AgentRequestsRouteDeps = {},
): SelfRouteResult {
  if (!isRootCredential(credential)) return { status: 403, body: ROOT_ONLY };
  const requests = deps.requests ?? agentRequests;
  const found = pendingRequest(requests, id);
  if (!found.ok) return found.result;
  const { view } = found.held;
  requests.settle(id, 'declined');
  const message = view.kind === 'secret' ? `Secret ${view.name ?? ''} declined for ${view.label}` : `Machine link declined for ${view.label}`;
  emitActivityEntry({ source: 'dashboard', level: 'info', message });
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

  const linkedAgentRequestRoute = HttpRouter.add(
    'POST',
    '/api/agent-requests/:id/linked',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = rejectUnsafeDashboardMutationRequest(request);
      if (authError) return noStore(authError);
      const params = yield* HttpRouter.params;
      const credential = resolveRequestCredential(request);
      const bodyText = yield* request.text;
      const result = yield* Effect.promise(() => handleAgentRequestLinked(credential, params['id'] ?? '', bodyText, deps));
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

  return Layer.mergeAll(listAgentRequestsRoute, answerSecretRequestRoute, linkedAgentRequestRoute, declineAgentRequestRoute);
}

export const agentRequestsRouteLayer = makeAgentRequestsRouteLayer();
