/**
 * Operator-side machine-link routes (PAN-4645 WI-12, WI-13).
 *
 * - `POST /api/machines/link` takes a `pan pair` link from another machine and
 *   creates the link (and, by default, the reverse one).
 * - `GET /api/machines` lists this machine, its links and the machines that
 *   link to it (inbound machine tokens). Views never carry a token or hash.
 * - `DELETE /api/machines/:id` unlinks: tells the peer (best effort, 2.5 s,
 *   through the link supervisor once WI-18 provides it), revokes the reverse
 *   token we issued the peer (closing its channels here) and removes the link.
 * - `DELETE /api/machines/self` lets a linked machine revoke its own token.
 * - `DELETE /api/machines/inbound/:tokenId` removes a machine that links to us.
 *
 * Admin only (except `self`, which takes exactly a machine credential), and
 * never from a channel: no link may create, list or use another machine's links
 * (FR-4).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import type { InboundMachineView, MachinesResponse } from '@overdeck/contracts';

import {
  listActiveRecordsOfKind,
  MACHINE_ACCESS_LEVELS,
  type PublicAccessTokenRecord,
  revokeAccessToken,
} from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { getLink, listLinks, type MachineLink, removeLink, setLinkRoutes } from '../../../lib/anywhere/link-store.js';
import { ensureMachineKey, machineKeyFingerprint } from '../../../lib/anywhere/machine-key.js';
import { classifyHost, parseRouteUrl } from '../../../lib/anywhere/routes.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { closeChannelsForPeer } from '../channel-listener.js';
import { channelOfRequest } from '../channel-peer.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { createMachineLink, type LinkStatusSource, MachineLinkError, machineLinkView } from '../services/machine-link-service.js';
import { type DashboardCredential, rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';

/** Tell the peer we are unlinking: `DELETE /api/machines/self` through its link. Resolves true when the peer answered. */
export type PeerUnlinkNotifier = (link: MachineLink) => Promise<boolean>;

const NOTIFY_TIMEOUT_MS = 2_500;

/**
 * Until the link supervisor (WI-18) installs a real notifier there is no open
 * channel to a peer, so the default reports `peerNotified: false` and the
 * reverse-token revoke does the enforcing.
 */
let peerUnlinkNotifier: PeerUnlinkNotifier = async () => false;
let statusSource: LinkStatusSource | null = null;

export function setPeerUnlinkNotifier(notifier: PeerUnlinkNotifier | null): void {
  peerUnlinkNotifier = notifier ?? (async () => false);
}

/** WI-18 registers the supervisor here so `GET /api/machines` reports live state. */
export function setLinkStatusSource(source: LinkStatusSource | null): void {
  statusSource = source;
}

/** A link was created or removed: let the supervisor pick it up now rather than on its next tick. */
export function notifyLinksChanged(): void {
  statusSource?.reconcile?.();
}

