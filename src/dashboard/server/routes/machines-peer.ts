/**
 * Routes a linked (or pairing) machine calls on this dashboard (PAN-4645 WI-12).
 *
 * `POST /api/machines/exchange` is reachable only through a pairing-mode secure
 * channel: the remote request gate admits it from nothing else, and the route
 * checks the marker again. The handshake already proved the caller's machine
 * key, so the route mints the `machine` token bound to that key (revoking the
 * environment's previous one, D-4645-18) and, when the caller sent a reverse
 * token, writes this machine's own link back to it.
 */
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { type AdvertisedEndpoint, ROUTE_KINDS } from '@overdeck/contracts';

import {
  createAccessToken,
  listActiveRecordsOfKind,
  MACHINE_ACCESS_LEVELS,
  MACHINE_TOKEN_SCOPES,
  type MachineAccess,
  revokeAccessToken,
} from '../../../lib/access-tokens.js';
import { upsertLink } from '../../../lib/anywhere/link-store.js';
import { sharedConversations, type SharedConversationsDeps } from '../../../lib/anywhere/shared-conversations.js';
import { type LinkRoute, mergeAdvertised } from '../../../lib/anywhere/routes.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { endStreamOnDeviceRevocation } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { startHeartbeatSource } from '../services/link-heartbeat.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { buildEnvironmentDescriptor } from './environment.js';
import { notifyLinksChanged } from './machines.js';
import { getOverdeckVersion } from './misc/shared.js';

const MAX_LABEL_LENGTH = 200;

interface ExchangeBody {
  environmentId: string;
  label: string;
  access: MachineAccess;
  reverse: { token: string; endpoints: AdvertisedEndpoint[] } | null;
}

function parseExchangeBody(text: string): ExchangeBody | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  if (body.v !== 1) return 'v must be 1';
  if (typeof body.environmentId !== 'string' || body.environmentId === '') return 'environmentId must be a non-empty string';
  if (typeof body.label !== 'string' || body.label.trim() === '' || body.label.length > MAX_LABEL_LENGTH) return `label must be a string of at most ${MAX_LABEL_LENGTH} characters`;
  if (!(MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(body.access)) return `access must be one of ${MACHINE_ACCESS_LEVELS.join(', ')}`;
  let reverse: ExchangeBody['reverse'] = null;
  if (body.reverse !== null && body.reverse !== undefined) {
    const r = body.reverse as Record<string, unknown>;
    if (typeof r !== 'object' || r === null || typeof r.token !== 'string' || !r.token.startsWith('odk_')) return 'reverse.token must be an odk_ token';
    const endpoints = Array.isArray(r.endpoints) ? r.endpoints : [];
    if (!endpoints.every((endpoint) => typeof endpoint === 'object' && endpoint !== null
      && (ROUTE_KINDS as readonly unknown[]).includes((endpoint as { kind?: unknown }).kind)
      && typeof (endpoint as { url?: unknown }).url === 'string')) {
      return 'reverse.endpoints must be { kind, url } entries';
    }
    reverse = { token: r.token, endpoints: endpoints as AdvertisedEndpoint[] };
  }
  return { environmentId: body.environmentId, label: body.label.trim(), access: body.access as MachineAccess, reverse };
}

/**
 * The exchange, separated from the route so tests can pass the channel marker
 * directly. `channel` must be a pairing-mode marker; anything else is 403.
 */
