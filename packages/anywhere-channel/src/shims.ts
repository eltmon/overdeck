/**
 * Page shims that send the existing frontend's machine traffic through the
 * secure channel (PAN-4834 WI-5).
 *
 * `installChannelShims` replaces `fetch` and `WebSocket`. A URL that is
 * relative, or has the page's protocol and host, and whose path starts with
 * `/api/` or `/ws/`, goes to the current machine with the machine's phone token
 * as `Authorization: Bearer <token>`. Every other URL, such as the directory at
 * `wss://connect.overdeck.ai`, reaches the original implementation untouched,
 * so the token never leaves the channel (NFR-5).
 *
 * Routing compares `protocol` and `host`, never `origin`: a `capacitor:` URL has
 * the origin `"null"` (PAN-4834 Fact 8). The current machine is read on every
 * request (FR-7), and each machine keeps its own keep-alive pool (D-3).
 */
import { type ChannelDial, type ChannelPool, createChannelPool } from './http-client.js';
import { CHANNEL_HOST, type HeaderPairs } from './http1.js';
import { ChannelWebSocket } from './ws-client.js';

export interface ShimMachine {
  environmentId: string;
  /** The `phone` access token this machine issued. */
  bearerToken: string;
  dial: ChannelDial;
}

export interface ShimLocation {
  protocol: string;
  host: string;
  href: string;
}

export interface ShimTarget {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
}

export interface ChannelShimOptions {
  /** Read on every request; null means no machine is selected (D-11). */
  currentMachine: () => ShimMachine | null;
  /** Test seams; default globalThis and globalThis.location. */
  target?: ShimTarget;
  location?: ShimLocation;
}

/** Statuses whose `Response` must have a null body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
/** Framing headers that described the wire, not the de-chunked body the page receives. */
const DROPPED_RESPONSE_HEADERS = new Set(['transfer-encoding', 'connection', 'keep-alive']);
const ROUTED_PREFIXES = ['/api/', '/ws/'];

const installed = new WeakSet<object>();

/** Path and query to send through the channel, or null to use the original implementation. */
export function channelPathFor(input: string, location: ShimLocation, kind: 'fetch' | 'websocket'): string | null {
  let url: URL;
  try {
    url = new URL(input, location.href);
  } catch {
    return null;
  }
  if (!ROUTED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (url.host !== location.host) return null;
  const sameProtocol = url.protocol === location.protocol;
  const socketProtocol = kind === 'websocket' && (url.protocol === 'ws:' || url.protocol === 'wss:');
  if (!sameProtocol && !socketProtocol) return null;
  return url.pathname + url.search;
}

function noMachine(): Error {
  return new Error('No machine is selected');
}

/** Replaces `fetch` and `WebSocket` on the target; returns the uninstall function. */
export function installChannelShims(options: ChannelShimOptions): () => void {
  const { currentMachine } = options;
  const target = options.target ?? (globalThis as unknown as ShimTarget);
  const location = options.location ?? (globalThis as { location?: ShimLocation }).location;
  if (!location) throw new Error('Channel shims need a page location');
  if (installed.has(target)) throw new Error('Channel shims are already installed');

  const originalFetch = target.fetch;
  const OriginalWebSocket = target.WebSocket;
  const pools = new Map<string, ChannelPool>();

  function poolFor(environmentId: string): ChannelPool {
    const existing = pools.get(environmentId);
    if (existing) return existing;
    const pool = createChannelPool({
      // Read at dial time so a pool never dials another machine after a switch.
      dial: () => {
        const machine = currentMachine();
        if (!machine || machine.environmentId !== environmentId) {
          return Promise.reject(new Error(`Machine ${environmentId} is no longer selected`));
        }
        return machine.dial();
      },
    });
    pools.set(environmentId, pool);
    return pool;
  }

  async function channelFetch(...args: Parameters<typeof fetch>): Promise<Response> {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = channelPathFor(url, location!, 'fetch');
    if (path === null) return originalFetch.apply(target, args);
    const machine = currentMachine();
    if (!machine) throw new TypeError('Failed to fetch', { cause: noMachine() });
    // D-5: the platform normalises every body and header form; its URL is never used.
    const request =
      typeof input === 'string' || input instanceof URL
        ? new Request(`http://${CHANNEL_HOST}${path}`, init)
        : init
          ? new Request(input, init)
          : input;
    const headers: HeaderPairs = [];
    request.headers.forEach((value, name) => {
      if (name !== 'authorization') headers.push([name, value]);
    });
    headers.push(['authorization', `Bearer ${machine.bearerToken}`]);
    try {
      const buffer = await request.arrayBuffer();
      const response = await poolFor(machine.environmentId).request(
        {
          method: request.method,
          path,
          headers,
          body: buffer.byteLength > 0 ? new Uint8Array(buffer) : undefined,
        },
        { signal: request.signal },
      );
      if (response.status < 200 || response.status > 599) {
        throw new Error(`A Response cannot carry status ${response.status}`);
      }
      const responseHeaders = new Headers();
      for (const [name, value] of response.headers) {
        if (!DROPPED_RESPONSE_HEADERS.has(name)) responseHeaders.append(name, value);
      }
      return new Response(NULL_BODY_STATUSES.has(response.status) ? null : (response.body as Uint8Array<ArrayBuffer>), {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      throw new TypeError('Failed to fetch', { cause: error });
    }
  }

  class ChannelWebSocketShim {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    constructor(url: string | URL, protocols?: string | string[]) {
      const href = String(url);
      if (channelPathFor(href, location!, 'websocket') === null) {
        return new OriginalWebSocket(url, protocols) as unknown as ChannelWebSocketShim;
      }
      const machine = currentMachine();
      // The channel client needs an absolute URL; with no machine its dial fails, firing error then close 1006.
      return new ChannelWebSocket(new URL(href, location!.href).href, protocols, {
        dial: machine ? machine.dial : () => Promise.reject(noMachine()),
        bearerToken: machine?.bearerToken ?? '',
      }) as unknown as ChannelWebSocketShim;
    }
  }

  target.fetch = channelFetch as typeof fetch;
  target.WebSocket = ChannelWebSocketShim as unknown as typeof WebSocket;
  installed.add(target);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    target.fetch = originalFetch;
    target.WebSocket = OriginalWebSocket;
    installed.delete(target);
    for (const pool of pools.values()) pool.close();
    pools.clear();
  };
}
