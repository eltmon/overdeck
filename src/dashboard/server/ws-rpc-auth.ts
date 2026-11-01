/**
 * `/ws/rpc` upgrade authorization and scoped method groups (PAN-4645 WI-6,
 * D-4645-14).
 *
 * RPC middleware sees per-message headers, not the upgrade's, so the method
 * set is chosen once at upgrade time: an `admin` credential gets the full
 * `PanRpcGroup`; any other credential gets `PanRpcGroup.omit(<every tag whose
 * RPC_METHOD_SCOPES entry its scopes do not satisfy>)`, built once per allowed
 * tag set and memoised. A method the restricted group lacks has no handler on
 * that connection, so calling it fails before any handler runs. The upgrade
 * needs `read:events` or `read:conversations` (else 403).
 *
 * `withRpcRevocation` keeps the PAN-3762 behaviour: revoking the credential
 * interrupts the connection's handler. WI-7 replaces it with a 4401 close.
 */
import { Deferred, Effect } from 'effect';
import type { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import type { Rpc, RpcGroup } from 'effect/unstable/rpc';
import { PanRpcGroup } from '@overdeck/contracts';

import { scopeSatisfies } from '../../lib/access-tokens.js';
import { registerDeviceConnection, revocableCredentialId } from './device-connections.js';
import { jsonResponse } from './http-helpers.js';
import { allowedRpcTags, WS_RPC_UPGRADE_SCOPES } from './route-scopes.js';
import { credentialScopes, type DashboardCredential } from './routes/dashboard-auth.js';
import type { HeaderMap } from './routes/origin-validation.js';
import { authorizeDashboardUpgrade, channelOfRequest, type UpgradeAuthResult } from './ws-auth.js';

/** The `/ws/rpc` upgrade gate: origin, credential (channel-aware), then one of the upgrade scopes. */
export function authorizeRpcUpgrade(request: HttpServerRequest.HttpServerRequest): UpgradeAuthResult {
  const headers = request.headers as HeaderMap;
  const channel = channelOfRequest(request);
  let result: UpgradeAuthResult = { ok: false, status: 403, message: 'Forbidden' };
  for (const scope of WS_RPC_UPGRADE_SCOPES) {
    result = authorizeDashboardUpgrade(headers, request.method, scope, channel);
    if (result.ok || result.status !== 403) return result;
  }
  return result;
}

export function rejectUnauthorizedRpcUpgrade(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const auth = authorizeRpcUpgrade(request);
  return auth.ok ? null : jsonResponse({ error: auth.message }, { status: auth.status });
}

/** The tags of `PanRpcGroup` a credential may NOT call: empty for admin. */
export function omittedRpcTags(credential: DashboardCredential): string[] {
  const scopes = credentialScopes(credential);
  if (scopeSatisfies(scopes, 'admin')) return [];
  const allowed = new Set(allowedRpcTags(scopes));
  return [...PanRpcGroup.requests.keys()].filter((tag) => !allowed.has(tag)).sort();
}

/**
 * `PanRpcGroup` without `omit`. The tag list is dynamic, so the static type
 * cannot track the removal; the handler layer provides every handler and the
 * restricted group simply never routes an omitted tag.
 */
export function restrictedRpcGroup(omit: ReadonlyArray<string>): typeof PanRpcGroup {
  const group = PanRpcGroup as unknown as RpcGroup.RpcGroup<Rpc.Any>;
  return group.omit(...omit) as unknown as typeof PanRpcGroup;
}

export interface RpcHandlerSource<A, E, R> {
  /** The handler for the full group (admin credentials). */
  full: A;
  /** Build the handler for `PanRpcGroup.omit(...omit)`; called once per distinct set. */
  build: (omit: ReadonlyArray<string>) => Effect.Effect<A, E, R>;
}

const restrictedHandlers = new Map<string, unknown>();

/** Pick (and memoise) the RPC handler whose method set matches the credential's scopes. */
export function selectRpcHandler<A, E, R>(credential: DashboardCredential, source: RpcHandlerSource<A, E, R>): Effect.Effect<A, E, R> {
  const omit = omittedRpcTags(credential);
  if (omit.length === 0) return Effect.succeed(source.full);
  const key = omit.join(',');
  const cached = restrictedHandlers.get(key) as A | undefined;
  if (cached !== undefined) return Effect.succeed(cached);
  return source.build(omit).pipe(Effect.tap((built) => Effect.sync(() => { restrictedHandlers.set(key, built); })));
}

/**
 * Revoking the device or token interrupts this socket's handler, which closes
 * the socket (Effect's release closes it without a code, so this one cannot
 * send 4401). The client's reconnect then gets 401. Root credentials are not
 * revocable and pass through.
 */
export function withRpcRevocation<E, R>(
  rpcHttp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  credential: DashboardCredential,
  empty: () => HttpServerResponse.HttpServerResponse,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> {
  const revocableId = revocableCredentialId(credential);
  if (revocableId === null) return rpcHttp;
  const revoked = Deferred.makeUnsafe<void>();
  const unregister = registerDeviceConnection(revocableId, () => {
    Deferred.doneUnsafe(revoked, Effect.void);
  });
  return Effect.raceFirst(rpcHttp, Deferred.await(revoked).pipe(Effect.as(empty()))).pipe(Effect.ensuring(Effect.sync(unregister)));
}

export function _resetRpcHandlerMemoForTests(): void {
  restrictedHandlers.clear();
}
