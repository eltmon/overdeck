import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

import { Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { CONNECTOR_SCOPE_CHOICES, scopeSatisfies, verifyAccessToken, type AccessTokenScope, type MachineAccess } from '../../../lib/access-tokens.js';
import { effectiveScopes, LINK_ACTOR_HEADER, LINK_CEILING_HEADER, type LinkActor, parseLinkActor } from '../../../lib/anywhere/link-actor.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { readRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { type ChannelMarker, channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { gatePathname, requiredScopeFor } from '../route-scopes.js';
import { getHeaderFromMap, getTrustedOrigins, normalizeOrigin, type HeaderMap } from './origin-validation.js';

export const DASHBOARD_SESSION_COOKIE = 'overdeck_session';
/** A paired device's own revocable `odk_` session (PAN-3762). */
export const DASHBOARD_DEVICE_COOKIE = 'overdeck_device';
export const DASHBOARD_CSRF_HEADER = 'x-overdeck-csrf-token';
// Session cookie lifetime. Without Max-Age the cookie was a *session* cookie that
// died when the browser fully closed — so a reopened tab on a trusted origin had
// no cookie, its mint 401'd, and every mutation failed with "CSRF token
// unavailable" until the operator re-bootstrapped via the one-time URL token.
// A 30-day rolling expiry means the operator bootstraps once per browser.
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

let browserSessionToken: string | undefined;
let browserCsrfToken: string | undefined;

export function _resetDashboardSessionTokenForTests(): void {
  browserSessionToken = undefined;
  browserCsrfToken = undefined;
}

function getDashboardSessionToken(): string {
  if (browserSessionToken) return browserSessionToken;
  const override = process.env['OVERDECK_DASHBOARD_SESSION_TOKEN'];
  if (override) {
    browserSessionToken = override;
    return browserSessionToken;
  }
  // Derive a stable session token from the persisted internal token so the
  // browser's session cookie survives dashboard restarts. Without this the
  // token was random per-process, so every restart invalidated open tabs'
  // cookies — and a plain refresh could no longer re-mint, since the one-time
  // bootstrap hash token is already consumed on first load. Falls back to a
  // random token only when no internal token is configured, in which case the
  // auth gate already 503s before the session token is ever consulted.
  const internal = getInternalToken();
  browserSessionToken = internal
    ? createHmac('sha256', internal).update('overdeck-dashboard-session-v1').digest('base64url')
    : randomBytes(32).toString('base64url');
  return browserSessionToken;
}

export function dashboardCsrfToken(): string {
  if (browserCsrfToken) return browserCsrfToken;
  const override = process.env['OVERDECK_DASHBOARD_CSRF_TOKEN'];
  if (override) {
    browserCsrfToken = override;
    return browserCsrfToken;
  }
  // Same restart-survival derivation as the session token above: the frontend
  // caches this token once per page load (wsTransport session mint), so a
  // random-per-process value 403'd every mutation from open tabs after each
  // dashboard restart — and the flywheel restarts the dashboard on every
  // post-merge deploy. Distinct context string keeps it independent of the
  // session token.
  const internal = getInternalToken();
  browserCsrfToken = internal
    ? createHmac('sha256', internal).update('overdeck-dashboard-csrf-v1').digest('base64url')
    : randomBytes(32).toString('base64url');
  return browserCsrfToken;
}

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  return getHeaderFromMap(request.headers as HeaderMap, name);
}

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function dashboardSessionCookieHeader(options: { secure?: boolean } = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(getDashboardSessionToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DASHBOARD_SESSION_MAX_AGE_SECONDS}${secure}`;
}

/** Same attributes as the root session cookie; the value is the device's `odk_` token. */
export function dashboardDeviceCookieHeader(token: string, options: { secure?: boolean } = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${DASHBOARD_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DASHBOARD_SESSION_MAX_AGE_SECONDS}${secure}`;
}

function bearerToken(headers: HeaderMap): string | undefined {
  const authorization = getHeaderFromMap(headers, 'authorization');
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export function hasDashboardInternalTokenHeaders(headers: HeaderMap): boolean {
  const expected = getInternalToken();
  if (!expected) return false;

  const internalHeader = getHeaderFromMap(headers, INTERNAL_TOKEN_HEADER);
  if (constantTimeTokenEqual(internalHeader, expected)) return true;

  const authorization = getHeaderFromMap(headers, 'authorization');
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && constantTimeTokenEqual(token, expected)) return true;
  }

  return false;
}

