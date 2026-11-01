/**
 * Tailnet peer discovery (PAN-1254 W-6, FR-7, D-13).
 *
 * For every online peer, probe its unauthenticated environment descriptor at
 * `https://<peer MagicDNS name>/api/environment` (Tailscale Serve) and at
 * `http://<peer tailnet IPv4>:<this api_port>/api/environment`, in parallel,
 * 2.5 s each. The first valid descriptor wins. A peer whose descriptor is this
 * machine's is dropped.
 *
 * Userspace mode has no TUN device, so only the plain-HTTP candidate is
 * probed, sent through tailscaled's outbound HTTP proxy as an absolute-form
 * request. At most 16 probes run at once.
 */
import { request as httpRequest } from 'node:http';
import { EnvironmentDescriptor } from '@overdeck/contracts';
import { Schema } from 'effect';
import { USERSPACE_HTTP_PROXY } from './userspace.js';
import type { TailscalePeer, TailscaleState } from './state.js';

export const PEER_PROBE_TIMEOUT_MS = 2500;
export const MAX_CONCURRENT_PROBES = 16;
/** A descriptor is small; anything larger is not one. */
const MAX_DESCRIPTOR_BYTES = 64 * 1024;

export interface TailnetPeerOverdeck {
  environmentId: string;
  label: string;
  serverVersion: string;
  /** Base URL that answered, e.g. `https://laptop.tailnet.ts.net`. */
  url: string;
}

export interface TailnetPeer {
  hostName: string;
  dnsName: string | null;
  os: string | null;
  online: boolean;
  overdeck: TailnetPeerOverdeck | null;
}

/** Fetch `url` and return its parsed JSON body; reject on any failure. */
export type JsonGetter = (url: string, signal: AbortSignal) => Promise<unknown>;

export interface PeerDiscoveryDeps {
  fetchJson?: JsonGetter;
  /** Userspace mode: GET through tailscaled's outbound HTTP proxy. */
  proxyJson?: JsonGetter;
}

async function defaultFetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

function defaultProxyJson(url: string, signal: AbortSignal): Promise<unknown> {
  const [proxyHost, proxyPort] = USERSPACE_HTTP_PROXY.split(':');
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: proxyHost,
      port: Number(proxyPort),
      method: 'GET',
      path: url,
      headers: { host: new URL(url).host, accept: 'application/json' },
      signal,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${url} answered ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_DESCRIPTOR_BYTES) req.destroy(new Error('descriptor too large'));
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** A tiny semaphore so a large tailnet never opens more than MAX_CONCURRENT_PROBES sockets. */
function limiter(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

const decodeDescriptor = Schema.decodeUnknownSync(EnvironmentDescriptor);

async function probe(base: string, get: JsonGetter, limit: ReturnType<typeof limiter>, cancel: AbortSignal): Promise<TailnetPeerOverdeck | null> {
  return limit(async () => {
    if (cancel.aborted) return null;
    const controller = new AbortController();
    const onCancel = () => controller.abort();
    cancel.addEventListener('abort', onCancel);
    const timer = setTimeout(() => controller.abort(), PEER_PROBE_TIMEOUT_MS);
    try {
      const descriptor = decodeDescriptor(await get(`${base}/api/environment`, controller.signal));
      return { environmentId: descriptor.environmentId, label: descriptor.label, serverVersion: descriptor.serverVersion, url: base };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      cancel.removeEventListener('abort', onCancel);
    }
  });
}

/** Resolve with the first non-null probe, or null when every probe fails. */
function firstFound(probes: Array<(cancel: AbortSignal) => Promise<TailnetPeerOverdeck | null>>): Promise<TailnetPeerOverdeck | null> {
  if (probes.length === 0) return Promise.resolve(null);
  const cancel = new AbortController();
  return new Promise((resolve) => {
    let remaining = probes.length;
    for (const run of probes) {
      void run(cancel.signal).then((found) => {
        remaining -= 1;
        if (found) {
          cancel.abort();
          resolve(found);
        } else if (remaining === 0) {
          resolve(null);
        }
      });
    }
  });
}

/** Probe every online peer for an Overdeck descriptor. Never rejects. */
export async function discoverTailnetPeers(
  state: Pick<TailscaleState, 'mode' | 'peers'>,
  opts: { port: number; selfEnvironmentId: string },
  deps: PeerDiscoveryDeps = {},
): Promise<TailnetPeer[]> {
  const userspace = state.mode === 'userspace';
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const proxyJson = deps.proxyJson ?? defaultProxyJson;
  const limit = limiter(MAX_CONCURRENT_PROBES);

  const results = await Promise.all(state.peers.map(async (peer: TailscalePeer) => {
    const base = { hostName: peer.hostName, dnsName: peer.dnsName, os: peer.os, online: peer.online };
    if (!peer.online) return { ...base, overdeck: null };
    const probes: Array<(cancel: AbortSignal) => Promise<TailnetPeerOverdeck | null>> = [];
    if (peer.dnsName && !userspace) {
      probes.push((cancel) => probe(`https://${peer.dnsName}`, fetchJson, limit, cancel));
    }
    const ip = peer.ipv4[0];
    if (ip) {
      probes.push((cancel) => probe(`http://${ip}:${opts.port}`, userspace ? proxyJson : fetchJson, limit, cancel));
    }
    return { ...base, overdeck: await firstFound(probes) };
  }));
  return results.filter((peer) => peer.overdeck?.environmentId !== opts.selfEnvironmentId);
}
