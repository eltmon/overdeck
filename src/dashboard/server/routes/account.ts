/**
 * The Settings → Anywhere Account card's routes (PRD PAN-4960 WI-4, FR-8).
 *
 * `GET /api/account` answers the card's data: admin only (no ROUTE_SCOPES row), and never from a
 * secure channel, because a linked machine must not read this machine's account. `canSignIn` is
 * true only for a root session from a trusted local request (D-4), so the card never offers the
 * Sign in button to a viewer whose browser the loopback callback cannot reach.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { isTrustedLocalRequest } from '../remote-request-gate.js';
import { accountViewService } from '../services/account-view.js';
import { rejectUnauthorizedDashboardRequest, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

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
    const view = yield* Effect.promise(() =>
      accountViewService().view({ canSignIn, signIn: { state: 'idle', authorizeUrl: null, message: null } }),
    );
    return jsonResponse(view, { headers: { 'Cache-Control': 'no-store' } });
  })),
);

export const accountRouteLayer = Layer.mergeAll(viewRoute);
