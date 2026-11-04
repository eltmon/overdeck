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
 * `withRpcRevocation` closes the connection with code 4401 when its credential
 * is revoked (D-4645-15): the `ws` WebSocket Effect's server created on
 * upgrade is stored on the raw socket under the symbol described `websocket`
 * (`ws/lib/constants.js`), and its `close(4401)` is frame-safe. If the symbol
 * is not found (upgrade not done yet, or a `ws` change), the raw socket is
 * destroyed instead and the client's reconnect gets 401.
 *
 * `registerRevocationClosers` (D-4645-16) is the one dashboard listener on
 * `onAccessTokensRevoked`: it closes the record's live device connections and,
 * for a machine or phone record (PAN-4835), every secure channel bound to its
 * key, so a revoke written by another process lands within one refresh (5 s).
 */
import { Deferred, Effect } from 'effect';
import { HttpServerResponse, type HttpServerRequest } from 'effect/unstable/http';
import type { Rpc, RpcGroup } from 'effect/unstable/rpc';
import { PanRpcGroup } from '@overdeck/contracts';

import { onAccessTokensRevoked, scopeSatisfies } from '../../lib/access-tokens.js';
import { closeChannelsForPeer } from './channel-listener.js';
import { closeDeviceConnections, registerDeviceConnection, revocableCredentialId } from './device-connections.js';
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

interface ClosableWebSocket {
  close(code?: number, reason?: string): void;
}

interface RawSocketLike {
  destroy?: () => void;
}

/** The `ws` WebSocket that `handleUpgrade` stored on the raw socket, if any. */
export function websocketOfRawSocket(socket: unknown): ClosableWebSocket | null {
  if (typeof socket !== 'object' || socket === null) return null;
  const symbol = Object.getOwnPropertySymbols(socket).find((entry) => entry.description === 'websocket');
  if (!symbol) return null;
  const candidate = (socket as Record<symbol, unknown>)[symbol];
  return typeof candidate === 'object' && candidate !== null && typeof (candidate as ClosableWebSocket).close === 'function'
    ? (candidate as ClosableWebSocket)
    : null;
}

/** Close the WebSocket behind a Node-backed upgrade request with 4401, or drop the raw socket. */
export function closeRpcSocketRevoked(request: HttpServerRequest.HttpServerRequest): 'closed-4401' | 'destroyed' | 'no-socket' {
  const source = (request as { source?: { socket?: unknown } }).source;
  const socket = typeof source === 'object' && source !== null ? source.socket : undefined;
  const ws = websocketOfRawSocket(socket);
  if (ws) {
    ws.close(4401, 'device revoked');
    return 'closed-4401';
  }
  if (typeof (socket as RawSocketLike | undefined)?.destroy === 'function') {
    (socket as RawSocketLike).destroy!();
    return 'destroyed';
  }
  return 'no-socket';
}

/**
 * Register this connection under its revocable credential so a revoke closes
 * it with 4401 (D-4645-15). Root credentials are not revocable and pass through.
 */
export function withRpcRevocation<E, R>(
  rpcHttp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  credential: DashboardCredential,
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> {
  const revocableId = revocableCredentialId(credential);
  if (revocableId === null) return rpcHttp;
  // Queue the 4401 close frame first, then stop the handler fiber: a client that
  // never answers the close frame must not keep a working RPC channel for the
  // 30 s `ws` close timeout (D-4645-15 keeps the interrupt main had).
  const revoked = Deferred.makeUnsafe<void>();
  const unregister = registerDeviceConnection(revocableId, () => {
    closeRpcSocketRevoked(request);
    Deferred.doneUnsafe(revoked, Effect.void);
  });
  return Effect.raceFirst(
    rpcHttp,
    Deferred.await(revoked).pipe(Effect.as(HttpServerResponse.empty())),
  ).pipe(Effect.ensuring(Effect.sync(unregister)));
}

/**
 * The dashboard's one `onAccessTokensRevoked` listener (D-4645-16): close the
 * record's live connections and, for a machine, phone or connector record, its channels. Returns
 * the unsubscribe function.
 */
export function registerRevocationClosers(): () => void {
  return onAccessTokensRevoked((record) => {
    closeDeviceConnections(record.id);
    if (record.kind === 'machine' && record.machineKey) closeChannelsForPeer(record.machineKey);
    if (record.kind === 'phone' && record.phoneKey) closeChannelsForPeer(record.phoneKey);
    if (record.kind === 'connector' && record.connectorKey) closeChannelsForPeer(record.connectorKey);
  });
}

export function _resetRpcHandlerMemoForTests(): void {
  restrictedHandlers.clear();
}
