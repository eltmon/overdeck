/**
 * Operator routes for MCP OAuth sign-ins (PAN-4945 D-12).
 *
 * - `GET /api/mcp-oauth/approvals` lists sign-ins waiting for a decision.
 * - `POST /api/mcp-oauth/approvals/:id` approves one at a level, or denies it.
 * - `GET /api/mcp-oauth/sign-ins` lists active sign-ins.
 * - `DELETE /api/mcp-oauth/sign-ins/:familyId` ends one sign-in.
 * - `POST /api/mcp-oauth/issue` creates a headless client and its sign-in and
 *   returns both tokens once.
 *
 * The remote request gate keeps these `admin` (no `route-scopes.ts` row), and
 * each handler further admits only the internal token or the root session, so
 * a paired device with `admin` gets 403 too. No answer is cacheable, and no
 * log line carries a token. `pan mcp oauth` calls these routes.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { mcpOAuthService, type McpOAuthService } from '../../../lib/mcp/oauth-service.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

export interface McpOAuthAdminRouteDeps {
  service: McpOAuthService;
}

const ROOT_ONLY = 'only the internal token or the root session can manage MCP sign-ins';

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function json(data: unknown, status = 200): HttpServerResponse.HttpServerResponse {
  return noStore(jsonResponse(data, { status }));
}

/** The gate's answer, then a 403 unless the request carries a root credential. */
function rejectRequest(request: HttpServerRequest.HttpServerRequest, mutation: boolean): HttpServerResponse.HttpServerResponse | null {
  const authError = mutation ? rejectUnsafeDashboardMutationRequest(request) : rejectUnauthorizedDashboardRequest(request);
  if (authError) return noStore(authError);
  const kind = resolveRequestCredential(request)?.kind;
  return kind === 'internal-token' || kind === 'root-session' ? null : json({ error: ROOT_ONLY }, 403);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function makeMcpOAuthAdminRouteLayer(deps: McpOAuthAdminRouteDeps) {
  const listApprovalsRoute = HttpRouter.add('GET', '/api/mcp-oauth/approvals', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, false);
    if (rejected) return rejected;
    return json({ approvals: deps.service.listApprovals() });
  })));

  const decideApprovalRoute = HttpRouter.add('POST', '/api/mcp-oauth/approvals/:id', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, true);
    if (rejected) return rejected;
    const body = parseJsonObject(yield* request.text);
    if (!body) return json({ error: "body must be { decision: 'approve' | 'deny', level? }" }, 400);
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const result = deps.service.decideApproval(id, body.decision, body.level);
    return result.ok ? json({ status: result.status }) : json({ error: result.error }, result.status);
  })));

  const listSignInsRoute = HttpRouter.add('GET', '/api/mcp-oauth/sign-ins', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, false);
    if (rejected) return rejected;
    return json({ signIns: yield* Effect.promise(() => deps.service.listSignIns()) });
  })));

  const revokeSignInRoute = HttpRouter.add('DELETE', '/api/mcp-oauth/sign-ins/:familyId', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, true);
    if (rejected) return rejected;
    const familyId = (yield* HttpRouter.params)['familyId'] ?? '';
    const revoked = yield* Effect.promise(() => deps.service.revokeFamily(familyId));
    return revoked ? json({ revoked: true }) : json({ error: `no active sign-in ${familyId}` }, 404);
  })));

  const issueRoute = HttpRouter.add('POST', '/api/mcp-oauth/issue', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, true);
    if (rejected) return rejected;
    const body = parseJsonObject(yield* request.text);
    if (!body) return json({ error: 'body must be { name: string, level: string }' }, 400);
    const result = yield* Effect.promise(() => deps.service.issueHeadless(body.name, body.level));
    return result.ok ? json(result.body, 201) : json({ error: result.error }, result.status);
  })));

  return Layer.mergeAll(listApprovalsRoute, decideApprovalRoute, listSignInsRoute, revokeSignInRoute, issueRoute);
}

export const mcpOAuthAdminRouteLayer = makeMcpOAuthAdminRouteLayer({ service: mcpOAuthService });
