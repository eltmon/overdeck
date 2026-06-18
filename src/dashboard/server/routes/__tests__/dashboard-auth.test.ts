import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Option } from 'effect';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import type { NetworkInterfaceInfo } from 'node:os';

import {
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardCsrfToken,
  dashboardSessionCookieHeader,
  hasDashboardAuthHeaders,
  peerIsHostLocalDockerBridge,
  peerIsLocalContainerNetwork,
  rejectUnauthorizedDashboardSessionMintRequest,
} from '../dashboard-auth.js';

/** Build a minimal IPv4 NetworkInterfaceInfo for an injected interface map. */
function ipv4(address: string, netmask: string): NetworkInterfaceInfo {
  return { address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: null };
}

/** Minimal HttpServerRequest stand-in for the mint auth gate (reads headers + remoteAddress). */
function fakeRequest(opts: { remoteAddress?: string; headers?: Record<string, string> }) {
  return {
    headers: opts.headers ?? {},
    remoteAddress: opts.remoteAddress ? Option.some(opts.remoteAddress) : Option.none(),
  } as unknown as Parameters<typeof rejectUnauthorizedDashboardSessionMintRequest>[0];
}

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('dashboard session token persistence', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('keeps a previously-minted session cookie valid across a restart (token regen)', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    expect(cookie.startsWith(`${DASHBOARD_SESSION_COOKIE}=`)).toBe(true);

    // Simulate a dashboard restart: the in-process session token is cleared and
    // re-derived. Because it is derived from the persisted internal token, the
    // cookie minted before the restart must still authenticate afterwards.
    _resetDashboardSessionTokenForTests();

    expect(hasDashboardAuthHeaders({ cookie })).toBe(true);
  });

  it('honors OVERDECK_DASHBOARD_SESSION_TOKEN override over internal-token derivation', () => {
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'explicit-override-token';
    _resetDashboardSessionTokenForTests();

    const cookie = requestCookie(dashboardSessionCookieHeader());
    expect(cookie).toBe(`${DASHBOARD_SESSION_COOKIE}=explicit-override-token`);
    expect(hasDashboardAuthHeaders({ cookie })).toBe(true);
  });

  it('invalidates a session cookie when the internal token rotates', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());

    process.env.OVERDECK_INTERNAL_TOKEN = 'rotated-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();

    expect(hasDashboardAuthHeaders({ cookie })).toBe(false);
  });

  it('issues a durable (Max-Age) session cookie so it survives a browser close', () => {
    expect(dashboardSessionCookieHeader()).toMatch(/Max-Age=\d+/);
  });
});

describe('dashboard CSRF token persistence', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('keeps the CSRF token stable across a restart (token regen)', () => {
    // The frontend caches the CSRF token once per page load; a random
    // per-process value 403'd every mutation from open tabs after each
    // dashboard restart (flywheel post-merge deploys restart the dashboard).
    const before = dashboardCsrfToken();
    _resetDashboardSessionTokenForTests();
    expect(dashboardCsrfToken()).toBe(before);
  });

  it('honors OVERDECK_DASHBOARD_CSRF_TOKEN override over internal-token derivation', () => {
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'explicit-csrf-override';
    _resetDashboardSessionTokenForTests();
    expect(dashboardCsrfToken()).toBe('explicit-csrf-override');
  });

  it('rotates the CSRF token when the internal token rotates, independently of the session token', () => {
    const before = dashboardCsrfToken();
    expect(before).not.toBe(requestCookie(dashboardSessionCookieHeader()).split('=')[1]);

    process.env.OVERDECK_INTERNAL_TOKEN = 'rotated-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();

    expect(dashboardCsrfToken()).not.toBe(before);
  });
});

describe('dashboard session mint auth gate', () => {
  beforeEach(() => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
  });
  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
  });

  it('auto-mints for a loopback peer with no token or cookie (zero-step bootstrap)', () => {
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(rejectUnauthorizedDashboardSessionMintRequest(fakeRequest({ remoteAddress: addr }))).toBeNull();
    }
  });

  it('rejects a mint from a non-loopback peer without a token (LAN cannot bootstrap)', () => {
    expect(rejectUnauthorizedDashboardSessionMintRequest(fakeRequest({ remoteAddress: '192.168.1.50' }))).not.toBeNull();
  });

  it('mints for the internal token even from a non-loopback peer (CLI / cross-process)', () => {
    const req = fakeRequest({ remoteAddress: '192.168.1.50', headers: { [INTERNAL_TOKEN_HEADER]: 'stable-internal-token' } });
    expect(rejectUnauthorizedDashboardSessionMintRequest(req)).toBeNull();
  });
});