export function hasDashboardInternalToken(request: HttpServerRequest.HttpServerRequest): boolean {
  return hasDashboardInternalTokenHeaders(request.headers as HeaderMap);
}

/**
 * Who a request authenticates as. `internal-token` and `root-session` are root
 * credentials and imply `admin`. `device`, `token`, `machine` and `phone` are
 * registry credentials: they carry their record's scopes and are revocable. A
 * `machine` credential (PAN-4645) exists only inside a link-mode secure
 * channel bound to its key; `scopes` are already narrowed by the actor
 * stamp's ceiling. A `phone` credential (PAN-4835) likewise exists only
 * inside a link-mode channel bound to its `phoneKey`, carries its record's
 * scopes unnarrowed (a phone sends no actor stamp or ceiling header), and
 * never carries `admin` or `forward`. A `connector` credential (PAN-4927 D-17)
 * exists only inside a link-mode channel bound to its `connectorKey` and carries
 * only the record's scopes that are in `CONNECTOR_SCOPE_CHOICES`.
 */
export type DashboardCredential =
  | { kind: 'internal-token' }
  | { kind: 'root-session' }
  | { kind: 'device'; deviceId: string; scopes: AccessTokenScope[] }
  | { kind: 'token'; tokenId: string; scopes: AccessTokenScope[]; agentId?: string; agentKind?: 'agent' | 'conversation'; role?: string }
  | { kind: 'machine'; tokenId: string; environmentId: string; scopes: AccessTokenScope[]; actor: LinkActor; access: MachineAccess }
  | { kind: 'phone'; tokenId: string; clientId: string; phoneKey: string; scopes: AccessTokenScope[] }
  | { kind: 'connector'; tokenId: string; clientId: string; connectorKey: string; scopes: AccessTokenScope[] };

/** The scopes a credential grants: `['admin']` for root credentials, else the record's scopes. */
export function credentialScopes(credential: DashboardCredential): readonly string[] {
  return credential.kind === 'internal-token' || credential.kind === 'root-session' ? ['admin'] : credential.scopes;
}

/** The `odk_` token a request presents: the device cookie, else an `Authorization: Bearer` header. */
export function dashboardDeviceTokenFromHeaders(headers: HeaderMap): string | undefined {
  return cookieValue(getHeaderFromMap(headers, 'cookie'), DASHBOARD_DEVICE_COOKIE) ?? bearerToken(headers);
}

/**
 * Resolve the credential a request presents. `channel` is the secure-channel
 * marker of the request's socket (D-4645-9): inside a channel only a `machine`
 * record bound to the channel's remote key, or a `phone` record bound to its
 * `phoneKey` (PAN-4835 FR-3), resolves, from the Bearer header; the internal
 * token, the root session, device cookies and `token` bearers all resolve to
 * `null` there (NFR-2). On a plain socket a `machine` or `phone` record never
 * resolves. (`verifyAccessToken` stamps `lastUsedAt` before this check, so a
 * refused machine or phone presentation still updates the timestamp; harmless.)
 * A `connector` record resolves the same way as a phone, bound to its
 * `connectorKey`, and never on a plain socket (PAN-4927 D-17).
 */
