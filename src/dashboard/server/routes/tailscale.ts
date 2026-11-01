/**
 * Tailscale routes for Overdeck Anywhere (PAN-1254 FR-11).
 *
 * - `GET /api/tailscale/status` returns `readTailscaleState()` plus how to
 *   install Tailscale here (`resolveInstallPlan`), the operator command, and
 *   the dashboard port. `?userspace=1` asks for the userspace plan on Linux.
 *   Any dashboard credential may read it (default `admin` scope).
 *
 * No response is cacheable.
 */
import { userInfo } from 'node:os';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { operatorCommand, resolveInstallPlan } from '../../../lib/tailscale/installer.js';
import { readTailscaleState } from '../../../lib/tailscale/state.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function currentUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

const tailscaleStatusRoute = HttpRouter.add(
  'GET',
  '/api/tailscale/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const userspace = new URL(request.url, 'http://localhost').searchParams.get('userspace') === '1';
    const body = yield* Effect.promise(async () => {
      const state = await readTailscaleState();
      const install = await resolveInstallPlan({ userspace, port: state.port });
      return { state, install, operatorCommand: operatorCommand(currentUsername()), port: state.port };
    });
    return noStore(jsonResponse(body));
  }),
);

export const tailscaleRouteLayer = Layer.mergeAll(tailscaleStatusRoute);
