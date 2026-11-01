/**
 * Machine link creation (PAN-4645 WI-12, FR-1) and the link view (WI-13).
 *
 * `createMachineLink` turns a `pan pair` link from another machine into a
 * machine link, in this order (D-4645-18, continue.json D14):
 *
 *  1. `routeFromPairingUrl`: the transport route and the pairing code.
 *  2. `ensureMachineKey`: our static key.
 *  3. `openChannel` in pairing mode (Noise XXpsk0 keyed by the code). Only now
 *     is the peer's machine key known.
 *  4. `GET /api/environment` through the channel: the peer's environment id,
 *     label and capabilities. No `machineLinks` capability or another link
 *     protocol ⇒ `unsupported`, nothing minted, nothing written.
 *  5. With "link both ways", mint the reverse `machine` token bound to the
 *     peer's key.
 *  6. `POST /api/machines/exchange` through the channel; the peer mints our
 *     token and, when we sent a reverse token, writes its own link to us.
 *  7. `upsertLink` with the pairing route plus the peer's advertised
 *     endpoints; a replaced link's old reverse token is revoked.
 *
 * Any failure after step 5 revokes the reverse token before the error is
 * returned. Every dependency is injectable so the flow is unit-tested with
 * in-process fakes; the two-dashboard smoke (WI-21) runs it for real.
 */
import { request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';

import { Schema } from 'effect';
import {
  type AdvertisedEndpoint,
  EnvironmentDescriptor,
  LINK_PROTOCOL_VERSION,
  type LinkAccess,
  type MachineLinkView,
} from '@overdeck/contracts';

import { createAccessToken, MACHINE_TOKEN_SCOPES, revokeAccessToken } from '../../../lib/access-tokens.js';
import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, openChannel, type TransportUrl } from '../../../lib/anywhere/channel/open.js';
import { type MachineLink, upsertLink } from '../../../lib/anywhere/link-store.js';
import { ensureMachineKey, machineKeyFingerprint } from '../../../lib/anywhere/machine-key.js';
import { type LinkRoute, mergeAdvertised, routeFromPairingUrl } from '../../../lib/anywhere/routes.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';

export const MACHINE_EXCHANGE_PATH = '/api/machines/exchange';
const CHANNEL_REQUEST_TIMEOUT_MS = 10_000;

export type MachineLinkErrorCode =
  | 'bad-pairing-url'
  | 'unreachable'
  | 'pairing-refused'
  | 'unsupported'
  | 'identity-mismatch'
  | 'exchange-failed';

export class MachineLinkError extends Error {
  constructor(
    readonly code: MachineLinkErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MachineLinkError';
  }
}

/** Body of `POST /api/machines/exchange` (sent by the linking machine over the pairing channel). */
export interface ExchangeRequest {
  v: 1;
  environmentId: string;
  label: string;
  access: LinkAccess;
  reverse: { token: string; endpoints: AdvertisedEndpoint[] } | null;
}

export interface ExchangeResponse {
  v: 1;
  token: string;
  tokenId: string;
  descriptor: EnvironmentDescriptor;
  reverseLinkId: string | null;
}

export interface ChannelJsonResponse {
  status: number;
  json: unknown;
}

