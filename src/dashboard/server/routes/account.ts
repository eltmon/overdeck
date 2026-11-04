/**
 * The Settings → Anywhere Account card's routes (PRD PAN-4960 WI-4, WI-6, FR-5, FR-6, FR-8).
 *
 * - `GET /api/account` answers the card's data: admin only (no ROUTE_SCOPES row), and never from
 *   a secure channel, because a linked machine must not read this machine's account. `canSignIn`
 *   is true only for a root session from a trusted local request (D-4), so the card never offers
 *   Sign in to a viewer whose browser the loopback callback cannot reach.
 * - `POST /api/account/sign-in` starts the PKCE loopback flow: mutation guard, then root
 *   credentials, then a trusted local request (D-4). It answers only the authorize URL; the code
 *   verifier stays in the sign-in service (NFR-1).
 * - `GET /oauth/account/callback` is the loopback `redirect_uri`. It sits outside `/api/`, so the
 *   remote request gate does not judge it; it answers only a direct loopback peer (D-1) and
 *   renders a small HTML page (D-15).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { escapeHtml } from '../../../lib/mcp/oauth-flow.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { isTrustedLocalRequest } from '../remote-request-gate.js';
import { accountSignInService, CALLBACK_PATH, type CallbackResult } from '../services/account-sign-in.js';
import { accountViewService } from '../services/account-view.js';
import {
  hasProxyForwardingHeader,
  isLoopbackPeer,
  isTailscaleFunnelRequest,
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveRequestCredential,
} from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { HeaderMap } from './origin-validation.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};
const TRY_AGAIN = 'Go back to Settings → Anywhere in Overdeck and click Sign in to try again.';

const viewRoute = HttpRouter.add(
  'GET',
  '/api/account',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot read this account here' }, { status: 403 });
    }
    const refused = rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    const canSignIn = resolveRequestCredential(request)?.kind === 'root-session' && isTrustedLocalRequest(request);
    const signIn = accountSignInService().view(canSignIn);
    const view = yield* Effect.promise(() => accountViewService().view({ canSignIn, signIn }));
    return jsonResponse(view, { headers: NO_STORE });
  })),
);

const signInRoute = HttpRouter.add(
  'POST',
  '/api/account/sign-in',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const kind = resolveRequestCredential(request)?.kind;
    if (kind !== 'root-session' && kind !== 'internal-token') {
      return jsonResponse({ error: 'Only this machine can sign in to overdeck.ai.' }, { status: 403, headers: NO_STORE });
    }
    if (!isTrustedLocalRequest(request)) {
      return jsonResponse(
        { error: 'Sign in from a browser on this machine; the sign-in returns to 127.0.0.1.' },
        { status: 403, headers: NO_STORE },
      );
    }
    const result = yield* Effect.promise(() => accountSignInService().begin());
    if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status, headers: NO_STORE });
    return jsonResponse({ authorizeUrl: result.authorizeUrl }, { headers: NO_STORE });
  })),
);

function page(title: string, body: string, status: number): HttpServerResponse.HttpServerResponse {
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    '<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>' +
    `</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  return HttpServerResponse.text(html, { status, contentType: 'text/html; charset=utf-8', headers: PAGE_HEADERS });
}

/** D-15: the page the browser lands on after overdeck.ai. */
export function callbackPage(result: CallbackResult): HttpServerResponse.HttpServerResponse {
  switch (result.kind) {
    case 'succeeded': {
      const who = result.githubLogin ? ` as ${escapeHtml(result.githubLogin)}` : '';
      return page('Signed in to overdeck.ai', `<p>Signed in to overdeck.ai${who}. You can close this tab and go back to Overdeck.</p>`, 200);
    }
    case 'failed':
      return page('Sign-in did not finish', `<p>${escapeHtml(result.message)}</p><p>${escapeHtml(TRY_AGAIN)}</p>`, 200);
    case 'expired':
      return page('Sign-in link expired', `<p>This sign-in link expired or was already used. ${escapeHtml(TRY_AGAIN)}</p>`, 400);
  }
}

const callbackRoute = HttpRouter.add(
  'GET',
  CALLBACK_PATH,
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = request.headers as HeaderMap;
    // D-1: a real callback is a direct browser hit on 127.0.0.1 and never carries forwarding headers.
    if (!isLoopbackPeer(request) || hasProxyForwardingHeader(headers) || isTailscaleFunnelRequest(headers)) {
      return jsonResponse({ error: 'not found' }, { status: 404 });
    }
    const query = new URL(request.url, 'http://local').searchParams;
    const result = yield* Effect.promise(() => accountSignInService().complete(query));
    return callbackPage(result);
  })),
);

export const accountRouteLayer = Layer.mergeAll(viewRoute, signInRoute, callbackRoute);
