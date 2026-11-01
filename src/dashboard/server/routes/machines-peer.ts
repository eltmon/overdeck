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

import { MACHINE_ACCESS_LEVELS, type MachineAccess } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { endStreamOnDeviceRevocation } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { currentApprovalService } from '../services/directory-approval.js';
import { startHeartbeatSource } from '../services/link-heartbeat.js';
import { grantMachineLink, GrantMachineLinkError } from '../services/machine-link-grant.js';
import { resolveRequestCredential } from './dashboard-auth.js';
import { buildEnvironmentDescriptor } from './environment.js';
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

  let granted;
  try {
    granted = await grantMachineLink({
      environmentId: body.environmentId,
      label: body.label,
      peerKeyHex: channel.remoteKeyHex,
      access: body.access,
      reverse: body.reverse,
    });
  } catch (error) {
    if (error instanceof GrantMachineLinkError) return jsonResponse({ error: error.message }, { status: 400 });
    throw error;
  }
  const { token, record, reverseLinkId } = granted;

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
 * `POST /api/machines/approval-exchange` (PAN-2356 WI-14): the approver's half of a two-screen
 * approval. Reachable only through an approval-mode channel (the request gate refuses every other
 * socket, and the service checks the marker again).
 */
const approvalExchangeRoute = HttpRouter.add(
  'POST',
  '/api/machines/approval-exchange',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const channel = channelOfRequest(request);
    if (channel?.mode !== 'approval') {
      return jsonResponse({ error: 'the approval exchange is accepted only inside an approval channel' }, { status: 403 });
    }
    const service = currentApprovalService();
    if (!service) return jsonResponse({ error: 'approval-refused' }, { status: 403 });
    const text = yield* request.text;
    const answer = yield* Effect.promise(() => service.handleExchange(text, channel));
    return jsonResponse(answer.json, { status: answer.status });
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

export const machinesPeerRouteLayer = Layer.mergeAll(exchangeRoute, approvalExchangeRoute, heartbeatRoute);