/** One JSON request through an open channel: `http.request` with the channel as its connection. */
export function channelRequest(
  channel: ChannelSocket,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ChannelJsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = httpRequest(
      {
        method,
        path,
        host: 'link.invalid',
        createConnection: () => channel as unknown as Socket,
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
        timeout: CHANNEL_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { error: 'invalid-json', text };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} over the channel timed out`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface MachineLinkServiceDeps {
  openChannel: (url: TransportUrl, opts: Parameters<typeof openChannel>[1]) => Promise<ChannelSocket>;
  channelRequest: typeof channelRequest;
  ensureMachineKey: typeof ensureMachineKey;
  createAccessToken: typeof createAccessToken;
  revokeAccessToken: typeof revokeAccessToken;
  upsertLink: typeof upsertLink;
  /** This machine's advertised endpoints, sent to the peer with the reverse token (WI-19). */
  currentEndpoints: () => Promise<AdvertisedEndpoint[]>;
  localIdentity: () => Promise<{ environmentId: string; label: string }>;
  now: () => string;
}

const defaultDeps: MachineLinkServiceDeps = {
  openChannel,
  channelRequest,
  ensureMachineKey,
  createAccessToken,
  revokeAccessToken,
  upsertLink,
  currentEndpoints: async () => [],
  localIdentity: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  now: () => new Date().toISOString(),
};

export interface CreateMachineLinkInput {
  pairingUrl: string;
  bothWays?: boolean;
  access?: LinkAccess;
  allowLoopback?: boolean;
}

const decodeDescriptor = Schema.decodeUnknownOption(EnvironmentDescriptor);

/** The peer must speak our link protocol and accept machine links (NFR-4). */
function requireLinkCapable(descriptor: EnvironmentDescriptor, label: string): void {
  if (descriptor.capabilities.machineLinks !== true || descriptor.linkProtocol !== LINK_PROTOCOL_VERSION) {
    throw new MachineLinkError(
      'unsupported',
      `${label} runs Overdeck ${descriptor.serverVersion}, which does not support machine links at protocol ${LINK_PROTOCOL_VERSION}; install a matching version there`,
      { serverVersion: descriptor.serverVersion, linkProtocol: descriptor.linkProtocol ?? null },
    );
  }
}

export async function createMachineLink(
  input: CreateMachineLinkInput,
  overrides: Partial<MachineLinkServiceDeps> = {},
): Promise<{ link: MachineLink; view: MachineLinkView; peer: EnvironmentDescriptor }> {
  const deps = { ...defaultDeps, ...overrides };
  const bothWays = input.bothWays ?? true;
  const access: LinkAccess = input.access ?? 'operator';

  let route;
  try {
    route = routeFromPairingUrl(input.pairingUrl, { allowLoopback: input.allowLoopback ?? false });
  } catch (error) {
    throw new MachineLinkError('bad-pairing-url', (error as Error).message);
  }
  const localKey = await deps.ensureMachineKey();

  let channel: ChannelSocket;
  try {
    channel = await deps.openChannel(route.url as TransportUrl, { mode: 'pairing', localKey, pairingCode: route.pairingCode });
  } catch (error) {
    if (error instanceof ChannelOpenError) {
      const code: MachineLinkErrorCode = error.code === 'pairing-refused' || error.code === 'busy' ? 'pairing-refused'
        : error.code === 'unsupported' ? 'unsupported'
          : 'unreachable';
      throw new MachineLinkError(code, `${route.url}: ${error.message}`, error.detail as Record<string, unknown>);
    }
    throw new MachineLinkError('unreachable', `${route.url}: ${(error as Error).message}`);
  }

  let reverseTokenId: string | null = null;
  try {
    const peerKeyHex = channel.channel.remoteKeyHex;
    const environment = await deps.channelRequest(channel, 'GET', '/api/environment');
    const peer = decodeDescriptor(environment.json);
    if (environment.status !== 200 || peer._tag === 'None') {
      throw new MachineLinkError('unsupported', `${route.url} did not return an environment descriptor (status ${environment.status})`);
    }
    requireLinkCapable(peer.value, peer.value.label);
    if (peer.value.machineKey !== peerKeyHex) {
      throw new MachineLinkError('identity-mismatch', `${peer.value.label} advertises a machine key other than the one it proved in the handshake`);
    }

    let reverseToken: string | null = null;
    if (bothWays) {
      const minted = await deps.createAccessToken({
        name: `machine:${peer.value.label}`,
        kind: 'machine',
        scopes: MACHINE_TOKEN_SCOPES(access),
        machineKey: peerKeyHex,
        environmentId: peer.value.environmentId,
        access,
      });
      reverseToken = minted.token;
      reverseTokenId = minted.record.id;
    }

    const ours = await deps.localIdentity();
    const exchange = await deps.channelRequest(channel, 'POST', MACHINE_EXCHANGE_PATH, {
      v: 1,
      environmentId: ours.environmentId,
      label: ours.label,
      access,
      reverse: reverseToken ? { token: reverseToken, endpoints: await deps.currentEndpoints() } : null,
    } satisfies ExchangeRequest);
    const response = exchange.json as Partial<ExchangeResponse> | null;
    if (exchange.status !== 200 || !response || response.v !== 1 || typeof response.token !== 'string' || !response.token.startsWith('odk_')) {
      const detail = (exchange.json as { error?: unknown } | null)?.error;
      throw new MachineLinkError('exchange-failed', `${peer.value.label} refused the exchange (status ${exchange.status}${detail ? `: ${String(detail)}` : ''})`);
    }
    const confirmed = decodeDescriptor(response.descriptor);
    if (confirmed._tag === 'None') throw new MachineLinkError('exchange-failed', `${peer.value.label} returned no descriptor with the token`);
    requireLinkCapable(confirmed.value, confirmed.value.label);

    const pairingRoute: LinkRoute = { url: route.url, kind: route.kind, source: 'pairing', addedAt: deps.now() };
    const routes = mergeAdvertised([pairingRoute], confirmed.value.endpoints ?? [], deps.now);
    const { link, replaced } = await deps.upsertLink({
      environmentId: confirmed.value.environmentId,
      label: confirmed.value.label,
      machineKey: peerKeyHex,
      token: response.token,
      access,
      reverseTokenId,
      routes,
    });
    if (replaced?.reverseTokenId && replaced.reverseTokenId !== reverseTokenId) {
      await deps.revokeAccessToken(replaced.reverseTokenId).catch(() => null);
    }
    return { link, view: machineLinkView(link, confirmed.value.serverVersion), peer: confirmed.value };
  } catch (error) {
    if (reverseTokenId) await deps.revokeAccessToken(reverseTokenId).catch(() => null);
    throw error;
  } finally {
    channel.destroy();
  }
}

/** Live state for a link; WI-18's supervisor provides the real one. */
export interface LinkStatusSource {
  status(linkId: string): Pick<MachineLinkView, 'state' | 'stateDetail' | 'currentRoute' | 'lastHeartbeatAt' | 'incident'> & {
    routeStatus: (url: string) => MachineLinkView['routes'][number]['status'];
  };
}

export const connectingStatusSource: LinkStatusSource = {
  status: () => ({ state: 'connecting', stateDetail: null, currentRoute: null, lastHeartbeatAt: null, incident: null, routeStatus: () => 'untried' }),
};

/** The public face of a link: never the token. */
export function machineLinkView(link: MachineLink, peerVersion: string | null, source: LinkStatusSource = connectingStatusSource): MachineLinkView {
  const live = source.status(link.id);
  return {
    id: link.id,
    environmentId: link.environmentId,
    label: link.label,
    fingerprint: machineKeyFingerprint(link.machineKey),
    access: link.access,
    state: link.revokedAt ? 'revoked' : live.state,
    stateDetail: live.stateDetail,
    currentRoute: live.currentRoute,
    routes: link.routes.map((route) => ({ url: route.url, kind: route.kind, source: route.source, status: live.routeStatus(route.url) })),
    lastHeartbeatAt: live.lastHeartbeatAt,
    incident: live.incident,
    peerVersion,
    createdAt: link.createdAt,
  };
}
