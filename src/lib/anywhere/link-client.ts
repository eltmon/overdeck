/**
 * Reaching a linked machine from this dashboard (PAN-4645 WI-18, FR-3, FR-4).
 *
 * `openLinkSocket` opens one secure channel to a link on the route the link
 * supervisor currently trusts; `linkFetch` sends one JSON request over such a
 * channel with the link's machine token and the actor stamp
 * (`x-overdeck-link-actor`, optional `x-overdeck-link-ceiling`). `LinkAgent`
 * is an `http.Agent` whose connections are channels, so keep-alive pools
 * amortise the 1-RTT handshake (D-4645-3). A pooled channel expires after
 * `LINK_POOL_IDLE_MS` idle; a `GET`/`HEAD`/`OPTIONS` request that dies on a
 * reused channel before any response is resent once on a fresh channel
 * (PAN-4740).
 *
 * An `offline`, `revoked` or `unsupported` link fails at once, and a
 * `connecting` link waits at most `LINK_WAIT_MS` (2.5 s) to come online. The
 * secure-channel open to an online link has its own `LINK_OPEN_MS` (10 s)
 * budget, because the public Fly route often needs more than 2.5 s for TLS,
 * the instance pin and the handshake (PAN-4885). A caller that needs a
 * shorter bound passes its own `signal`. The supervisor registers itself
 * through `setLinkRouteSource`; this module never imports the dashboard.
 */
import { Agent, request as httpRequest, type AgentOptions, type ClientRequestArgs } from 'node:http';
import type { Duplex } from 'node:stream';
import type { LinkState } from '@overdeck/contracts';

import type { AccessTokenScope } from '../access-tokens.js';
import type { ChannelSocket } from './channel/channel-socket.js';
import { openChannel, type TransportUrl } from './channel/open.js';
import { LINK_ACTOR_HEADER, LINK_CEILING_HEADER } from './link-actor.js';
import type { MachineKeyPair } from './machine-key.js';

export const LINK_WAIT_MS = 2_500;

/**
 * Budget for opening a secure channel to an online link: transport connect plus
 * handshake. Separate from `LINK_WAIT_MS`, which only bounds the wait for a
 * connecting link; 2.5 s was too short for the public Fly route (PAN-4885). Same
 * value as the channel package's `DEFAULT_OPEN_TIMEOUT_MS`.
 */
export const LINK_OPEN_MS = 10_000;

/**
 * Longest a pooled channel sits idle before the agent closes it. The other machine's HTTP
 * server closes an idle channel after 5 s; behind the Fly proxy home does not always see that
 * close in time, so the pool must give the channel up first (PAN-4740).
 */
export const LINK_POOL_IDLE_MS = 4_000;

export type LinkUnavailableCode = 'no-link' | 'machine-offline' | 'machine-unreachable' | 'machine-revoked' | 'machine-unsupported';

export class LinkUnavailableError extends Error {
  constructor(
    readonly code: LinkUnavailableCode,
    message: string,
  ) {
    super(message);
    this.name = 'LinkUnavailableError';
  }
}

export interface LinkRouteInfo {
  state: LinkState;
  /** The route the supervisor currently trusts; null unless online. */
  url: TransportUrl | null;
  /** The peer's pinned machine key, 64 hex. */
  machineKey: string;
  /** The machine token the peer issued us. */
  token: string;
  label: string;
}

/** What the link supervisor exposes to this module. */
export interface LinkRouteSource {
  routeFor(environmentId: string): LinkRouteInfo | null;
  /** Resolves true when the link is online, false when `timeoutMs` passes or the link gives up first. */
  waitOnline(environmentId: string, timeoutMs: number): Promise<boolean>;
  localKey(): Promise<MachineKeyPair>;
}

let source: LinkRouteSource | null = null;

export function setLinkRouteSource(next: LinkRouteSource | null): void {
  source = next;
}

