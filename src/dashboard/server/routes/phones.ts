/**
 * Phone app routes (PAN-4835 WI-7, WI-8).
 *
 * `POST /api/phones/exchange` is reachable only through a pairing-mode secure
 * channel: the remote request gate admits it from nothing else, and the route
 * checks the marker again. The handshake already proved the caller's link
 * key, so the route mints the `phone` token bound to that key and revokes any
 * earlier active phone record with the same `clientId` (D-2). A code issued
 * for an Overdeck connector is refused (PAN-4927 W-CONN1).
 *
 * `DELETE /api/phones/self` and `PUT /api/phones/self/push-key` are the
 * phone's own self-service routes: the scope table admits them with `tell`,
 * and the handler then requires a `phone` credential (D-9).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import {
  createAccessToken,
  findActiveChannelTokenByKey,
  listActiveRecordsOfKind,
  PHONE_TOKEN_SCOPES,
  revokeAccessToken,
  setPhonePushKey,
} from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { capturePhonePaired, capturePhoneRemoved } from '../../../lib/telemetry/anywhere.js';
import { closeChannelsForPeer } from '../channel-listener.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { hasConnectorIntent } from '../connector-pairing.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { buildEnvironmentDescriptor } from './environment.js';

const MAX_LABEL_LENGTH = 64;
const KEY_HEX = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface PhoneExchangeBody {
  clientId: string;
  label: string;
  pushKeyHex: string;
}

function parsePhoneExchangeBody(text: string): PhoneExchangeBody | string {
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
  if (typeof body.pushKeyHex !== 'string' || !KEY_HEX.test(body.pushKeyHex)) return 'pushKeyHex must be 64 lowercase hex characters';
  return { clientId: body.clientId, label: body.label.trim(), pushKeyHex: body.pushKeyHex };
}

/**
 * The exchange, separated from the route so tests can pass the channel marker
 * directly. `channel` must be a pairing-mode marker; anything else is 403.
 */
export async function handlePhonesExchange(
  bodyText: string,
  channel: ChannelMarker | null,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (channel?.mode !== 'pairing') {
    return jsonResponse({ error: 'phone exchange is accepted only inside a pairing channel' }, { status: 403 });
  }
  if (channel.pairingId !== null && hasConnectorIntent(channel.pairingId)) {
    return jsonResponse({ error: 'this pairing code is for an Overdeck connector; run pan mcp connector pair with it', code: 'connector-code' }, { status: 403 });
  }
  const body = parsePhoneExchangeBody(bodyText);
  if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });

  // D-2: never revoke a record holding the pairing channel's own key — that
  // would destroy the very channel this exchange is running over.
  if (findActiveChannelTokenByKey(channel.remoteKeyHex) !== null) {
    return jsonResponse(
      { error: 'this link key is already paired with this machine; pair again with a new key', code: 'link-key-in-use' },
      { status: 409 },
    );
  }

  const { token, record } = await createAccessToken({
    name: body.label,
    scopes: [...PHONE_TOKEN_SCOPES],
    kind: 'phone',
    phoneKey: channel.remoteKeyHex,
    clientId: body.clientId,
    pushKey: body.pushKeyHex,
  });

  const replaced = listActiveRecordsOfKind('phone').filter((other) => other.clientId === body.clientId && other.id !== record.id);
  for (const other of replaced) await revokeAccessToken(other.id);
  capturePhonePaired(replaced.length > 0);

  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Paired phone "${body.label}"`,
    details: JSON.stringify({ tokenId: record.id, clientId: body.clientId, replaced: replaced.length }),
  });
  const descriptor = await buildEnvironmentDescriptor();
  return jsonResponse({ v: 1, token, tokenId: record.id, descriptor }, { headers: { 'Cache-Control': 'no-store' } });
}

const exchangeRoute = HttpRouter.add(
  'POST',
  '/api/phones/exchange',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const channel = channelOfRequest(request);
    const text = yield* request.text;
    return yield* Effect.promise(() => handlePhonesExchange(text, channel));
  }),
);

/** The calling phone revokes its own record. Exactly a phone credential may call this (D-12). */
export async function handlePhonesSelfRevoke(credential: DashboardCredential | null): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'phone') {
    return jsonResponse({ error: 'only a paired phone may revoke itself' }, { status: 403 });
  }
  const revoked = await revokeAccessToken(credential.tokenId);
  closeDeviceConnections(credential.tokenId);
  capturePhoneRemoved('phone');
  if (revoked?.phoneKey) closeChannelsForPeer(revoked.phoneKey);
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Phone "${revoked?.name ?? credential.clientId}" removed itself`,
    details: JSON.stringify({ tokenId: credential.tokenId, clientId: credential.clientId }),
  });
  return jsonResponse({ ok: true });
}

const selfRevokeRoute = HttpRouter.add(
  'DELETE',
  '/api/phones/self',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handlePhonesSelfRevoke(resolveRequestCredential(request)));
  }),
);

/** The calling phone replaces its own push key. Exactly a phone credential may call this. */
export async function handlePhonesPushKey(
  credential: DashboardCredential | null,
  bodyText: string,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'phone') {
    return jsonResponse({ error: 'only a paired phone may rotate its push key' }, { status: 403 });
  }
  let pushKeyHex: unknown;
  try {
    pushKeyHex = (bodyText ? JSON.parse(bodyText) : {}).pushKeyHex;
  } catch {
    return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
  }
  if (typeof pushKeyHex !== 'string' || !KEY_HEX.test(pushKeyHex)) {
    return jsonResponse({ error: 'pushKeyHex must be 64 lowercase hex characters' }, { status: 400 });
  }
  const updated = await setPhonePushKey(credential.tokenId, pushKeyHex);
  if (!updated) return jsonResponse({ error: 'phone record not found' }, { status: 404 });
  return jsonResponse({ ok: true });
}

const pushKeyRoute = HttpRouter.add(
  'PUT',
  '/api/phones/self/push-key',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const text = yield* request.text;
    return yield* Effect.promise(() => handlePhonesPushKey(resolveRequestCredential(request), text));
  }),
);

export const phonesRouteLayer = Layer.mergeAll(exchangeRoute, selfRevokeRoute, pushKeyRoute);
