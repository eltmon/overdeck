/**
 * Overdeck connector routes (PAN-4927 W-CONN1; PAN-4949 D-11 to D-16).
 *
 * `POST /api/connectors/pairing`, `GET /api/connectors` and
 * `DELETE /api/connectors/:id` are root only: the handlers accept the internal
 * token or the root session and nothing else, because an `admin`-scoped device
 * or token would otherwise pass the scope gate (unlisted routes need `admin`).
 * Pairing issues an `odp_` code, notes its intent by pairingId
 * (`connector-pairing.ts`) and returns the connector pairing string; the scopes
 * always include `read:state`, so every connector can revoke itself (D-14).
 *
 * `DELETE /api/connectors/self` is the connector's own logout: the scope table
 * admits it with `read:state`, and the handler then requires a `connector`
 * credential. The `:id` route hands `self` to the same handler, whichever of
 * the two routes the router matched. `GET /api/connectors/self` (PAN-5069
 * FR-10) lets the same credential read its own record and this machine's name,
 * so `pan mcp connector connect` can verify the route end to end.
 *
 * `POST /api/connectors/exchange` is reachable only through a pairing-mode
 * secure channel. It takes the intent of the channel's pairingId first, so any
 * outcome burns it (D-8), then mints the `connector` token bound to the
 * channel's proved key with the intent's name and scopes, and revokes an
 * earlier active connector with the same `clientId`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  BOT_DEFAULT_SCOPES,
  CONNECTOR_SCOPE_CHOICES,
  createAccessToken,
  findActiveChannelTokenByKey,
  listAccessTokens,
  listActiveRecordsOfKind,
  revokeAccessToken,
  type AccessTokenScope,
} from '../../../lib/access-tokens.js';
import { UUID_V4 } from '../../../lib/access-token-records.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { closeChannelsForPeer } from '../channel-listener.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { issueConnectorPairing, takeConnectorIntent } from '../connector-pairing.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import {
  type DashboardCredential,
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveRequestCredential,
} from './dashboard-auth.js';
import { buildEnvironmentDescriptor } from './environment.js';

const MAX_NAME_LENGTH = 64;
const MAX_LABEL_LENGTH = 64;

type CredentialKind = DashboardCredential['kind'] | null | undefined;

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

/** A 403 unless the credential is root (D-11). */
function rejectNonRoot(kind: CredentialKind): HttpServerResponse.HttpServerResponse | null {
  if (kind === 'internal-token' || kind === 'root-session') return null;
  return noStore(jsonResponse({ error: 'only the internal token or the root session can manage connectors' }, { status: 403 }));
}

/** D-12: `{ name, scopes? }` → the name and the final scope set (D-14), or an error message. */
function parsePairingBody(text: string): { name: string; scopes: AccessTokenScope[] } | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '' || name.length > MAX_NAME_LENGTH) return `name must be a string of 1-${MAX_NAME_LENGTH} characters`;
  let chosen: readonly AccessTokenScope[] = BOT_DEFAULT_SCOPES;
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || body.scopes.length === 0) return 'scopes must be a non-empty array';
    const seen = new Set<unknown>();
    for (const scope of body.scopes) {
      if (!(CONNECTOR_SCOPE_CHOICES as readonly unknown[]).includes(scope) || seen.has(scope)) {
        return `scope ${JSON.stringify(scope)} is not allowed; choose distinct values from ${CONNECTOR_SCOPE_CHOICES.join(', ')}`;
      }
      seen.add(scope);
    }
    chosen = body.scopes as AccessTokenScope[];
  }
  // D-14: read:state is always on, in CONNECTOR_SCOPE_CHOICES order.
  const scopes = CONNECTOR_SCOPE_CHOICES.filter((scope) => scope === 'read:state' || chosen.includes(scope));
  return { name, scopes };
}

export async function handleConnectorPairing(credentialKind: CredentialKind, bodyText: string): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = rejectNonRoot(credentialKind);
  if (refused) return refused;
  const body = parsePairingBody(bodyText);
  if (typeof body === 'string') return noStore(jsonResponse({ error: body }, { status: 400 }));
  const { pairingString, expiresAt } = await issueConnectorPairing(body);
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Issued a connector pairing code for "${body.name}"`,
    details: JSON.stringify({ expiresAt, scopes: body.scopes }),
  });
  return noStore(jsonResponse({ pairingString, expiresAt }));
}

export async function handleConnectorList(credentialKind: CredentialKind): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = rejectNonRoot(credentialKind);
  if (refused) return refused;
  const records = await listAccessTokens();
  const connectors = records
    .filter((record) => record.kind === 'connector' && !record.revokedAt)
    .map(({ id, name, scopes, clientId, createdAt, lastUsedAt }) => ({ id, name, scopes, clientId, createdAt, lastUsedAt }));
  return noStore(jsonResponse({ connectors }));
}

export async function handleConnectorRevoke(credentialKind: CredentialKind, id: string): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = rejectNonRoot(credentialKind);
  if (refused) return refused;
  const target = (await listAccessTokens()).find((record) => record.id === id && record.kind === 'connector');
  if (!target) return noStore(jsonResponse({ error: `no connector with id ${id}` }, { status: 404 }));
  await revokeAccessToken(id);
  closeDeviceConnections(id);
  if (target.connectorKey) closeChannelsForPeer(target.connectorKey);
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Removed connector "${target.name}"`,
    details: JSON.stringify({ tokenId: id, clientId: target.clientId }),
  });
  return noStore(jsonResponse({ ok: true }));
}