function unavailable(info: LinkRouteInfo | null, environmentId: string): LinkUnavailableError | null {
  if (!info) return new LinkUnavailableError('no-link', `No machine link to ${environmentId}`);
  switch (info.state) {
    case 'offline':
      return new LinkUnavailableError('machine-offline', `${info.label} is offline`);
    case 'revoked':
      return new LinkUnavailableError('machine-revoked', `${info.label} revoked this machine's link`);
    case 'unsupported':
      return new LinkUnavailableError('machine-unsupported', `${info.label} runs an Overdeck version without machine links`);
    default:
      return null;
  }
}

/** After a wait for a connecting link gave up: a terminal state keeps its own code, anything else is unreachable. */
function afterWait(info: LinkRouteInfo | null, environmentId: string, label: string): LinkUnavailableError {
  const terminal = unavailable(info, environmentId);
  if (terminal && (terminal.code === 'no-link' || terminal.code === 'machine-revoked' || terminal.code === 'machine-unsupported')) return terminal;
  return new LinkUnavailableError('machine-unreachable', `${label} did not come online within ${LINK_WAIT_MS} ms`);
}

/**
 * One secure channel to a linked machine. Fails at once for an offline, revoked
 * or unsupported link; waits up to LINK_WAIT_MS for a connecting one, then gives
 * the open LINK_OPEN_MS.
 */