function inboundView(record: PublicAccessTokenRecord): InboundMachineView {
  return {
    tokenId: record.id,
    environmentId: record.environmentId ?? '',
    label: record.name.replace(/^machine:/, ''),
    fingerprint: record.machineKey ? machineKeyFingerprint(record.machineKey) : '',
    access: record.access ?? 'operator',
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

export async function buildMachinesResponse(): Promise<MachinesResponse> {
  const [identity, key, links] = await Promise.all([ensureEnvironmentIdentity(), ensureMachineKey(), listLinks()]);
  return {
    self: { environmentId: identity.environmentId, label: identity.label, fingerprint: machineKeyFingerprint(key.publicKey) },
    links: links.map((link) => (statusSource ? machineLinkView(link, null, statusSource) : machineLinkView(link, null))),
    inbound: listActiveRecordsOfKind('machine').map(inboundView),
  };
}

async function notifyPeerWithin(link: MachineLink, notifier: PeerUnlinkNotifier): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), NOTIFY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([notifier(link).catch(() => false), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Unlink by link id, environment id or label. */
export async function handleMachinesUnlink(
  idOrEnvOrLabel: string,
  notifier: PeerUnlinkNotifier = peerUnlinkNotifier,
): Promise<HttpServerResponse.HttpServerResponse> {
  const link = await getLink(idOrEnvOrLabel);
  if (!link) return jsonResponse({ error: `no machine link matches ${idOrEnvOrLabel}` }, { status: 404 });
  const peerNotified = await notifyPeerWithin(link, notifier);
  if (link.reverseTokenId) {
    await revokeAccessToken(link.reverseTokenId);
    closeDeviceConnections(link.reverseTokenId);
  }
  closeChannelsForPeer(link.machineKey);
  await removeLink(link.id);
  notifyLinksChanged();
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Unlinked machine "${link.label}"`,
    details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, peerNotified }),
  });
  return jsonResponse({ ok: true, peerNotified });
}

/** A linked machine revokes its own token (the peer unlinked us). Exactly a machine credential may call this. */
export async function handleMachinesSelfRevoke(credential: DashboardCredential | null): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') {
    return jsonResponse({ error: 'only a linked machine may revoke itself' }, { status: 403 });
  }
  const revoked = await revokeAccessToken(credential.tokenId);
  closeDeviceConnections(credential.tokenId);
  if (revoked?.machineKey) closeChannelsForPeer(revoked.machineKey);
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Machine "${revoked?.name.replace(/^machine:/, '') ?? credential.environmentId}" unlinked itself`,
    details: JSON.stringify({ tokenId: credential.tokenId, environmentId: credential.environmentId }),
  });
  return jsonResponse({ ok: true });
}

/** The operator removes a machine that links to us: revoke its inbound token and close its channels. */
export async function handleInboundRevoke(tokenId: string): Promise<HttpServerResponse.HttpServerResponse> {
  const target = listActiveRecordsOfKind('machine').find((record) => record.id === tokenId);
  if (!target) return jsonResponse({ error: `no inbound machine token with id ${tokenId}` }, { status: 404 });
  const revoked = await revokeAccessToken(tokenId);
  closeDeviceConnections(tokenId);
  const closedChannels = target.machineKey ? closeChannelsForPeer(target.machineKey) : 0;
  emitActivityEntry({
    source: 'dashboard',
    level: 'info',
    message: `Removed inbound machine "${target.name.replace(/^machine:/, '')}"`,
    details: JSON.stringify({ tokenId, environmentId: target.environmentId, closedChannels }),
  });
  return jsonResponse({ ok: true, inbound: revoked ? inboundView(revoked) : null, closedChannels });
}

const ERROR_STATUS: Record<MachineLinkError['code'], number> = {
  'bad-pairing-url': 400,
  'unreachable': 502,
  'pairing-refused': 401,
  'unsupported': 409,
  'identity-mismatch': 409,
  'exchange-failed': 502,
};

function parseLinkBody(text: string): { pairingUrl: string; bothWays: boolean; access: 'operator' | 'agent-fenced'; allowLoopback: boolean } | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  if (typeof body.pairingUrl !== 'string' || body.pairingUrl === '') return 'pairingUrl must be a non-empty string';
  if (body.bothWays !== undefined && typeof body.bothWays !== 'boolean') return 'bothWays must be a boolean';
  if (body.allowLoopback !== undefined && typeof body.allowLoopback !== 'boolean') return 'allowLoopback must be a boolean';
  if (body.access !== undefined && !(MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(body.access)) return `access must be one of ${MACHINE_ACCESS_LEVELS.join(', ')}`;
  return {
    pairingUrl: body.pairingUrl,
    bothWays: body.bothWays ?? true,
    access: (body.access as 'operator' | 'agent-fenced' | undefined) ?? 'operator',
    allowLoopback: body.allowLoopback ?? false,
  };
}

const linkRoute = HttpRouter.add(
  'POST',
  '/api/machines/link',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot create links here' }, { status: 403 });
    }
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = parseLinkBody(yield* request.text);
    if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });

    const outcome = yield* Effect.promise(() => createMachineLink(body).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
    if (!outcome.ok) {
      const error = outcome.error;
      if (error instanceof MachineLinkError) {
        return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: ERROR_STATUS[error.code] });
      }
      return jsonResponse({ error: 'link-failed', message: (error as Error).message }, { status: 500 });
    }
    const { link, view } = outcome.result;
    notifyLinksChanged();
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Linked machine "${link.label}"`,
      details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, access: link.access, bothWays: body.bothWays, route: view.routes[0]?.url ?? null }),
    });
    return jsonResponse(view);
  }),
);

function refuseChannel(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null {
  return channelOfRequest(request) !== null
    ? jsonResponse({ error: 'a linked machine cannot manage links here' }, { status: 403 })
    : null;
}

const listRoute = HttpRouter.add(
  'GET',
  '/api/machines',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildMachinesResponse()));
  }),
);

const selfRevokeRoute = HttpRouter.add(
  'DELETE',
  '/api/machines/self',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.promise(() => handleMachinesSelfRevoke(resolveRequestCredential(request)));
  }),
);

const unlinkRoute = HttpRouter.add(
  'DELETE',
  '/api/machines/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    // Whichever route the router matched first, `self` is the peer's own revoke.
    if (id === 'self') return yield* Effect.promise(() => handleMachinesSelfRevoke(resolveRequestCredential(request)));
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    return yield* Effect.promise(() => handleMachinesUnlink(id));
  }),
);

const reconnectRoute = HttpRouter.add(
  'POST',
  '/api/machines/:id/reconnect',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const link = yield* Effect.promise(() => getLink(id));
    if (!link) return jsonResponse({ error: `no machine link matches ${id}` }, { status: 404 });
    if (!statusSource?.reconnect) return jsonResponse({ error: 'the link supervisor is not running on this dashboard' }, { status: 503 });
    const started = statusSource.reconnect(link.id);
    return jsonResponse({ ok: started, link: machineLinkView(link, null, statusSource) }, { status: started ? 200 : 409 });
  }),
);

/** WI-19 Add route: a `manual` route the operator knows reaches the machine. */
export async function handleAddRoute(idOrEnvOrLabel: string, bodyText: string): Promise<HttpServerResponse.HttpServerResponse> {
  const link = await getLink(idOrEnvOrLabel);
  if (!link) return jsonResponse({ error: `no machine link matches ${idOrEnvOrLabel}` }, { status: 404 });
  let url: unknown;
  try {
    url = (JSON.parse(bodyText || '{}') as { url?: unknown }).url;
  } catch {
    return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
  }
  if (typeof url !== 'string') return jsonResponse({ error: 'body must be { url: string } (tcp://host:port or wss://host[:port])' }, { status: 400 });
  let parsed;
  try {
    parsed = parseRouteUrl(url);
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, { status: 400 });
  }
  if (link.routes.some((route) => route.url === parsed.url)) {
    return jsonResponse({ error: `${parsed.url} is already a route of ${link.label}`, link: machineLinkView(link, null, statusSource ?? undefined) }, { status: 409 });
  }
  const routes = [...link.routes, { url: parsed.url, kind: classifyHost(parsed.host), source: 'manual' as const, addedAt: new Date().toISOString() }];
  const updated = await setLinkRoutes(link.id, routes);
  statusSource?.updateRoutes?.(link.id, routes);
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Added route ${parsed.url} to machine "${link.label}"`, details: JSON.stringify({ linkId: link.id }) });
  return jsonResponse(machineLinkView(updated ?? { ...link, routes }, null, statusSource ?? undefined));
}

const addRouteRoute = HttpRouter.add(
  'POST',
  '/api/machines/:id/routes',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const text = yield* request.text;
    return yield* Effect.promise(() => handleAddRoute(id, text));
  }),
);

const inboundRevokeRoute = HttpRouter.add(
  'DELETE',
  '/api/machines/inbound/:tokenId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    const tokenId = (yield* HttpRouter.params)['tokenId'] ?? '';
    return yield* Effect.promise(() => handleInboundRevoke(tokenId));
  }),
);

export const machinesRouteLayer = Layer.mergeAll(linkRoute, listRoute, selfRevokeRoute, unlinkRoute, reconnectRoute, addRouteRoute, inboundRevokeRoute);
