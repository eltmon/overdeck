import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

import { Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { getHeaderFromMap, getTrustedOrigins, normalizeOrigin, type HeaderMap } from './origin-validation.js';

export const DASHBOARD_SESSION_COOKIE = 'panopticon_session';
export const DASHBOARD_CSRF_HEADER = 'x-panopticon-csrf-token';
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
  const override = process.env['PANOPTICON_DASHBOARD_SESSION_TOKEN'];
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
  const internal = getInternalTokenSync();
  browserSessionToken = internal
    ? createHmac('sha256', internal).update('panopticon-dashboard-session-v1').digest('base64url')
    : randomBytes(32).toString('base64url');
  return browserSessionToken;
}

export function dashboardCsrfToken(): string {
  if (browserCsrfToken) return browserCsrfToken;
  const override = process.env['PANOPTICON_DASHBOARD_CSRF_TOKEN'];
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
  const internal = getInternalTokenSync();
  browserCsrfToken = internal
    ? createHmac('sha256', internal).update('panopticon-dashboard-csrf-v1').digest('base64url')
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

export function hasDashboardInternalTokenHeaders(headers: HeaderMap): boolean {
  const expected = getInternalTokenSync();
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

export function hasDashboardAuthHeaders(headers: HeaderMap): boolean {
  return hasDashboardInternalTokenHeaders(headers) || constantTimeTokenEqual(cookieValue(getHeaderFromMap(headers, 'cookie'), DASHBOARD_SESSION_COOKIE), getDashboardSessionToken());
}

export function hasDashboardAuth(request: HttpServerRequest.HttpServerRequest): boolean {
  return hasDashboardAuthHeaders(request.headers as HeaderMap);
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
): Response | null {
  const authError = rejectUnauthorizedDashboardRequest(request);
  if (authError) return authError;

  const headers = request.headers as HeaderMap;
  if (!isJsonContentType(headers)) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, { status: 400 });
  }

  if (hasDashboardInternalToken(request)) return null;

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
 * machine — our own host-local Traefik fronting pan.localhost, or another
 * Panopticon container — never a LAN client (a direct LAN hit to the 0.0.0.0
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
 * A request we trust to mint a session because it originated from this machine —
 * the local browser hitting the dashboard directly (127.0.0.1), or the
 * host-local Traefik that fronts pan.localhost. In Docker, that Traefik reaches
 * the host server from a Docker-bridge IP (e.g. 172.18.0.2), NOT 127.0.0.1, so
 * a literal-loopback check alone silently breaks the zero-step bootstrap for
 * every pan.localhost user — their session mint 401s and no cookie is ever set.
 *
 * This is the auto-bootstrap that removes the manual one-time #panopticon_token
 * step: any browser on pan.localhost gets a session with no user action. It is
 * NOT a security downgrade for the LAN — the raw API ports bind 0.0.0.0, but a
 * direct LAN hit has a non-loopback, non-Docker-bridge peer and is rejected. We
 * read ONLY the real TCP peer (request.remoteAddress), never X-Forwarded-For,
 * which a caller could spoof.
 */
function isLoopbackPeer(request: HttpServerRequest.HttpServerRequest): boolean {
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
  return peerIsHostLocalDockerBridge(addr, networkInterfaces());
}

export function rejectUnauthorizedDashboardSessionMintRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalTokenSync();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardInternalToken(request) && !isLoopbackPeer(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function rejectUnauthorizedDashboardRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalTokenSync();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardAuth(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