export async function openLinkSocket(
  environmentId: string,
  opts: { signal?: AbortSignal; routeSource?: LinkRouteSource } = {},
): Promise<ChannelSocket> {
  const routes = opts.routeSource ?? source;
  if (!routes) throw new LinkUnavailableError('no-link', 'Machine links are not running on this dashboard');
  let info = routes.routeFor(environmentId);
  const early = unavailable(info, environmentId);
  if (early) throw early;
  if (info!.state !== 'online' || !info!.url) {
    const label = info!.label;
    const online = await routes.waitOnline(environmentId, LINK_WAIT_MS);
    info = routes.routeFor(environmentId);
    if (!online || !info || info.state !== 'online' || !info.url) throw afterWait(info, environmentId, label);
  }
  return openChannel(info!.url, {
    mode: 'link',
    localKey: await routes.localKey(),
    remoteKeyHex: info!.machineKey,
    timeoutMs: LINK_OPEN_MS,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

/** An `http.Agent` whose connections are secure channels to one linked machine. */
export class LinkAgent extends Agent {
  constructor(
    readonly environmentId: string,
    options: AgentOptions = {},
    private readonly routeSource?: LinkRouteSource,
  ) {
    super({ keepAlive: true, maxSockets: 4, timeout: LINK_POOL_IDLE_MS, ...options });
  }

  override createConnection(_options: ClientRequestArgs, callback?: (error: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    openLinkSocket(this.environmentId, { routeSource: this.routeSource }).then(
      (channel) => callback?.(null, channel),
      (error: Error) => callback?.(error, undefined as unknown as Duplex),
    );
    // Node's Agent uses the callback form when nothing is returned.
    return undefined;
  }
}

export type LinkActorInit = 'operator' | { agentId: string };

export interface LinkFetchInit {
  method?: string;
  body?: unknown;
  /** Who this request acts for; the linked machine trusts it only inside the channel (FR-4). Default operator. */
  actor?: LinkActorInit;
  /** Scopes the linked machine must not exceed for this request; it can only narrow. */
  ceiling?: AccessTokenScope[];
  signal?: AbortSignal;
  /** Test seam: the agent to send through (default: a pooled LinkAgent for the environment). */
  agent?: Agent;
  routeSource?: LinkRouteSource;
}

const agents = new Map<string, LinkAgent>();

function agentFor(environmentId: string, routeSource?: LinkRouteSource): LinkAgent {
  const existing = agents.get(environmentId);
  if (existing) return existing;
  const created = new LinkAgent(environmentId, {}, routeSource);
  agents.set(environmentId, created);
  return created;
}

/** Methods a stale pooled channel may resend: they change nothing on the other machine (PAN-4740 D3). */
const RETRY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STALE_CHANNEL_CODES = new Set(['ECONNRESET', 'EPIPE']);

/**
 * True when a request died on a reused pooled channel before any response byte: the far end
 * had already closed it. Pure.
 */
export function isStaleChannelFailure(
  method: string, error: unknown, attempt: { reusedSocket: boolean; responded: boolean },
): boolean {
  if (!attempt.reusedSocket || attempt.responded) return false;
  if (!RETRY_SAFE_METHODS.has(method.toUpperCase())) return false;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && STALE_CHANNEL_CODES.has(code);
}

/** Close every idle channel in a pool; they idled and died together (PAN-4740 D4). */
function dropIdleChannels(agent: Agent): void {
  for (const sockets of Object.values(agent.freeSockets)) {
    for (const socket of sockets ?? []) socket.destroy();
  }
}

const ATTEMPT = Symbol('linkAttempt');

interface AttemptFacts {
  reusedSocket: boolean;
  responded: boolean;
}

/** Drop pooled channels to a machine (after unlink or revoke). */
export function closeLinkAgent(environmentId: string): void {
  agents.get(environmentId)?.destroy();
  agents.delete(environmentId);
}

export function _resetLinkClientForTests(): void {
  for (const agent of agents.values()) agent.destroy();
  agents.clear();
  source = null;
}

/** The actor stamp headers for a forwarded request. Pure. */
export function linkActorHeaders(actor: LinkActorInit = 'operator', ceiling?: readonly AccessTokenScope[]): Record<string, string> {
  const headers: Record<string, string> = { [LINK_ACTOR_HEADER]: actor === 'operator' ? 'operator' : `agent:${actor.agentId}` };
  if (ceiling && ceiling.length > 0) headers[LINK_CEILING_HEADER] = ceiling.join(',');
  return headers;
}

/** The link's route once it can carry a request; rejects with `LinkUnavailableError` otherwise. */
async function onlineRoute(environmentId: string, routeSource?: LinkRouteSource): Promise<LinkRouteInfo> {
  const routes = routeSource ?? source;
  if (!routes) throw new LinkUnavailableError('no-link', 'Machine links are not running on this dashboard');
  const info = routes.routeFor(environmentId);
  const early = unavailable(info, environmentId);
  if (early) throw early;
  if (info!.state !== 'online') {
    // The agent would wait too, but failing here keeps the 2.5 s bound explicit.
    const online = await routes.waitOnline(environmentId, LINK_WAIT_MS);
    if (!online) throw afterWait(routes.routeFor(environmentId), environmentId, info!.label);
  }
  return info!;
}

/**
 * One JSON request to a linked machine. Rejects with `LinkUnavailableError`
 * when the link cannot carry it (offline at once, unreachable after 2.5 s).
 */
export async function linkFetch(
  environmentId: string,
  path: string,
  init: LinkFetchInit = {},
): Promise<{ status: number; json: unknown }> {
  const info = await onlineRoute(environmentId, init.routeSource);
  const payload = init.body === undefined ? null : Buffer.from(JSON.stringify(init.body), 'utf8');
  const agent = init.agent ?? agentFor(environmentId, init.routeSource);
  const method = init.method ?? 'GET';

  const attempt = (): Promise<{ status: number; json: unknown }> => new Promise((resolve, reject) => {
    let responded = false;
    const req = httpRequest(
      {
        method,
        path,
        host: 'link.invalid',
        agent,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${info.token}`,
          ...linkActorHeaders(init.actor, init.ceiling),
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        responded = true;
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
        res.on('error', (error: Error) => reject(Object.assign(error, { [ATTEMPT]: { reusedSocket: req.reusedSocket === true, responded: true } satisfies AttemptFacts })));
      },
    );
    req.on('error', (error: Error) => reject(Object.assign(error, { [ATTEMPT]: { reusedSocket: req.reusedSocket === true, responded } satisfies AttemptFacts })));
    if (payload) req.write(payload);
    req.end();
  });

  try {
    return await attempt();
  } catch (error) {
    const facts = (error as { [ATTEMPT]?: AttemptFacts })[ATTEMPT];
    if (!facts || init.signal?.aborted || !isStaleChannelFailure(method, error, facts)) throw error;
    dropIdleChannels(agent);
    return attempt();
  }
}

/** Largest request or response body `linkForward` carries (D-4650-4). */
export const LINK_FORWARD_MAX_BYTES = 32 * 1024 * 1024;
export const LINK_FORWARD_TIMEOUT_MS = 120_000;

/** A request or response body above `LINK_FORWARD_MAX_BYTES`. */
export class LinkForwardTooLargeError extends Error {
  constructor(readonly side: 'request' | 'response') {
    super(`the ${side} body is larger than ${LINK_FORWARD_MAX_BYTES} bytes`);
    this.name = 'LinkForwardTooLargeError';
  }
}

export interface LinkForwardInit {
  method: string;
  /** Path and query on the linked machine. */
  path: string;
  /** Extra request headers (for example `content-type`); the token and actor stamp are added. */
  headers?: Record<string, string>;
  body?: Buffer;
  actor?: LinkActorInit;
  /** PAN-4651 D-4651-17: scopes the linked machine must not exceed (an MCP token's own scopes). */
  ceiling?: AccessTokenScope[];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seams, as on `linkFetch`. */
  agent?: Agent;
  routeSource?: LinkRouteSource;
}

export interface LinkForwardResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/**
 * Forward one request of any content type to a linked machine and buffer its
 * answer (PAN-4650 D-4650-4). Bodies over 32 MiB on either side reject with
 * `LinkForwardTooLargeError`; an unavailable link rejects with
 * `LinkUnavailableError` within 2.5 s.
 */
export async function linkForward(environmentId: string, init: LinkForwardInit): Promise<LinkForwardResponse> {
  if (init.body && init.body.length > LINK_FORWARD_MAX_BYTES) throw new LinkForwardTooLargeError('request');
  const info = await onlineRoute(environmentId, init.routeSource);
  const agent = init.agent ?? agentFor(environmentId, init.routeSource);

  const attempt = (): Promise<LinkForwardResponse> => new Promise((resolve, reject) => {
    let responded = false;
    const req = httpRequest(
      {
        method: init.method,
        path: init.path,
        host: 'link.invalid',
        agent,
        timeout: init.timeoutMs ?? LINK_FORWARD_TIMEOUT_MS,
        headers: {
          ...init.headers,
          authorization: `Bearer ${info.token}`,
          ...linkActorHeaders(init.actor, init.ceiling),
          ...(init.body ? { 'content-length': String(init.body.length) } : {}),
        },
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        responded = true;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > LINK_FORWARD_MAX_BYTES) {
            res.destroy();
            reject(new LinkForwardTooLargeError('response'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', (error: Error) => reject(Object.assign(error, { [ATTEMPT]: { reusedSocket: req.reusedSocket === true, responded: true } satisfies AttemptFacts })));
      },
    );
    req.on('timeout', () => req.destroy(new LinkUnavailableError('machine-unreachable', `${info.label} did not answer in time`)));
    req.on('error', (error: Error) => reject(Object.assign(error, { [ATTEMPT]: { reusedSocket: req.reusedSocket === true, responded } satisfies AttemptFacts })));
    if (init.body) req.write(init.body);
    req.end();
  });

  const method = init.method;
  try {
    return await attempt();
  } catch (error) {
    const facts = (error as { [ATTEMPT]?: AttemptFacts })[ATTEMPT];
    if (!facts || init.signal?.aborted || !isStaleChannelFailure(method, error, facts)) throw error;
    dropIdleChannels(agent);
    return attempt();
  }
}
