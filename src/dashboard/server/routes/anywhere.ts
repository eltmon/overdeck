/**
 * Overdeck Anywhere routes (PAN-4445).
 *
 * - `POST /api/anywhere/trusted-origins` saves an address other devices use to
 *   reach this dashboard (`~/.overdeck/trusted-origins.json`) and trusts it on
 *   the next request, with no restart. Only the root session (the operator's
 *   browser on this machine) may call it: the internal token (the CLI and
 *   every pipeline agent), a paired device and a scoped token get 403, because
 *   widening origin trust widens the dashboard's attack surface (D-5).
 *   Loopback addresses are refused with 400; they are already trusted for this
 *   port and never help another device (D-6).
 *
 * - `GET /api/anywhere/status` returns the Anywhere status card's data
 *   (`lib/remote-access/anywhere-status.ts`): machine identity, trusted
 *   addresses, the active paired-device count, the vault state, the
 *   problems with their fix actions, a Tailscale summary (PAN-1254 FR-9), and
 *   the caller's credential kind (PAN-4455 D-3). Any dashboard credential may
 *   read it.
 *
 * No response is cacheable.
 */
import { Effect, Layer, Result } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { isPairedDeviceRecord, listAccessTokens } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import {
  computeAnywhereProblems,
  readDirectoryStatus,
  readRelayStatus,
  readAnywhereVaultState,
  type AnywhereStatus,
  type AnywhereViewerKind,
} from '../../../lib/remote-access/anywhere-status.js';
import { isLoopbackOrigin } from '../../../lib/remote-access/loopback.js';
import { invalidateRemoteAccessConfig, readRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { addSavedTrustedOrigin } from '../../../lib/remote-access/trusted-origins.js';
import { readTailscaleState } from '../../../lib/tailscale/state.js';
import { jsonResponse } from '../http-helpers.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveRequestCredential,
} from './dashboard-auth.js';
import { getTrustedOrigins, invalidateTrustedOriginsCache } from './origin-validation.js';

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

const addTrustedOriginRoute = HttpRouter.add(
  'POST',
  '/api/anywhere/trusted-origins',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    // PAN-4445 D-5: only the operator's browser on this machine widens origin trust.
    if (resolveRequestCredential(request)?.kind !== 'root-session') {
      return noStore(jsonResponse({ error: 'Only a browser session on this machine can add a trusted address.' }, { status: 403 }));
    }

    const body = parseJsonObject(yield* request.text);
    const raw = body?.['origin'];
    if (typeof raw !== 'string') {
      return noStore(jsonResponse({ error: 'body must be { origin: string }' }, { status: 400 }));
    }

    // addSavedTrustedOrigin rejects only when the file cannot be read or is invalid; its message names the file.
    const result = yield* Effect.result(Effect.tryPromise({
      try: () => addSavedTrustedOrigin(raw, getTrustedOrigins()),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    }));
    if (Result.isFailure(result)) {
      return noStore(jsonResponse({ error: result.failure }, { status: 500 }));
    }
    const added = result.success;
    if (!added.ok) {
      return noStore(jsonResponse({
        error: added.reason === 'loopback'
          ? 'That address only works on this machine. Use an address another device can reach, such as a Tailscale name.'
          : 'Enter an http:// or https:// address, for example https://desk.tailnet.ts.net.',
      }, { status: 400 }));
    }
    if (added.added) {
      invalidateTrustedOriginsCache();
      invalidateRemoteAccessConfig(); // PAN-4645 D-4645-12: a remote address turns require_token_mint on.
      emitActivityEntry({ source: 'dashboard', level: 'info', message: `Added trusted address ${added.origin}`, details: '{}' });
    }
    return noStore(jsonResponse({ origin: added.origin, added: added.added }));
  }),
);

async function buildAnywhereStatus(viewerKind: AnywhereViewerKind | null): Promise<AnywhereStatus> {
  let machine: AnywhereStatus['machine'] = null;
  let identityError: string | null = null;
  try {
    const identity = await ensureEnvironmentIdentity();
    machine = { environmentId: identity.environmentId, label: identity.label };
  } catch (error) {
    identityError = (error as Error).message;
  }
  const addresses = getTrustedOrigins().map((origin) => ({ origin, loopback: isLoopbackOrigin(origin) }));
  const records = await listAccessTokens();
  // A paired device: a browser pairing (no kind, PAN-2351 FR-10) or an Overdeck app phone.
  const active = records.filter((record) => isPairedDeviceRecord(record) && !record.revokedAt).length;
  const [vault, tailscale] = await Promise.all([readAnywhereVaultState(), readTailscaleState()]);
  // Read fresh: the Tailscale state is memoized and may predate a settings save.
  const mint = readRemoteAccessConfig();
  const requireTokenMint = mint.requireTokenMint;
  return {
    machine,
    addresses,
    devices: { active },
    vault,
    tokenMint: { effective: mint.requireTokenMint, configured: mint.configured, autoReasons: [...mint.autoReasons] },
    problems: computeAnywhereProblems({
      identityError,
      addresses,
      vault,
      tailscaleServeOn: tailscale.serve.proxiesDashboard,
      requireTokenMint,
    }),
    tailscale: {
      nextStep: tailscale.installed ? tailscale.nextStep : 'not-installed',
      serveUrl: tailscale.serveUrl,
      magicDnsName: tailscale.magicDnsName,
    },
    viewer: { kind: viewerKind },
    directory: readDirectoryStatus(),
    relay: readRelayStatus(),
  };
}

const anywhereStatusRoute = HttpRouter.add(
  'GET',
  '/api/anywhere/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const viewerKind = resolveRequestCredential(request)?.kind ?? null;
    return noStore(jsonResponse(yield* Effect.promise(() => buildAnywhereStatus(viewerKind))));
  }),
);

export const anywhereRouteLayer = Layer.mergeAll(addTrustedOriginRoute, anywhereStatusRoute);
