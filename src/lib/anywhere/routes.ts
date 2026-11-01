/**
 * Route model for machine links (PAN-4645 WI-11, FR-2, D-10).
 *
 * A route is one way to reach a linked machine: a transport URL (`tcp://host:port`
 * raw TCP to the dashboard port, or `wss://host[:port]/ws/link` inside HTTPS),
 * its kind (`lan < tailnet < ssh < public < direct < relay`, best first) and where
 * it came from (`pairing` URL, `manual` Add route, `advertised` by the peer's
 * descriptor). This issue creates `lan`, `tailnet` and `public` routes; `ssh`,
 * `direct` and `relay` arrive in #4404 and #2356.
 */
import { ROUTE_KINDS, type RouteKind, type RouteSource } from '@overdeck/contracts';

export type TransportKind = 'tcp' | 'wss';

export interface LinkRoute {
  url: string;
  kind: RouteKind;
  source: RouteSource;
  /** ISO-8601 UTC time the route was added to the link. */
  addedAt: string;
}

export interface ParsedRouteUrl {
  transport: TransportKind;
  host: string;
  port: number;
  /** The URL in its canonical form (`tcp://host:port` or `wss://host[:port]/ws/link`). */
  url: string;
}

const SOURCE_RANK: Record<RouteSource, number> = { manual: 0, pairing: 1, advertised: 2 };
const TRANSPORT_RANK: Record<TransportKind, number> = { tcp: 0, wss: 1 };

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/** Parse and canonicalise a transport URL. Throws on anything else. */
export function parseRouteUrl(url: string): ParsedRouteUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a route URL: ${url}`);
  }
  const host = stripBrackets(parsed.hostname);
  if (!host) throw new Error(`Route URL has no host: ${url}`);
  if (parsed.protocol === 'tcp:') {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`tcp:// route needs a port: ${url}`);
    return { transport: 'tcp', host, port, url: `tcp://${parsed.hostname}:${port}` };
  }
  if (parsed.protocol === 'wss:') {
    const port = parsed.port ? Number(parsed.port) : 443;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`wss:// route has a bad port: ${url}`);
    return { transport: 'wss', host, port, url: `wss://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/ws/link` };
  }
  throw new Error(`Unsupported route scheme in ${url} (expected tcp:// or wss://)`);
}

function ipv4Octets(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number) as [number, number, number, number];
  return octets.every((octet) => octet <= 255) ? octets : null;
}

export function isLoopbackHost(host: string): boolean {
  const lower = stripBrackets(host).toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower.endsWith('.localhost')) return true;
  const v4 = ipv4Octets(lower.replace(/^::ffff:/, ''));
  return v4 !== null && v4[0] === 127;
}

/**
 * Classify a host: Tailscale addresses (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`,
 * `*.ts.net`) are `tailnet`; RFC 1918, loopback, link-local and `*.local` are
 * `lan`; everything else is `public`.
 */
export function classifyHost(host: string): RouteKind {
  const lower = stripBrackets(host).toLowerCase();
  if (lower.endsWith('.ts.net') || lower.startsWith('fd7a:115c:a1e0:')) return 'tailnet';
  if (lower.endsWith('.local') || isLoopbackHost(lower) || lower.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(lower)) return 'lan';
  const v4 = ipv4Octets(lower.replace(/^::ffff:/, ''));
  if (v4) {
    const [a, b] = v4;
    if (a === 100 && b >= 64 && b <= 127) return 'tailnet';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'lan';
  }
  return 'public';
}

export interface PairingRoute {
  url: string;
  kind: RouteKind;
  source: 'pairing';
  /** The `odp_` pairing code carried in the link's fragment. */
  pairingCode: string;
}

/**
 * Turn a `pan pair` link into the route that reaches its machine:
 * `http://h:p/…#pair=<code>` ⇒ `tcp://h:p`, `https://h[:p]/…#pair=<code>` ⇒
 * `wss://h[:p]/ws/link`. A loopback base only works on that machine, so it is
 * refused unless `allowLoopback` (two servers on one host), which makes it a
 * `lan` route.
 */
export function routeFromPairingUrl(pairingUrl: string, options: { allowLoopback?: boolean } = {}): PairingRoute {
  let parsed: URL;
  try {
    parsed = new URL(pairingUrl);
  } catch {
    throw new Error(`Not a pairing link: ${pairingUrl}`);
  }
  const code = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('pair');
  if (!code || !code.startsWith('odp_')) throw new Error('The pairing link carries no #pair=odp_… code');
  const host = stripBrackets(parsed.hostname);
  if (!host) throw new Error(`Pairing link has no host: ${pairingUrl}`);
  if (isLoopbackHost(host) && !options.allowLoopback) {
    throw new Error('This link points at localhost, so it only works on that machine; pass --allow-loopback only when both servers run on this host');
  }
  let url: string;
  if (parsed.protocol === 'http:') {
    const port = parsed.port ? Number(parsed.port) : 80;
    url = `tcp://${parsed.hostname}:${port}`;
  } else if (parsed.protocol === 'https:') {
    url = `wss://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/ws/link`;
  } else {
    throw new Error(`Pairing link must be http:// or https://: ${pairingUrl}`);
  }
  const kind: RouteKind = isLoopbackHost(host) ? 'lan' : classifyHost(host);
  return { url, kind, source: 'pairing', pairingCode: code };
}

/** Best route first: kind rank, then `tcp` before `wss`, then `manual < pairing < advertised`, then URL. */
export function rankRoutes<R extends Pick<LinkRoute, 'url' | 'kind' | 'source'>>(routes: readonly R[]): R[] {
  const kindRank = (kind: RouteKind): number => ROUTE_KINDS.indexOf(kind);
  const transportRank = (url: string): number => (url.startsWith('wss://') ? TRANSPORT_RANK.wss : TRANSPORT_RANK.tcp);
  return [...routes].sort((a, b) =>
    kindRank(a.kind) - kindRank(b.kind)
    || transportRank(a.url) - transportRank(b.url)
    || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    || a.url.localeCompare(b.url));
}

/**
 * Reconcile the routes a peer advertises: add advertised endpoints the link
 * lacks, drop advertised routes no longer advertised, and never touch
 * `pairing` or `manual` routes (a URL that also exists as one of those is not
 * added again).
 */
export function mergeAdvertised(
  routes: readonly LinkRoute[],
  endpoints: ReadonlyArray<{ kind: RouteKind; url: string }>,
  now: () => string = () => new Date().toISOString(),
): LinkRoute[] {
  const advertisedUrls = new Set(endpoints.map((endpoint) => parseRouteUrl(endpoint.url).url));
  const kept = routes.filter((route) => route.source !== 'advertised' || advertisedUrls.has(route.url));
  const known = new Set(kept.map((route) => route.url));
  const added: LinkRoute[] = [];
  for (const endpoint of endpoints) {
    const { url } = parseRouteUrl(endpoint.url);
    if (known.has(url)) continue;
    known.add(url);
    added.push({ url, kind: endpoint.kind, source: 'advertised', addedAt: now() });
  }
  return [...kept, ...added];
}
