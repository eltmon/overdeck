/**
 * Scoped access-token routes (PAN-2351 FR-1, FR-4, D-11).
 *
 * - `GET /api/access-tokens` lists `kind: 'token'` records (never their hashes).
 * - `POST /api/access-tokens` creates one from `{ name, scopes }` and returns
 *   the plaintext exactly once. Only the internal token or the root session
 *   may call it; a device or token credential gets 403, even with `admin`.
 * - `DELETE /api/access-tokens/:id` revokes one and closes its live WebSocket
 *   and SSE connections at once. Root credentials only, as for creation.
 *
 * Paired devices live in the same registry but have their own routes
 * (`routes/pairing.ts`); these routes answer 404 for a device id. No response
 * is cacheable, and no activity entry carries a plaintext token.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  createAccessToken,
  listAccessTokens,
  parseAccessTokenScopes,
  revokeAccessToken,
  type AccessTokenScope,
} from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest, resolveDashboardCredential } from './dashboard-auth.js';
import type { HeaderMap } from './origin-validation.js';

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A 403 unless the request carries a root credential (PAN-2351 D-11). */
function rejectNonRootCredential(request: HttpServerRequest.HttpServerRequest, action: string): HttpServerResponse.HttpServerResponse | null {
  const kind = resolveDashboardCredential(request.headers as HeaderMap)?.kind;
  if (kind === 'internal-token' || kind === 'root-session') return null;
  return noStore(jsonResponse({ error: `only the internal token or the root session can ${action} access tokens` }, { status: 403 }));
}

const listAccessTokensRoute = HttpRouter.add(
  'GET',
  '/api/access-tokens',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const records = yield* Effect.promise(() => listAccessTokens());
    return noStore(jsonResponse({ tokens: records.filter((record) => record.kind === 'token') }));
  }),
);

const createAccessTokenRoute = HttpRouter.add(
  'POST',
  '/api/access-tokens',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const rootError = rejectNonRootCredential(request, 'create');
    if (rootError) return rootError;

    const body = parseJsonObject(yield* request.text);
    if (!body || typeof body.name !== 'string' || !Array.isArray(body.scopes) || !body.scopes.every((scope) => typeof scope === 'string')) {
      return noStore(jsonResponse({ error: 'body must be { name: string, scopes: string[] }' }, { status: 400 }));
    }
    let scopes: AccessTokenScope[];
    try {
      scopes = parseAccessTokenScopes(body.scopes as string[]);
    } catch (error) {
      return noStore(jsonResponse({ error: (error as Error).message }, { status: 400 }));
    }
    const name = body.name;
    const created = yield* Effect.promise(() => createAccessToken({ name, scopes, kind: 'token' }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: error as Error }),
    ));
    if (!created.ok) return noStore(jsonResponse({ error: created.error.message }, { status: 400 }));

    const { token, record } = created.value;
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Created access token "${record.name}" (${record.scopes.join(', ')})`,
      details: JSON.stringify({ tokenId: record.id, scopes: record.scopes }),
    });
    return noStore(jsonResponse({ token, record }));
  }),
);

const revokeAccessTokenRoute = HttpRouter.add(
  'DELETE',
  '/api/access-tokens/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const rootError = rejectNonRootCredential(request, 'revoke');
    if (rootError) return rootError;
    const id = (yield* HttpRouter.params)['id'] ?? '';

    const records = yield* Effect.promise(() => listAccessTokens());
    if (!records.some((record) => record.id === id && record.kind === 'token')) {
      return noStore(jsonResponse({ error: `no access token with id ${id}` }, { status: 404 }));
    }
    const revoked = yield* Effect.promise(() => revokeAccessToken(id));
    if (!revoked) return noStore(jsonResponse({ error: `no access token with id ${id}` }, { status: 404 }));
    const closed = closeDeviceConnections(id);
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Revoked access token "${revoked.name}"`,
      details: JSON.stringify({ tokenId: id, closedConnections: closed }),
    });
    return noStore(jsonResponse({ ok: true, token: revoked, closedConnections: closed }));
  }),
);

export const accessTokensRouteLayer = Layer.mergeAll(
  listAccessTokensRoute,
  createAccessTokenRoute,
  revokeAccessTokenRoute,
);