/** The calling connector revokes its own record. Exactly a connector credential may call this (D-13). */
export async function handleConnectorSelfRevoke(credential: DashboardCredential | null): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'connector') {
    return noStore(jsonResponse({ error: 'only a paired connector may revoke itself' }, { status: 403 }));
  }
  const revoked = await revokeAccessToken(credential.tokenId);
  closeDeviceConnections(credential.tokenId);
  closeChannelsForPeer(credential.connectorKey);
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Connector "${revoked?.name ?? credential.clientId}" removed itself`,
    details: JSON.stringify({ tokenId: credential.tokenId, clientId: credential.clientId }),
  });
  return noStore(jsonResponse({ ok: true }));
}

/** FR-10: the calling connector's own record. Exactly a connector credential may call this. */
export async function handleConnectorSelf(credential: DashboardCredential | null): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'connector') {
    return noStore(jsonResponse({ error: 'only a paired connector may read itself', code: 'not-a-connector' }, { status: 403 }));
  }
  const record = (await listAccessTokens()).find((entry) => entry.id === credential.tokenId && !entry.revokedAt);
  if (!record) return noStore(jsonResponse({ error: 'this connector was removed', code: 'connector-removed' }, { status: 403 }));
  const descriptor = await buildEnvironmentDescriptor();
  return noStore(jsonResponse({
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    clientId: record.clientId ?? null,
    machine: { environmentId: descriptor.environmentId, label: descriptor.label },
  }));
}

function parseExchangeBody(text: string): { clientId: string; label: string } | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  if (body.v !== 1) return 'v must be 1';
  if (typeof body.clientId !== 'string' || !UUID_V4.test(body.clientId)) return 'clientId must be a UUID v4';
  if (typeof body.label !== 'string' || body.label.trim() === '' || body.label.trim().length > MAX_LABEL_LENGTH) {
    return `label must be a string of 1-${MAX_LABEL_LENGTH} characters`;
  }
  return { clientId: body.clientId, label: body.label.trim() };
}

/**
 * The exchange, separated from the route so tests can pass the channel marker
 * directly. `channel` must be a pairing-mode marker whose code was issued for
 * a connector (D-8).
 */
export async function handleConnectorsExchange(
  bodyText: string,
  channel: ChannelMarker | null,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (channel?.mode !== 'pairing') {
    return noStore(jsonResponse({ error: 'connector exchange is accepted only inside a pairing channel' }, { status: 403 }));
  }
  const intent = takeConnectorIntent(channel.pairingId ?? '');
  if (intent === null) {
    return noStore(jsonResponse({ error: 'this pairing code was not issued for an Overdeck connector', code: 'not-a-connector-code' }, { status: 403 }));
  }
  const body = parseExchangeBody(bodyText);
  if (typeof body === 'string') return noStore(jsonResponse({ error: body }, { status: 400 }));

  // Never revoke a record holding the pairing channel's own key (PAN-4835 D-2).
  if (findActiveChannelTokenByKey(channel.remoteKeyHex) !== null) {
    return noStore(jsonResponse(
      { error: 'this link key is already paired with this machine; pair again with a new key', code: 'link-key-in-use' },
      { status: 409 },
    ));
  }

  const { token, record } = await createAccessToken({
    name: intent.name,
    scopes: intent.scopes,
    kind: 'connector',
    connectorKey: channel.remoteKeyHex,
    clientId: body.clientId,
  });

  const replaced = listActiveRecordsOfKind('connector').filter((other) => other.clientId === body.clientId && other.id !== record.id);
  for (const other of replaced) await revokeAccessToken(other.id);

  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Paired connector "${intent.name}"`,
    details: JSON.stringify({ tokenId: record.id, clientId: body.clientId, label: body.label, replaced: replaced.length }),
  });
  const descriptor = await buildEnvironmentDescriptor();
  return noStore(jsonResponse({ v: 1, token, tokenId: record.id, scopes: record.scopes, descriptor }));
}

const exchangeRoute = HttpRouter.add(
  'POST',
  '/api/connectors/exchange',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const channel = channelOfRequest(request);
    const text = yield* request.text;
    return yield* Effect.promise(() => handleConnectorsExchange(text, channel));
  }),
);

const pairingRoute = HttpRouter.add(
  'POST',
  '/api/connectors/pairing',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const text = yield* request.text;
    return yield* Effect.promise(() => handleConnectorPairing(resolveRequestCredential(request)?.kind, text));
  }),
);

const listRoute = HttpRouter.add(
  'GET',
  '/api/connectors',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    return yield* Effect.promise(() => handleConnectorList(resolveRequestCredential(request)?.kind));
  }),
);

const selfRevokeRoute = HttpRouter.add(
  'DELETE',
  '/api/connectors/self',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleConnectorSelfRevoke(resolveRequestCredential(request)));
  }),
);

const selfRoute = HttpRouter.add(
  'GET',
  '/api/connectors/self',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleConnectorSelf(resolveRequestCredential(request)));
  }),
);

const revokeRoute = HttpRouter.add(
  'DELETE',
  '/api/connectors/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    // Whichever route the router matched first, `self` is the connector's own revoke (C-8).
    if (id === 'self') return yield* Effect.promise(() => handleConnectorSelfRevoke(resolveRequestCredential(request)));
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    return yield* Effect.promise(() => handleConnectorRevoke(resolveRequestCredential(request)?.kind, id));
  }),
);

export const connectorsRouteLayer = Layer.mergeAll(exchangeRoute, pairingRoute, listRoute, selfRoute, selfRevokeRoute, revokeRoute);
