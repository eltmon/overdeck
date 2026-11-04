/**
 * Operator-side machine-link routes (PAN-4645 WI-12, WI-13).
 *
 * - `POST /api/machines/link` takes a `pan pair` link from another machine and
 *   creates the link (and, by default, the reverse one).
 * - `GET /api/machines` lists this machine, its links and the machines that
 *   link to it (inbound machine tokens). Views never carry a token or hash.
 * - `DELETE /api/machines/:id[?keepServer=1]` unlinks: tells the peer (best
 *   effort, 2.5 s, through the link supervisor once WI-18 provides it), tears
 *   down an SSH machine's side (PAN-4404: stops the host's server only when this
 *   machine started it and `keepServer` is not set, then the forward), destroys
 *   a Fly machine unless `keepServer` (PAN-4652) and deletes its record, revokes
 *   the reverse token we issued the peer (closing its channels here) and
 *   removes the link.
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
import { readAnywhereSettings, writeAnywhereSettings } from '../../../lib/anywhere/anywhere-settings.js';
import { getLink, listLinks, type MachineLink, removeLink, setLinkHidden, setLinkRoutes } from '../../../lib/anywhere/link-store.js';
import { invalidateSharedConversations } from '../../../lib/anywhere/shared-conversations.js';
import { LinkUnavailableError } from '../../../lib/anywhere/link-client.js';
import { ForwardRefusedError, listForwards, startForward, stopForward } from '../services/port-forwards.js';
import { currentMachineProfile } from '../../../lib/anywhere/machine-capabilities.js';
import { ensureMachineKey, machineKeyFingerprint } from '../../../lib/anywhere/machine-key.js';
import { classifyHost, parseRouteUrl } from '../../../lib/anywhere/routes.js';
import { FLY_MACHINE_ERROR_STATUS, FlyMachineError } from '../../../lib/anywhere/fly/provision.js';
import { SshMachineError } from '../../../lib/anywhere/ssh/target.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { loadConfig } from '../../../lib/config.js';
import { displayPath } from '../../../lib/remote-enabled.js';
import { CONFIG_FILE } from '../../../lib/paths.js';
import { closeChannelsForPeer } from '../channel-listener.js';
import { channelOfRequest } from '../channel-peer.js';
import { closeDeviceConnections } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { createMachineLink, type LinkStatusSource, MachineLinkError, machineLinkView } from '../services/machine-link-service.js';
import { type FlyRemoval, removeFlyMachineForLink } from '../services/fly-machine-service.js';
import { currentMachineLoad } from '../services/machine-load.js';
import {
  reconnectSshMachine,
  removeSshMachineForLink,
  SSH_MACHINE_ERROR_STATUS,
  type SshRemoval,
  sshInfoForLink,
} from '../services/ssh-machine-service.js';
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
  const [identity, key, links, settings, config] = await Promise.all([ensureEnvironmentIdentity(), ensureMachineKey(), listLinks(), readAnywhereSettings(), loadConfig()]);
  const sshInfos = await Promise.all(links.map((link) => sshInfoForLink(link.id)));
  return {
    self: {
      environmentId: identity.environmentId,
      label: identity.label,
      fingerprint: machineKeyFingerprint(key.publicKey),
      shareConversations: settings.shareConversations,
      combineRepositories: settings.combineRepositories,
      // PAN-4651 D-4651-8: this machine's own load sample, tags and placement mode.
      load: currentMachineLoad(),
      tags: currentMachineProfile()?.tags ?? [],
      placement: currentMachineProfile()?.placement ?? 'auto',
      // PAN-4905: the Add a Fly machine dialog reads this before the click.
      remoteEnabled: config.remote?.enabled === true,
      remoteConfigFile: displayPath(CONFIG_FILE),
    },
    links: links.map((link, index) => {
      const view = statusSource ? machineLinkView(link, null, statusSource) : machineLinkView(link, null);
      const ssh = sshInfos[index];
      return ssh ? { ...view, ssh } : view;
    }),
    inbound: listActiveRecordsOfKind('machine').map(inboundView),
  };
}

function sshFailure(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof SshMachineError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: SSH_MACHINE_ERROR_STATUS[error.code] });
  }
  if (error instanceof FlyMachineError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: FLY_MACHINE_ERROR_STATUS[error.code] });
  }
  throw error;
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

/** Unlink by link id, environment id or label. `keepServer` leaves an SSH machine's server or a Fly machine running. */
export async function handleMachinesUnlink(
  idOrEnvOrLabel: string,
  notifier: PeerUnlinkNotifier = peerUnlinkNotifier,
  options: { keepServer?: boolean } = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const link = await getLink(idOrEnvOrLabel);
  if (!link) return jsonResponse({ error: `no machine link matches ${idOrEnvOrLabel}` }, { status: 404 });
  const peerNotified = await notifyPeerWithin(link, notifier);
  let ssh: SshRemoval | null;
  let fly: FlyRemoval | null;
  try {
    ssh = await removeSshMachineForLink(link, { keepServer: options.keepServer === true });
    fly = await removeFlyMachineForLink(link, { keepServer: options.keepServer === true });
  } catch (error) {
    return sshFailure(error);
  }
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
    details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, peerNotified, ssh, fly }),
  });
  return jsonResponse({ ok: true, peerNotified, ssh, fly });
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

