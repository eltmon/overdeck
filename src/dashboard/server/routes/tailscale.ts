/**
 * Tailscale routes for Overdeck Anywhere (PAN-1254 FR-11).
 *
 * - `GET /api/tailscale/status` returns `readTailscaleState()` plus how to
 *   install Tailscale here (`resolveInstallPlan`), the operator command, the
 *   dashboard port, the server platform and whether the userspace install is
 *   offered (the setup dialog picks its panels from these). `?userspace=1` asks for the userspace plan on Linux.
 *   Any dashboard credential may read it (default `admin` scope).
 *
 * - `GET /api/tailscale/peers` lists the online tailnet peers, each with its
 *   Overdeck descriptor when one answered (`discoverTailnetPeers`). Empty when
 *   Tailscale is not `Running`.
 * - `POST /api/tailscale/userspace` installs Overdeck's userspace Tailscale,
 *   or restarts its daemon when it is already the active install. A fresh
 *   install is refused (409) while userspace mode is off (C-1).
 * - `POST /api/tailscale/login` starts sign-in and returns the URL to open;
 *   access denied answers 409 `{ nextStep: 'operator' }`.
 * - `POST /api/tailscale/serve` turns on protected Serve HTTPS (also the
 *   `protect` step). The trusted-origins cache is invalidated after every
 *   call, whatever the result: the origin may be on disk even when Serve or
 *   its self-check failed later.
 *
 * The POST routes change this machine, so only the root session and the
 * internal token may call them (D-4); a paired device or a scoped token gets
 * 403.
 *
 * No response is cacheable.
 */
import { userInfo } from 'node:os';

import { Effect, Layer, Result } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { operatorCommand, resolveInstallPlan, USERSPACE_MODE_AVAILABLE } from '../../../lib/tailscale/installer.js';
import { startTailscaleLogin } from '../../../lib/tailscale/login.js';
import { discoverTailnetPeers } from '../../../lib/tailscale/peers.js';
import { enableTailscaleServe } from '../../../lib/tailscale/serve.js';
import { readTailscaleState } from '../../../lib/tailscale/state.js';
import { installUserspaceTailscale, restartUserspaceDaemon } from '../../../lib/tailscale/userspace.js';
import { jsonResponse } from '../http-helpers.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveDashboardCredential,
} from './dashboard-auth.js';
import { getTrustedOrigins, invalidateTrustedOriginsCache, type HeaderMap } from './origin-validation.js';

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
      return {
        state,
        install,
        operatorCommand: operatorCommand(currentUsername()),
        port: state.port,
        platform: process.platform,
        userspaceAvailable: USERSPACE_MODE_AVAILABLE,
      };
    });
    return noStore(jsonResponse(body));
  }),
);

const tailscalePeersRoute = HttpRouter.add(
  'GET',
  '/api/tailscale/peers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const result = yield* Effect.result(Effect.tryPromise({
      try: async () => {
        const state = await readTailscaleState();
        if (state.backendState !== 'Running') return [];
        const { environmentId } = await ensureEnvironmentIdentity();
        return discoverTailnetPeers(state, { port: state.port, selfEnvironmentId: environmentId });
      },
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    }));
    if (Result.isFailure(result)) return noStore(jsonResponse({ error: result.failure }, { status: 500 }));
    return noStore(jsonResponse({ peers: result.success }));
  }),
);

/** D-4: mutation guard, then root session or internal token only. */
function rejectTailscaleWrite(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null {
  const authError = rejectUnsafeDashboardMutationRequest(request);
  if (authError) return authError;
  const kind = resolveDashboardCredential(request.headers as HeaderMap)?.kind;
  if (kind !== 'root-session' && kind !== 'internal-token') {
    return jsonResponse({ error: 'Only this machine can change Tailscale settings.' }, { status: 403 });
  }
  return null;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const tailscaleUserspaceRoute = HttpRouter.add(
  'POST',
  '/api/tailscale/userspace',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectTailscaleWrite(request);
    if (authError) return noStore(authError);
    const result = yield* Effect.result(Effect.tryPromise({
      try: async () => {
        const state = await readTailscaleState();
        if (state.mode === 'userspace') return restartUserspaceDaemon();
        // C-1: a fresh userspace install stays off until a live check passes.
        if (!USERSPACE_MODE_AVAILABLE) {
          return {
            ok: false as const,
            reason: 'userspace-unavailable' as const,
            message: 'Installing Tailscale without an administrator password is not available yet. Install it with the installer instead.',
          };
        }
        return installUserspaceTailscale();
      },
      catch: errorText,
    }));
    if (Result.isFailure(result)) return noStore(jsonResponse({ error: result.failure }, { status: 500 }));
    const body = result.success;
    return noStore(jsonResponse(body, { status: !body.ok && body.reason === 'userspace-unavailable' ? 409 : 200 }));
  }),
);

const tailscaleLoginRoute = HttpRouter.add(
  'POST',
  '/api/tailscale/login',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectTailscaleWrite(request);
    if (authError) return noStore(authError);
    const result = yield* Effect.result(Effect.tryPromise({
      try: async () => startTailscaleLogin(await readTailscaleState()),
      catch: errorText,
    }));
    if (Result.isFailure(result)) return noStore(jsonResponse({ error: result.failure }, { status: 500 }));
    const login = result.success;
    if ('authUrl' in login) return noStore(jsonResponse({ authUrl: login.authUrl }));
    switch (login.error) {
      case 'access-denied':
        return noStore(jsonResponse({ error: login.message, nextStep: 'operator' }, { status: 409 }));
      case 'timeout':
        return noStore(jsonResponse({ error: login.message }, { status: 504 }));
      case 'failed':
        return noStore(jsonResponse({ error: login.message }, { status: 502 }));
    }
  }),
);

const tailscaleServeRoute = HttpRouter.add(
  'POST',
  '/api/tailscale/serve',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectTailscaleWrite(request);
    if (authError) return noStore(authError);
    const result = yield* Effect.result(Effect.tryPromise({
      try: () => enableTailscaleServe({ alreadyTrusted: getTrustedOrigins() }),
      catch: errorText,
    }));
    invalidateTrustedOriginsCache();
    if (Result.isFailure(result)) return noStore(jsonResponse({ error: result.failure }, { status: 500 }));
    const serve = result.success;
    if (!serve.ok) return noStore(jsonResponse(serve, { status: 409 }));
    if (serve.changed) {
      emitActivityEntry({ source: 'dashboard', level: 'info', message: `Turned on Tailscale Serve at ${serve.url}`, details: '{}' });
    }
    return noStore(jsonResponse(serve));
  }),
);

export const tailscaleRouteLayer = Layer.mergeAll(
  tailscaleStatusRoute,
  tailscalePeersRoute,
  tailscaleUserspaceRoute,
  tailscaleLoginRoute,
  tailscaleServeRoute,
);
