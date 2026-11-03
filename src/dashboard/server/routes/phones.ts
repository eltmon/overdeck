/**
 * Phone app routes (PAN-4835 WI-7).
 *
 * `POST /api/phones/exchange` is reachable only through a pairing-mode secure
 * channel: the remote request gate admits it from nothing else, and the route
 * checks the marker again. The handshake already proved the caller's link
 * key, so the route mints the `phone` token bound to that key and revokes any
 * earlier active phone record with the same `clientId` (D-2).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import {
  createAccessToken,
  findActiveChannelTokenByKey,
  listActiveRecordsOfKind,
  PHONE_TOKEN_SCOPES,
  revokeAccessToken,
} from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
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

// WI-8 (phones-self-routes) adds DELETE /api/phones/self and PUT /api/phones/self/push-key here.
export const phonesRouteLayer = Layer.mergeAll(exchangeRoute);