describe('peerIsHostLocalDockerBridge — host-local Traefik trust', () => {
  // Mirrors the real host: the panopticon Docker network's host-side bridge.
  const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
    lo: [ipv4('127.0.0.1', '255.0.0.0')],
    eth0: [ipv4('192.168.1.10', '255.255.255.0')],
    'br-849257118e6e': [ipv4('172.18.0.1', '255.255.0.0')],
    docker0: [ipv4('172.17.0.1', '255.255.0.0')],
  };

  it('trusts a container peer inside a host Docker bridge subnet (the Traefik case)', () => {
    // panopticon-traefik reaches the host server from 172.18.0.2 — inside br-* /16.
    expect(peerIsHostLocalDockerBridge('172.18.0.2', interfaces)).toBe(true);
    expect(peerIsHostLocalDockerBridge('172.17.0.9', interfaces)).toBe(true);
  });

  it('rejects a LAN peer that is not inside any Docker bridge subnet', () => {
    // Same subnet as eth0, but eth0 is not a Docker bridge — must not be trusted.
    expect(peerIsHostLocalDockerBridge('192.168.1.50', interfaces)).toBe(false);
  });

  it('rejects a private IP outside every host bridge subnet', () => {
    expect(peerIsHostLocalDockerBridge('172.30.0.5', interfaces)).toBe(false);
    expect(peerIsHostLocalDockerBridge('10.1.2.3', interfaces)).toBe(false);
  });

  it('rejects a public IP and malformed input', () => {
    expect(peerIsHostLocalDockerBridge('8.8.8.8', interfaces)).toBe(false);
    expect(peerIsHostLocalDockerBridge('not-an-ip', interfaces)).toBe(false);
    expect(peerIsHostLocalDockerBridge('', interfaces)).toBe(false);
  });

  it('refuses to trust a non-RFC1918 br-* subnet (misconfig guard)', () => {
    const publicBridge: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      'br-rogue': [ipv4('8.8.0.1', '255.255.0.0')],
    };
    expect(peerIsHostLocalDockerBridge('8.8.0.2', publicBridge)).toBe(false);
  });
});

describe('peerIsLocalContainerNetwork — in-container Traefik trust', () => {
  // Mirrors a workspace/UAT stack server container: veth endpoints on the
  // project-private devnet and the shared panopticon network. No docker0/br-*
  // names exist inside a container — that's exactly why the host check missed.
  const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
    lo: [{ ...ipv4('127.0.0.1', '255.0.0.0'), internal: true }],
    eth0: [ipv4('172.21.0.3', '255.255.0.0')],
    eth1: [ipv4('172.18.0.7', '255.255.0.0')],
  };

  it('trusts a peer on one of the container\'s own Docker network subnets (the Traefik case)', () => {
    expect(peerIsLocalContainerNetwork('172.18.0.2', interfaces)).toBe(true);
    expect(peerIsLocalContainerNetwork('172.21.0.9', interfaces)).toBe(true);
  });

  it('rejects peers outside every attached subnet', () => {
    expect(peerIsLocalContainerNetwork('172.30.0.5', interfaces)).toBe(false);
    expect(peerIsLocalContainerNetwork('10.1.2.3', interfaces)).toBe(false);
  });

  it('rejects public IPs, malformed input, and internal interfaces', () => {
    expect(peerIsLocalContainerNetwork('8.8.8.8', interfaces)).toBe(false);
    expect(peerIsLocalContainerNetwork('not-an-ip', interfaces)).toBe(false);
    // lo is internal:true — a 127.x peer must not be trusted via the subnet path.
    expect(peerIsLocalContainerNetwork('127.0.0.2', interfaces)).toBe(false);
  });

  it('refuses to trust a non-RFC1918 interface subnet (misconfig guard)', () => {
    const publicIface: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      eth0: [ipv4('8.8.0.1', '255.255.0.0')],
    };
    expect(peerIsLocalContainerNetwork('8.8.0.2', publicIface)).toBe(false);
  });
});
