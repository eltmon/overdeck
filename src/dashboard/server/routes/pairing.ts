/**
 * Device pairing routes (PAN-3762 FR-7, NFR-2).
 *
 * - `POST /api/pairing/credentials` issues a one-time `odp_` credential. Only
 *   the internal token or the root session may call it (plus CSRF for the
 *   cookie); a paired device or an access token gets 403, so neither can mint
 *   more devices (PAN-2351 D-11).
 * - `POST /api/pairing/exchange` trades the credential for the caller's own
 *   revocable `odk_` device token, delivered as the `overdeck_device` cookie
 *   (browsers) or in the body (`delivery: 'bearer'`, desktop clients). It is
 *   unauthenticated by design and rate limited on failures.
 *
 * - `GET /api/devices` lists paired devices (never their token hashes).
 * - `DELETE /api/devices/:id` revokes one and closes its live WebSocket and
 *   SSE connections. A device may revoke itself but not another device, an
 *   access token may revoke none, and the internal token and root session may
 *   revoke any.
 *
 * No pairing response is cacheable, and none ever contains the internal token.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { createAccessToken, listAccessTokens, revokeAccessToken, type PublicAccessTokenRecord } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import {
  consumePairingCredential,
  isPairingExchangeRateLimited,
  issuePairingCredential,
  recordPairingExchangeFailure,
} from '../pairing-credentials.js';
import {
  dashboardCsrfToken,
  dashboardDeviceCookieHeader,
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveDashboardCredential,
} from './dashboard-auth.js';
import { isHttpsRequest } from './dashboard-session.js';
import { validateOrigin, type HeaderMap } from './origin-validation.js';

const MAX_LABEL_LENGTH = 200;

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

function optionalLabel(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_LABEL_LENGTH) return null;
  return value.trim();
}

const issuePairingCredentialRoute = HttpRouter.add(
  'POST',
  '/api/pairing/credentials',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    // PAN-2351 D-11: only root credentials mint new devices.
    const issuer = resolveDashboardCredential(request.headers as HeaderMap)?.kind;
    if (issuer !== 'internal-token' && issuer !== 'root-session') {
      return noStore(jsonResponse({ error: 'only the internal token or the root session can issue pairing credentials' }, { status: 403 }));
    }

    const body = parseJsonObject(yield* request.text);
    const label = optionalLabel(body?.label);
    if (!body || label === null) {
      return noStore(jsonResponse({ error: `body must be a JSON object; label, when given, is a non-empty string of at most ${MAX_LABEL_LENGTH} characters` }, { status: 400 }));
    }

    const { credential, expiresAt } = issuePairingCredential();
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: label ? `Issued a pairing credential for "${label}"` : 'Issued a pairing credential',
      details: JSON.stringify({ expiresAt }),
    });
    return noStore(jsonResponse({ credential, expiresAt, pairingPath: `/#pair=${credential}` }));
  }),
);

const exchangePairingCredentialRoute = HttpRouter.add(
  'POST',
  '/api/pairing/exchange',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return noStore(jsonResponse({ error: originCheck.error }, { status: 403 }));
    if (isPairingExchangeRateLimited()) {
      return noStore(jsonResponse({ error: 'too many failed pairing attempts; try again in a minute' }, { status: 429 }));
    }

    const body = parseJsonObject(yield* request.text);
    const label = optionalLabel(body?.label);
    const credential = body?.credential;
    const delivery = body?.delivery;
    if (!body || typeof credential !== 'string' || !label || (delivery !== 'cookie' && delivery !== 'bearer')) {
      return noStore(jsonResponse({ error: `body must be { credential: string, label: string (at most ${MAX_LABEL_LENGTH} characters), delivery: 'cookie' | 'bearer' }` }, { status: 400 }));
    }

    const outcome = consumePairingCredential(credential);
    if (outcome !== 'ok') {
      recordPairingExchangeFailure();
      return outcome === 'expired'
        ? noStore(jsonResponse({ error: 'pairing credential expired; run pan pair again' }, { status: 410 }))
        : noStore(jsonResponse({ error: 'unknown or already used pairing credential' }, { status: 401 }));
    }

    const { token, record } = yield* Effect.promise(() => createAccessToken({ name: label, scopes: ['admin'], kind: 'device' }));
    const { environmentId } = yield* Effect.promise(() => ensureEnvironmentIdentity());
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Paired device "${label}"`,
      details: JSON.stringify({ deviceId: record.id, environmentId }),
    });

    const payload = { deviceId: record.id, environmentId, csrfToken: dashboardCsrfToken() };
    if (delivery === 'bearer') return noStore(jsonResponse({ ...payload, token }));
    return noStore(HttpServerResponse.setHeader(
      jsonResponse(payload),
      'Set-Cookie',
      dashboardDeviceCookieHeader(token, { secure: isHttpsRequest(request) }),
    ));
  }),
);

function deviceView(record: PublicAccessTokenRecord) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt ?? null,
  };
}

const listDevicesRoute = HttpRouter.add(
  'GET',
  '/api/devices',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const records = yield* Effect.promise(() => listAccessTokens());
    return noStore(jsonResponse({ devices: records.filter((record) => record.kind === 'device').map(deviceView) }));
  }),
);

const revokeDeviceRoute = HttpRouter.add(
  'DELETE',
  '/api/devices/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const credential = resolveDashboardCredential(request.headers as HeaderMap);
    // PAN-2351 D-11: checked before the lookup, so a token cannot probe device ids.
    if (credential?.kind === 'token') {
      return noStore(jsonResponse({ error: 'an access token cannot revoke devices' }, { status: 403 }));
    }

    const records = yield* Effect.promise(() => listAccessTokens());
    const target = records.find((record) => record.id === id && record.kind === 'device');
    if (!target) return noStore(jsonResponse({ error: `no paired device with id ${id}` }, { status: 404 }));

    if (credential?.kind === 'device' && credential.deviceId !== id) {
      return noStore(jsonResponse({ error: 'a paired device may revoke only itself' }, { status: 403 }));
    }

    const revoked = yield* Effect.promise(() => revokeAccessToken(id));
    if (!revoked) return noStore(jsonResponse({ error: `no paired device with id ${id}` }, { status: 404 }));
    const closed = closeDeviceConnections(id);
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Revoked device "${revoked.name}"`,
      details: JSON.stringify({ deviceId: id, closedConnections: closed }),
    });
    return noStore(jsonResponse({ ok: true, device: deviceView(revoked) }));
  }),
);

export const pairingRouteLayer = Layer.mergeAll(
  issuePairingCredentialRoute,
  exchangePairingCredentialRoute,
  listDevicesRoute,
  revokeDeviceRoute,
);