export const ERROR_STATUS: Record<MachineLinkError['code'], number> = {
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
    const keepServer = new URL(request.url, 'http://localhost').searchParams.get('keepServer') === '1';
    return yield* Effect.promise(() => handleMachinesUnlink(id, peerUnlinkNotifier, { keepServer }));
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
    // An SSH machine: restart the forward and re-run start-or-adopt on the host first.
    const sshOutcome = yield* Effect.promise(() => reconnectSshMachine(link).then(
      () => null,
      (error: unknown) => error,
    ));
    if (sshOutcome !== null) return sshFailure(sshOutcome);
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
  if (parsed.transport === 'rtc') {
    // Direct and relay routes come from the overdeck.ai directory and are never stored (PAN-2356 D-2356-7).
    return jsonResponse({ error: 'rtc routes come from the overdeck.ai directory and cannot be added by hand' }, { status: 400 });
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

/** PAN-4650 D-4/D-4650-15: `PUT /api/machines/sharing { conversations }` turns Share my conversations on or off. */
/** `PUT /api/machines/sharing { conversations?, combineRepositories? }` (PAN-4651 D-4651-13: each optional, at least one). */
export async function handleSetSharing(bodyText: string): Promise<HttpServerResponse.HttpServerResponse> {
  let body: { conversations?: unknown; combineRepositories?: unknown };
  try {
    body = JSON.parse(bodyText || '{}') as typeof body;
  } catch {
    return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
  }
  const { conversations, combineRepositories } = body;
  const valid = (value: unknown) => value === undefined || typeof value === 'boolean';
  if (!valid(conversations) || !valid(combineRepositories) || (conversations === undefined && combineRepositories === undefined)) {
    return jsonResponse({ error: 'body must be { conversations?: boolean, combineRepositories?: boolean } with at least one' }, { status: 400 });
  }
  try {
    const settings = await writeAnywhereSettings({
      ...(conversations !== undefined ? { shareConversations: conversations as boolean } : {}),
      ...(combineRepositories !== undefined ? { combineRepositories: combineRepositories as boolean } : {}),
    });
    // Linked machines see the change on their next heartbeat (a new list hash).
    if (conversations !== undefined) invalidateSharedConversations();
    return jsonResponse({ conversations: settings.shareConversations, combineRepositories: settings.combineRepositories });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, { status: 500 });
  }
}

/** PAN-4650 WI-18: `POST /api/machines/:id/forwards { port }` forwards a port of that machine to 127.0.0.1 here. */
export async function handleStartForward(idOrEnvOrLabel: string, bodyText: string): Promise<HttpServerResponse.HttpServerResponse> {
  let port: unknown;
  try {
    port = (JSON.parse(bodyText || '{}') as { port?: unknown }).port;
  } catch {
    return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
  }
  if (typeof port !== 'number' || !Number.isInteger(port)) return jsonResponse({ error: 'body must be { port: number }' }, { status: 400 });
  try {
    return jsonResponse(await startForward(idOrEnvOrLabel, port));
  } catch (error) {
    if (error instanceof ForwardRefusedError) return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof LinkUnavailableError) return jsonResponse({ error: error.message, code: error.code }, { status: 503 });
    return jsonResponse({ error: (error as Error).message, code: 'forward-failed' }, { status: 502 });
  }
}

const startForwardRoute = HttpRouter.add(
  'POST',
  '/api/machines/:id/forwards',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const text = yield* request.text;
    return yield* Effect.promise(() => handleStartForward(id, text));
  }),
);

const listForwardsRoute = HttpRouter.add(
  'GET',
  '/api/machines/forwards',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    return jsonResponse({ forwards: listForwards() });
  }),
);

const stopForwardRoute = HttpRouter.add(
  'DELETE',
  '/api/machines/forwards/:forwardId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    const id = (yield* HttpRouter.params)['forwardId'] ?? '';
    return stopForward(id) ? jsonResponse({ ok: true }) : jsonResponse({ error: `no forward ${id}` }, { status: 404 });
  }),
);

const setSharingRoute = HttpRouter.add(
  'PUT',
  '/api/machines/sharing',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const text = yield* request.text;
    return yield* Effect.promise(() => handleSetSharing(text));
  }),
);

/** PAN-4650 D-4650-15: `PATCH /api/machines/:id { hidden }` shows or hides a machine's conversations. */
export async function handleSetHidden(idOrEnvOrLabel: string, bodyText: string): Promise<HttpServerResponse.HttpServerResponse> {
  const link = await getLink(idOrEnvOrLabel);
  if (!link) return jsonResponse({ error: `no machine link matches ${idOrEnvOrLabel}` }, { status: 404 });
  let hidden: unknown;
  try {
    hidden = (JSON.parse(bodyText || '{}') as { hidden?: unknown }).hidden;
  } catch {
    return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
  }
  if (typeof hidden !== 'boolean') return jsonResponse({ error: 'body must be { hidden: boolean }' }, { status: 400 });
  const updated = await setLinkHidden(link.id, hidden);
  return jsonResponse(machineLinkView(updated ?? link, null, statusSource ?? undefined));
}

const setHiddenRoute = HttpRouter.add(
  'PATCH',
  '/api/machines/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseChannel(request) ?? rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const text = yield* request.text;
    return yield* Effect.promise(() => handleSetHidden(id, text));
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

export const machinesRouteLayer = Layer.mergeAll(linkRoute, listRoute, selfRevokeRoute, unlinkRoute, reconnectRoute, addRouteRoute, setSharingRoute, setHiddenRoute, inboundRevokeRoute,
  startForwardRoute, listForwardsRoute, stopForwardRoute);
