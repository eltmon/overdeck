/**
 * Routes a linked (or pairing) machine calls on this dashboard (PAN-4645 WI-12).
 *
 * `POST /api/machines/exchange` is reachable only through a pairing-mode secure
 * channel: the remote request gate admits it from nothing else, and the route
 * checks the marker again. The handshake already proved the caller's machine
 * key, so the route mints the `machine` token bound to that key (revoking the
 * environment's previous one, D-4645-18) and, when the caller sent a reverse
 * token, writes this machine's own link back to it. A code issued for an
 * Overdeck connector is refused (PAN-4927 W-CONN1).
 */
import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { type AdvertisedEndpoint, ROUTE_KINDS } from '@overdeck/contracts';

import { MACHINE_ACCESS_LEVELS, type MachineAccess } from '../../../lib/access-tokens.js';
import { listMachineProjects } from '../../../lib/anywhere/project-origin.js';
import { sharedConversations, type SharedConversationsDeps } from '../../../lib/anywhere/shared-conversations.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { hasConnectorIntent } from '../connector-pairing.js';
import { endStreamOnDeviceRevocation } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { currentApprovalService } from '../services/directory-approval.js';
import { startHeartbeatSource } from '../services/link-heartbeat.js';
import { issueActivity } from '../services/issue-activity.js';
import { buildNeedsYou } from '../services/needs-you-feed.js';
import { grantMachineLink, GrantMachineLinkError } from '../services/machine-link-grant.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
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
  if (channel.pairingId !== null && hasConnectorIntent(channel.pairingId)) {
    return jsonResponse({ error: 'this pairing code is for an Overdeck connector; run pan mcp connector pair with it', code: 'connector-code' }, { status: 403 });
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

/**
 * `GET /api/machines/projects` (PAN-4651 WI-3, D-4651-11): every project this
 * machine has registered as `{ key, name, gitOrigin }` — never a path — for a
 * linked machine's placement and project grouping. Machine credential only.
 */
export async function handleMachineProjects(
  credential: DashboardCredential | null,
  listProjects: typeof listMachineProjects = listMachineProjects,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') {
    return jsonResponse({ error: 'the project list is for linked machines only' }, { status: 403 });
  }
  try {
    return jsonResponse({ projects: await listProjects() });
  } catch (error) {
    console.error('[machines] project list failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: 'the project list could not be built' }, { status: 500 });
  }
}

const machineProjectsRoute = HttpRouter.add(
  'GET',
  '/api/machines/projects',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleMachineProjects(resolveRequestCredential(request)));
  }),
);

/**
 * `GET /api/machines/needs-you` (PAN-4651 WI-20, D-4651-15): this machine's
 * conversations and agents waiting on the operator, for a linked machine's
 * Needs-You list. Machine credential only.
 */
export async function handleNeedsYou(
  credential: DashboardCredential | null,
  build: typeof buildNeedsYou = buildNeedsYou,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') {
    return jsonResponse({ error: 'the Needs-You feed is for linked machines only' }, { status: 403 });
  }
  try {
    return jsonResponse(await build());
  } catch (error) {
    console.error('[machines] Needs-You feed failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: 'the Needs-You feed could not be built' }, { status: 500 });
  }
}

const needsYouRoute = HttpRouter.add(
  'GET',
  '/api/machines/needs-you',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleNeedsYou(resolveRequestCredential(request)));
  }),
);

/** `GET /api/machines/issue-activity?issue=<id>` (PAN-4651 WI-22): this machine's agents and conversations for an issue. */
export async function handleIssueActivity(
  credential: DashboardCredential | null,
  issueId: string,
  read: typeof issueActivity = issueActivity,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return jsonResponse({ error: 'issue activity is for linked machines only' }, { status: 403 });
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(issueId)) return jsonResponse({ error: 'issue must be an issue id like PAN-7' }, { status: 400 });
  return jsonResponse(await read(issueId));
}

const issueActivityRoute = HttpRouter.add(
  'GET',
  '/api/machines/issue-activity',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    const issueId = Option.isSome(url) ? url.value.searchParams.get('issue') ?? '' : '';
    return yield* Effect.promise(() => handleIssueActivity(resolveRequestCredential(request), issueId));
  }),
);

export const machinesPeerRouteLayer = Layer.mergeAll(exchangeRoute, approvalExchangeRoute, heartbeatRoute, sharedConversationsRoute, machineProjectsRoute, needsYouRoute, issueActivityRoute);