export function resolveDashboardCredential(headers: HeaderMap, channel: ChannelMarker | null = null): DashboardCredential | null {
  if (channel !== null) {
    if (channel.mode !== 'link') return null;
    const verified = verifyAccessToken(bearerToken(headers));
    if (!verified.ok) return null;
    const { record } = verified;
    if (record.kind === 'phone') {
      if (record.phoneKey !== channel.remoteKeyHex || !record.clientId) return null;
      return { kind: 'phone', tokenId: record.id, clientId: record.clientId, phoneKey: record.phoneKey, scopes: record.scopes };
    }
    if (record.kind === 'connector') {
      if (record.connectorKey !== channel.remoteKeyHex || !record.clientId) return null;
      // PAN-4927 D-5: only the connector choices count, even on a hand-edited record.
      const scopes = record.scopes.filter((scope) => CONNECTOR_SCOPE_CHOICES.includes(scope));
      return { kind: 'connector', tokenId: record.id, clientId: record.clientId, connectorKey: record.connectorKey, scopes };
    }
    if (record.kind !== 'machine' || record.machineKey !== channel.remoteKeyHex || !record.environmentId || !record.access) return null;
    const { actor, ceiling } = parseLinkActor(
      getHeaderFromMap(headers, LINK_ACTOR_HEADER),
      getHeaderFromMap(headers, LINK_CEILING_HEADER),
      record.access,
    );
    return {
      kind: 'machine',
      tokenId: record.id,
      environmentId: record.environmentId,
      scopes: effectiveScopes(record.scopes, ceiling),
      actor,
      access: record.access,
    };
  }
  if (hasDashboardInternalTokenHeaders(headers)) return { kind: 'internal-token' };
  const cookie = getHeaderFromMap(headers, 'cookie');
  if (constantTimeTokenEqual(cookieValue(cookie, DASHBOARD_SESSION_COOKIE), getDashboardSessionToken())) {
    return { kind: 'root-session' };
  }
  const cookieToken = cookieValue(cookie, DASHBOARD_DEVICE_COOKIE);
  const verified = verifyAccessToken(cookieToken ?? bearerToken(headers));
  if (!verified.ok) return null;
  const { record } = verified;
  // PAN-4645 D-4645-9: a machine token authenticates only inside its channel.
  if (record.kind === 'machine') return null;
  // PAN-4835 FR-3: a phone token authenticates only inside its link channel.
  if (record.kind === 'phone') return null;
  // PAN-4927 D-17: a connector token authenticates only inside its link channel.
  if (record.kind === 'connector') return null;
  if (record.kind === 'token') {
    // PAN-2351 D-9: a token authenticates only from the Bearer header.
    // PAN-4927 D-6: an agent token also names its agent; a plain token keeps the three keys.
    return cookieToken === undefined
      ? { kind: 'token', tokenId: record.id, scopes: record.scopes, ...(record.agentId ? { agentId: record.agentId, agentKind: record.agentKind, role: record.role } : {}) }
      : null;
  }
  // A record with no kind is a device (PAN-2351 FR-10).
  return { kind: 'device', deviceId: record.id, scopes: record.scopes };
}

/** `resolveDashboardCredential` for a request, reading the channel marker from its socket. */
export function resolveRequestCredential(request: HttpServerRequest.HttpServerRequest): DashboardCredential | null {
  return resolveDashboardCredential(request.headers as HeaderMap, channelOfRequest(request));
}

export function hasDashboardAuthHeaders(headers: HeaderMap): boolean {
  return resolveDashboardCredential(headers) !== null;
}

export function hasDashboardAuth(request: HttpServerRequest.HttpServerRequest): boolean {
  return resolveRequestCredential(request) !== null;
}

function isJsonContentType(headers: HeaderMap): boolean {
  const contentType = getHeaderFromMap(headers, 'content-type');
  if (!contentType) return false;
  const [mime] = contentType.toLowerCase().split(';');
  return mime.trim() === 'application/json';
}

function hasTrustedExactOrigin(headers: HeaderMap): boolean {
  const origin = getHeaderFromMap(headers, 'origin');
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return !!normalized && getTrustedOrigins().includes(normalized);
}

function hasValidCsrfToken(headers: HeaderMap): boolean {
  return constantTimeTokenEqual(getHeaderFromMap(headers, DASHBOARD_CSRF_HEADER), dashboardCsrfToken());
}

export function rejectUnsafeDashboardMutationRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const authError = rejectUnauthorizedDashboardRequest(request);
  if (authError) return authError;

  const headers = request.headers as HeaderMap;
  if (!isJsonContentType(headers)) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, { status: 400 });
  }

  // Header-borne credentials cannot be sent by a cross-site form, so they skip
  // the Origin and CSRF checks (PAN-2351 FR-9). A token never arrives by cookie.
  // A phone's bearer rides a Noise-authenticated channel (PAN-4823 D-4), so it skips them too.
  // A connector's bearer rides a Noise-authenticated channel too (PAN-4927 D-17).
  const credentialKind = resolveRequestCredential(request)?.kind;
  if (credentialKind === 'internal-token' || credentialKind === 'token' || credentialKind === 'phone' || credentialKind === 'connector') return null;

  const origin = getHeaderFromMap(headers, 'origin');
  if (origin && !hasTrustedExactOrigin(headers)) {
    return jsonResponse({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!hasValidCsrfToken(headers)) {
    return jsonResponse({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  return null;
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

/** RFC1918 private ranges — Docker bridges always fall inside one of these. */
function isRfc1918(ip: number): boolean {
  return (
    (ip & 0xff000000) >>> 0 === 0x0a000000 || // 10.0.0.0/8
    (ip & 0xfff00000) >>> 0 === 0xac100000 || // 172.16.0.0/12
    (ip & 0xffff0000) >>> 0 === 0xc0a80000    // 192.168.0.0/16
  );
}

/**
 * True when `addr` is the IP of a container on one of THIS host's Docker bridge
 * interfaces (docker0 / br-*). Such a peer can only be a process running on this
 * machine — our own host-local Traefik fronting overdeck.localhost, or another
 * Overdeck container — never a LAN client (a direct LAN hit to the 0.0.0.0
 * API port arrives with a LAN peer that is not inside any Docker bridge subnet).
 *
 * Pure for testability: the interface map is injected. We only ever trust
 * RFC1918 bridge subnets, so a misconfigured public-range br-* cannot widen
 * trust beyond the local Docker fabric.
 */
export function peerIsHostLocalDockerBridge(
  addr: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): boolean {
  const peer = ipv4ToInt(addr);
  if (peer === null) return false;
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name !== 'docker0' && !name.startsWith('br-')) continue;
    for (const info of addrs ?? []) {
      if (info.family !== 'IPv4') continue;
      const ifaceIp = ipv4ToInt(info.address);
      const mask = ipv4ToInt(info.netmask);
      if (ifaceIp === null || mask === null) continue;
      const network = (ifaceIp & mask) >>> 0;
      if (!isRfc1918(network)) continue;
      if (((peer & mask) >>> 0) === network) return true;
    }
  }
  return false;
}

/**
 * True when `addr` shares an RFC1918 subnet with one of THIS process's own
 * network interfaces. This is the in-container counterpart of
 * peerIsHostLocalDockerBridge: inside a container the Docker bridge is
 * invisible — the container sees only its veth endpoints (eth0/eth1), so the
 * docker0/br-* name filter never matches and the host-local Traefik fronting
 * the stack 401'd every session mint (first hit live on the PAN-1737 UAT
 * stack). A peer inside one of the container's attached Docker-network
 * subnets can only be another container on those networks — the server
 * publishes no host port (Traefik labels only), so no LAN client can ever
 * present such an address. Only consulted when running inside a container.
 */
export function peerIsLocalContainerNetwork(
  addr: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): boolean {
  const peer = ipv4ToInt(addr);
  if (peer === null) return false;
  for (const addrs of Object.values(interfaces)) {
    for (const info of addrs ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const ifaceIp = ipv4ToInt(info.address);
      const mask = ipv4ToInt(info.netmask);
      if (ifaceIp === null || mask === null) continue;
      const network = (ifaceIp & mask) >>> 0;
      if (!isRfc1918(network)) continue;
      if (((peer & mask) >>> 0) === network) return true;
    }
  }
  return false;
}

/**
 * PAN-4299: Traefik appends the IP it accepted the connection from to
 * X-Forwarded-For, so the LAST entry is the client Traefik saw — a caller can
 * prepend fake entries but never replace that one. A local browser reaches
 * Traefik via docker-proxy and shows up as the bridge gateway, so "local" is
 * loopback or a host Docker-bridge IP. No header = a host-local container
 * calling the API directly (unchanged trust).
 */
export function forwardedClientIsLocal(
  headers: HeaderMap,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): boolean {
  const forwardedFor = getHeaderFromMap(headers, 'x-forwarded-for');
  if (forwardedFor === undefined) return true;
  const last = forwardedFor.split(',').pop()?.trim() ?? '';
  const client = last.startsWith('::ffff:') ? last.slice('::ffff:'.length) : last;
  if (client === '127.0.0.1' || client === '::1') return true;
  return peerIsHostLocalDockerBridge(client, interfaces);
}

/** Docker creates /.dockerenv in every container — stable in-container signal. */
const runningInContainer = existsSync('/.dockerenv');

/**
 * A request we trust to mint a session because it originated from this machine —
 * the local browser hitting the dashboard directly (127.0.0.1), or the
 * host-local Traefik that fronts overdeck.localhost. In Docker, that Traefik reaches
 * the host server from a Docker-bridge IP (e.g. 172.18.0.2), NOT 127.0.0.1, so
 * a literal-loopback check alone silently breaks the zero-step bootstrap for
 * every overdeck.localhost user — their session mint 401s and no cookie is ever set.
 *
 * This is the auto-bootstrap that removes the manual one-time #overdeck_token
 * step: any browser on overdeck.localhost gets a session with no user action. It is
 * NOT a security downgrade for the LAN — the raw API ports bind 0.0.0.0, but a
 * direct LAN hit has a non-loopback, non-Docker-bridge peer and is rejected. The
 * peer is read from the TCP socket (request.remoteAddress). For a Docker-bridge
 * peer only, the rightmost X-Forwarded-For entry must also be local
 * ({@link forwardedClientIsLocal}, PAN-4299): Traefik forwards LAN clients from
 * a bridge IP too, and the entry Traefik appends is the one a caller cannot spoof.
 */
export function isLoopbackPeer(request: HttpServerRequest.HttpServerRequest): boolean {
  const remoteAddress = (request as { remoteAddress?: unknown }).remoteAddress;
  const raw = remoteAddress && typeof remoteAddress === 'object' && '_tag' in remoteAddress
    ? Option.getOrElse(remoteAddress as Option.Option<string>, () => '')
    : typeof remoteAddress === 'string'
      ? remoteAddress
      : '';
  if (!raw) return false;
  // Node reports dual-stack IPv4 peers as IPv4-mapped IPv6 (::ffff:a.b.c.d).
  const addr = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
  if (addr === '127.0.0.1' || addr === '::1') return true;
  const interfaces = networkInterfaces();
  if (peerIsHostLocalDockerBridge(addr, interfaces)) {
    return forwardedClientIsLocal(request.headers as HeaderMap, interfaces);
  }
  return runningInContainer && peerIsLocalContainerNetwork(addr, interfaces);
}

/**
 * True when a reverse proxy forwarded the request. A local proxy (Tailscale
 * Serve, cloudflared, Traefik) makes every visitor look like a loopback peer,
 * so these headers mark a loopback request that did not start on this machine.
 */
export function hasProxyForwardingHeader(headers: HeaderMap): boolean {
  return ['x-forwarded-for', 'x-forwarded-host', 'forwarded'].some((name) => getHeaderFromMap(headers, name) !== undefined);
}

/** True for a request Tailscale Funnel proxied from the public internet. tailscaled deletes any client-sent copy and sets `?1` (ipn/ipnlocal/serve.go). */
export function isTailscaleFunnelRequest(headers: HeaderMap): boolean {
  return getHeaderFromMap(headers, 'tailscale-funnel-request') !== undefined;
}

export function rejectUnauthorizedDashboardSessionMintRequest(
  request: HttpServerRequest.HttpServerRequest,
  channel: ChannelMarker | null = channelOfRequest(request),
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalToken();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  // PAN-4645 NFR-2: no root credential is minted or honoured over a machine
  // channel, whatever headers it carries (H3).
  if (channel !== null) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  // With dashboard.require_token_mint, a loopback peer is not enough: a local
  // reverse proxy makes every remote visitor look like one (PAN-3762 D-3762-9).
  // A Tailscale Funnel request is a public visitor, never a trusted peer (PAN-4648).
  const peerTrusted =
    !readRemoteAccessConfig().requireTokenMint && isLoopbackPeer(request) && !isTailscaleFunnelRequest(request.headers as HeaderMap);
  if (!hasDashboardInternalToken(request) && !peerTrusted) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function rejectUnauthorizedDashboardRequest(
  request: HttpServerRequest.HttpServerRequest,
  channel: ChannelMarker | null = channelOfRequest(request),
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalToken();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  const credential = resolveDashboardCredential(request.headers as HeaderMap, channel);
  if (!credential) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  // Defense in depth behind the remote request gate (PAN-2351 D-6): the same
  // route-scope table, derived from the request's own method and path.
  const scopes = credentialScopes(credential);
  if (scopeSatisfies(scopes, 'admin')) return null;
  const pathname = gatePathname(request.url);
  const required = pathname === null ? 'admin' : requiredScopeFor(request.method, pathname);
  if (!scopeSatisfies(scopes, required)) {
    return jsonResponse({ error: 'insufficient_scope', missingScope: required }, { status: 403 });
  }
  return null;
}