export async function handleMachinesExchange(
  bodyText: string,
  channel: ChannelMarker | null,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (channel?.mode !== 'pairing') {
    return jsonResponse({ error: 'machine exchange is accepted only inside a pairing channel' }, { status: 403 });
  }
  const body = parseExchangeBody(bodyText);
  if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });

  // D-4645-18: one active machine token per peer environment.
  for (const previous of listActiveRecordsOfKind('machine')) {
    if (previous.environmentId === body.environmentId) await revokeAccessToken(previous.id);
  }
  const { token, record } = await createAccessToken({
    name: `machine:${body.label}`,
    kind: 'machine',
    scopes: MACHINE_TOKEN_SCOPES(body.access),
    machineKey: channel.remoteKeyHex,
    environmentId: body.environmentId,
    access: body.access,
  });

  let reverseLinkId: string | null = null;
  if (body.reverse) {
    const now = new Date().toISOString();
    let routes: LinkRoute[];
    try {
      routes = mergeAdvertised([], body.reverse.endpoints, () => now);
    } catch (error) {
      await revokeAccessToken(record.id);
      return jsonResponse({ error: `reverse.endpoints: ${(error as Error).message}` }, { status: 400 });
    }
    const { link, replaced } = await upsertLink({
      environmentId: body.environmentId,
      label: body.label,
      machineKey: channel.remoteKeyHex,
      token: body.reverse.token,
      access: body.access,
      reverseTokenId: record.id,
      routes,
    });
    if (replaced?.reverseTokenId && replaced.reverseTokenId !== record.id) await revokeAccessToken(replaced.reverseTokenId).catch(() => null);
    reverseLinkId = link.id;
    notifyLinksChanged();
  }

  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Linked machine "${body.label}"`,
    details: JSON.stringify({ tokenId: record.id, environmentId: body.environmentId, access: body.access, bothWays: body.reverse !== null }),
  });
  const descriptor = await buildEnvironmentDescriptor();
  return jsonResponse({ v: 1, token, tokenId: record.id, descriptor, reverseLinkId });
}

const exchangeRoute = HttpRouter.add(
  'POST',
  '/api/machines/exchange',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const channel = channelOfRequest(request);
    const text = yield* request.text;
    return yield* Effect.promise(() => handleMachinesExchange(text, channel));
  }),
);

/**
 * `GET /api/machines/heartbeat` (WI-18, D-4645-7): a linked machine's supervisor
 * holds this stream open over its channel. Exactly a machine credential may
 * open it; revoking that credential ends the stream.
 */
const heartbeatRoute = HttpRouter.add(
  'GET',
  '/api/machines/heartbeat',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credential = resolveRequestCredential(request);
    if (credential?.kind !== 'machine') {
      return jsonResponse({ error: 'the heartbeat is for linked machines only' }, { status: 403 });
    }
    const serverVersion = yield* Effect.promise(() => getOverdeckVersion());
    const encoder = new TextEncoder();
    let stop: (() => void) | null = null;
    const nodeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const source = startHeartbeatSource(serverVersion, (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            source.stop();
          }
        });
        stop = () => {
          source.stop();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
      },
      cancel() {
        stop?.();
        stop = null;
      },
    });
    const body = endStreamOnDeviceRevocation(
      Stream.fromReadableStream<Uint8Array, unknown>({ evaluate: () => nodeStream, onError: (error) => error }),
      credential,
    );
    return HttpServerResponse.stream(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }),
);

/**
 * `GET /api/machines/conversations` (PAN-4650 WI-2, FR-1): this machine's shared
 * conversation list, for a linked machine's cache. Exactly a machine credential
 * may read it; the answer is empty with `sharing: false` when sharing is off.
 */
export async function handleSharedConversations(
  credential: DashboardCredential | null,
  deps: Partial<SharedConversationsDeps> = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') {
    return jsonResponse({ error: 'the shared conversation list is for linked machines only' }, { status: 403 });
  }
  try {
    return jsonResponse(await sharedConversations(deps));
  } catch (error) {
    console.error('[machines] shared conversation list failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: 'the shared conversation list could not be built' }, { status: 500 });
  }
}

const sharedConversationsRoute = HttpRouter.add(
  'GET',
  '/api/machines/conversations',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleSharedConversations(resolveRequestCredential(request)));
  }),
);

export const machinesPeerRouteLayer = Layer.mergeAll(exchangeRoute, heartbeatRoute, sharedConversationsRoute);
