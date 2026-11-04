/**
 * Advertised endpoints (PAN-4645 WI-19, W-LINK2, FR-2; closes #4403).
 *
 * The addresses at which this dashboard accepts secure channels, published in
 * the environment descriptor so a linked machine learns better routes than the
 * one it paired through:
 *
 *  - `lan`: non-internal RFC 1918 IPv4 addresses on real interfaces (container
 *    bridges and the tailscale interface are skipped) ⇒ `tcp://<ip>:<port>`.
 *  - `tailnet`: addresses in `100.64.0.0/10` ⇒ `tcp://<ip>:<port>`, plus
 *    Tailscale Serve when `tailscale status --json` names this machine and
 *    `https://<name>/api/environment` answers with our environment id ⇒
 *    `wss://<name>/ws/link`.
 *  - A server in public-link-only mode (`OVERDECK_PUBLIC_LINK_ONLY=1`) advertises
 *    nothing (PAN-4741).
 *
 * Discovery is cached by `EndpointAdvertiser` (boot plus every 10 min) and the
 * `endpointsHash` (SHA-256 of the sorted URLs, first 16 hex) rides in every
 * heartbeat so peers refetch the descriptor only when something changed.
 * `tailscale` runs through async `execFile` with a 5 s timeout (NFR-5).
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { promisify } from 'node:util';

import type { AdvertisedEndpoint } from '@overdeck/contracts';

export const ENDPOINT_REFRESH_MS = 10 * 60_000;
export const ENDPOINT_PROBE_TIMEOUT_MS = 5_000;
/** Interface name prefixes that never reach another machine. */
export const IGNORED_INTERFACE_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'cni', 'flannel', 'tailscale'] as const;

export interface DiscoverEndpointsDeps {
  port: number;
  environmentId: string;
  networkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  /** Runs `tailscale status --json`; rejecting (binary absent, timeout) skips the Serve check. */
  execFile: (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

function ipv4Octets(address: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const octets = match.slice(1).map(Number) as [number, number, number, number];
  return octets.every((octet) => octet <= 255) ? octets : null;
}

export function isTailnetIPv4(address: string): boolean {
  const v4 = ipv4Octets(address);
  return v4 !== null && v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127;
}

export function isRfc1918IPv4(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (!v4) return false;
  const [a, b] = v4;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isIgnoredInterface(name: string): boolean {
  return IGNORED_INTERFACE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The LAN and tailnet IP endpoints: synchronous, from the interface table alone. */
export function interfaceEndpoints(port: number, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): AdvertisedEndpoint[] {
  const endpoints: AdvertisedEndpoint[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue;
      if (info.internal) continue;
      if (isTailnetIPv4(info.address)) {
        endpoints.push({ kind: 'tailnet', url: `tcp://${info.address}:${port}` });
      } else if (!isIgnoredInterface(name) && isRfc1918IPv4(info.address)) {
        endpoints.push({ kind: 'lan', url: `tcp://${info.address}:${port}` });
      }
    }
  }
  return endpoints;
}

/** Tailscale Serve: the HTTPS name that reaches this dashboard, verified by our own environment id. */
export async function tailscaleServeEndpoint(deps: Pick<DiscoverEndpointsDeps, 'environmentId' | 'execFile' | 'fetch'>): Promise<AdvertisedEndpoint | null> {
  let dnsName: string | null = null;
  try {
    const { stdout } = await deps.execFile('tailscale', ['status', '--json'], { timeout: ENDPOINT_PROBE_TIMEOUT_MS });
    const parsed = JSON.parse(stdout) as { Self?: { DNSName?: unknown } };
    const raw = parsed.Self?.DNSName;
    dnsName = typeof raw === 'string' && raw !== '' ? raw.replace(/\.$/, '') : null;
  } catch {
    return null; // no tailscale binary, timeout, or unparseable output
  }
  if (!dnsName) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENDPOINT_PROBE_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`https://${dnsName}/api/environment`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { environmentId?: unknown } | null;
    if (body?.environmentId !== deps.environmentId) return null;
    return { kind: 'tailnet', url: `wss://${dnsName}/ws/link` };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everything this machine advertises, deduplicated and sorted by URL. `OVERDECK_ANYWHERE_NO_ADVERTISE=1`
 * advertises nothing (PAN-2356): the directory smoke uses it so two dashboards on one host can only
 * reach each other over the `direct` route. `OVERDECK_PUBLIC_LINK_ONLY=1` (a linked Fly machine) also
 * advertises nothing (PAN-4741): only its public pairing route reaches it, and its private Fly
 * addresses would otherwise rank before that route as unreachable `lan` routes.
 */
export async function discoverEndpoints(deps: DiscoverEndpointsDeps): Promise<AdvertisedEndpoint[]> {
  if (process.env['OVERDECK_ANYWHERE_NO_ADVERTISE'] === '1' || process.env['OVERDECK_PUBLIC_LINK_ONLY'] === '1') return [];
  const found = interfaceEndpoints(deps.port, deps.networkInterfaces());
  const serve = await tailscaleServeEndpoint(deps);
  if (serve) found.push(serve);
  const byUrl = new Map<string, AdvertisedEndpoint>();
  for (const endpoint of found) byUrl.set(endpoint.url, endpoint);
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** SHA-256 of the sorted URLs, first 16 hex characters; '' for no endpoints. */
export function endpointsHash(endpoints: readonly AdvertisedEndpoint[]): string {
  if (endpoints.length === 0) return '';
  const urls = endpoints.map((endpoint) => endpoint.url).sort();
  return createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 16);
}

const execFileAsync = promisify(execFileCallback);

export function defaultDiscoverDeps(port: number, environmentId: string): DiscoverEndpointsDeps {
  return {
    port,
    environmentId,
    networkInterfaces: osNetworkInterfaces,
    execFile: async (file, args, options) => {
      const { stdout } = await execFileAsync(file, args, { timeout: options.timeout, encoding: 'utf8' });
      return { stdout: String(stdout) };
    },
    fetch: (url, init) => globalThis.fetch(url, init),
  };
}

/** Cached discovery: refreshed at start and every `refreshMs`. */
export class EndpointAdvertiser {
  private endpoints: AdvertisedEndpoint[] = [];
  private hashValue = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: DiscoverEndpointsDeps,
    private readonly refreshMs: number = ENDPOINT_REFRESH_MS,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refresh(); }, this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<AdvertisedEndpoint[]> {
    try {
      this.endpoints = await discoverEndpoints(this.deps);
      this.hashValue = endpointsHash(this.endpoints);
    } catch {
      // Keep the previous answer; the next refresh tries again.
    }
    return this.endpoints;
  }

  current(): AdvertisedEndpoint[] {
    return this.endpoints.map((endpoint) => ({ ...endpoint }));
  }

  hash(): string {
    return this.hashValue;
  }
}

let advertisedSource: () => AdvertisedEndpoint[] = () => [];

/** The descriptor and the exchange read the advertised endpoints through this seam. */
export function setAdvertisedEndpointsSource(source: (() => AdvertisedEndpoint[]) | null): void {
  advertisedSource = source ?? (() => []);
}

export function currentAdvertisedEndpoints(): AdvertisedEndpoint[] {
  return advertisedSource();
}
