/**
 * The dashboard session mint: `OPTIONS` and `POST /api/dashboard/session`.
 *
 * Moved out of `server.ts` (PAN-3762) so the mint can be tested as a route. A
 * trusted caller (internal token, root session, or a loopback peer) gets the
 * root `overdeck_session` cookie plus the CSRF token. A paired device gets the
 * CSRF token and a refreshed `overdeck_device` cookie, and never the root
 * session cookie (FR-16), so revoking the device still cuts it off.
 */
import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import {
  dashboardCsrfToken,
  dashboardDeviceCookieHeader,
  dashboardDeviceTokenFromHeaders,
  dashboardSessionCookieHeader,
  rejectUnauthorizedDashboardRequest,
  rejectUnauthorizedDashboardSessionMintRequest,
  resolveDashboardCredential,
} from './dashboard-auth.js';
import { validateOrigin, type HeaderMap } from './origin-validation.js';

function requestHeader(request: HttpServerRequest.HttpServerRequest, name: string): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

function allowDashboardSessionCors(
  response: HttpServerResponse.HttpServerResponse,
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse {
  const origin = requestHeader(request, 'origin');
  if (!origin) return response;
  return HttpServerResponse.setHeader(
    HttpServerResponse.setHeader(
      HttpServerResponse.setHeader(
        HttpServerResponse.setHeader(response, 'Access-Control-Allow-Origin', origin),
        'Access-Control-Allow-Credentials',
        'true',
      ),
      'Access-Control-Allow-Headers',
      'x-overdeck-internal-token, x-overdeck-csrf-token, authorization, content-type',
    ),
    'Vary',
    'Origin',
  );
}

export function isHttpsRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const forwardedProto = requestHeader(request, 'x-forwarded-proto');
  if (forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  return HttpServerRequest.toURL(request).pipe(Option.match({
    onNone: () => false,
    onSome: (url) => url.protocol === 'https:',
  }));
}

export const dashboardSessionPreflightRouteLayer = HttpRouter.add(
  'OPTIONS',
  '/api/dashboard/session',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    return allowDashboardSessionCors(
      HttpServerResponse.setHeader(jsonResponse({ ok: true }), 'Access-Control-Allow-Methods', 'POST, OPTIONS'),
      request,
    );
  }),
);

export const dashboardSessionRouteLayer = HttpRouter.add(
  'POST',
  '/api/dashboard/session',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const headers = request.headers as HeaderMap;
    const credential = resolveDashboardCredential(headers);
    // PAN-2351 D-12: a token never mints a session. This runs before the
    // loopback mint check, so peer trust cannot turn a token into root.
    if (credential?.kind === 'token') {
      return HttpServerResponse.setHeader(
        jsonResponse({ error: 'an access token cannot mint a dashboard session; send it as Authorization: Bearer on each request' }, { status: 403 }),
        'Cache-Control',
        'no-store',
      );
    }
    const deviceToken = credential?.kind === 'device' ? dashboardDeviceTokenFromHeaders(headers) : undefined;
    if (deviceToken) {
      const response = HttpServerResponse.setHeader(
        jsonResponse({ ok: true, csrfToken: dashboardCsrfToken() }),
        'Set-Cookie',
        dashboardDeviceCookieHeader(deviceToken, { secure: isHttpsRequest(request) }),
      );
      return allowDashboardSessionCors(
        HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store'),
        request,
      );
    }

    const mintAuthError = rejectUnauthorizedDashboardSessionMintRequest(request);
    const sessionAuthError = rejectUnauthorizedDashboardRequest(request);
    if (mintAuthError && sessionAuthError) return mintAuthError;

    let response = jsonResponse({ ok: true, csrfToken: dashboardCsrfToken() });
    // Re-issue the durable session cookie on every successful mint — not only when
    // the one-time internal token is present. We only reach here if at least one of
    // mint/session auth passed, so the caller is already trusted; refreshing the
    // cookie gives an in-use session a rolling Max-Age instead of letting it lapse.
    response = HttpServerResponse.setHeader(
      response,
      'Set-Cookie',
      dashboardSessionCookieHeader({ secure: isHttpsRequest(request) }),
    );

    return allowDashboardSessionCors(
      HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store'),
      request,
    );
  }),
);
