import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { HttpServerRequest } from 'effect/unstable/http';

import { Effect } from 'effect';
import { PanRpcGroup, WS_METHODS } from '@overdeck/contracts';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import type { ChannelMarker } from '../channel-peer.js';
import { allowedRpcTags, RPC_METHOD_SCOPES } from '../route-scopes.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader, type DashboardCredential, resolveDashboardCredential } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import {
  _resetRpcHandlerMemoForTests,
  authorizeRpcUpgrade,
  omittedRpcTags,
  rejectUnauthorizedRpcUpgrade,
  restrictedRpcGroup,
  selectRpcHandler,
} from '../ws-rpc-auth.js';
import { getOverdeckHome } from '../../../lib/paths.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

/** Minimal HttpServerRequest stand-in for the RPC upgrade gate (reads headers + method). */
function fakeRequest(headers: Record<string, string>): HttpServerRequest.HttpServerRequest {
  return { headers, method: 'GET' } as unknown as HttpServerRequest.HttpServerRequest;
}

describe('rejectUnauthorizedRpcUpgrade', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('rejects a trusted origin with no credential (401)', () => {
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: TRUSTED_ORIGIN }));
    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe(401);
  });

  it('accepts a trusted origin with a valid session cookie', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: TRUSTED_ORIGIN, cookie }));
    expect(rejected).toBeNull();
  });

  it('rejects an untrusted origin (403)', () => {
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: 'https://evil.example' }));
    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe(403);
  });
});

describe('rejectUnauthorizedRpcUpgrade scopes (PAN-2351)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-2351-ws-scope-'));
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    _resetAccessTokensForTests();
  });

  afterEach(async () => {
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  async function bearer(scopes: Parameters<typeof createAccessToken>[0]['scopes']) {
    const { token } = await createAccessToken({ name: scopes.join('+'), scopes, kind: 'token' });
    return { authorization: `Bearer ${token}` };
  }

  it('rejects an operate token with 403 and upgrades an admin token', async () => {
    expect(rejectUnauthorizedRpcUpgrade(fakeRequest(await bearer(['operate'])))?.status).toBe(403);
    expect(rejectUnauthorizedRpcUpgrade(fakeRequest(await bearer(['admin'])))).toBeNull();
  });

  it('PAN-4645 D-4645-14: the upgrade needs read:events or read:conversations, not admin', async () => {
    expect(authorizeRpcUpgrade(fakeRequest(await bearer(['read:state'])))).toMatchObject({ ok: false, status: 403 });
    expect(authorizeRpcUpgrade(fakeRequest(await bearer(['read:events'])))).toMatchObject({ ok: true, credential: { kind: 'token' } });
    expect(authorizeRpcUpgrade(fakeRequest(await bearer(['read:conversations'])))).toMatchObject({ ok: true });
    expect(authorizeRpcUpgrade(fakeRequest(await bearer(['admin'])))).toMatchObject({ ok: true });
    expect(authorizeRpcUpgrade(fakeRequest({ origin: 'https://evil.example', ...(await bearer(['admin'])) }))).toMatchObject({ ok: false, status: 403 });
  });
});

describe('scoped /ws/rpc method groups (PAN-4645 WI-6)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  const KEY = 'd4'.repeat(32);
  const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY, pairingId: null };
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-4645-ws-rpc-scoped-'));
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    _resetAccessTokensForTests();
    _resetRpcHandlerMemoForTests();
  });

  afterEach(async () => {
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    _resetRpcHandlerMemoForTests();
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  async function machineCredential(): Promise<DashboardCredential> {
    const { token } = await createAccessToken({
      name: 'machine:desk', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
      machineKey: KEY, environmentId: 'env-desk', access: 'operator',
    });
    const credential = resolveDashboardCredential({ authorization: `Bearer ${token}` }, LINK);
    if (!credential) throw new Error('machine credential did not resolve');
    return credential;
  }

  it('a machine credential may call exactly getSnapshot, replayEvents, subscribeConversationMessages and subscribeDomainEvents', async () => {
    // PAN-4835: getSnapshot and replayEvents joined the table as the boot surfaces
    // every dashboard client (phone app included) needs.
    expect(allowedRpcTags(MACHINE_TOKEN_SCOPES('operator'))).toEqual(
      [WS_METHODS.getSnapshot, WS_METHODS.replayEvents, WS_METHODS.subscribeConversationMessages, WS_METHODS.subscribeDomainEvents].sort(),
    );
    expect(allowedRpcTags(['read:events'])).toEqual([WS_METHODS.replayEvents, WS_METHODS.subscribeDomainEvents].sort());
    expect(allowedRpcTags(['admin'])).toEqual([...PanRpcGroup.requests.keys()].sort());
    expect(Object.keys(RPC_METHOD_SCOPES).every((tag) => PanRpcGroup.requests.has(tag))).toBe(true);

    const credential = await machineCredential();
    const omit = omittedRpcTags(credential);
    const restricted = restrictedRpcGroup(omit);
    expect([...restricted.requests.keys()].sort()).toEqual(
      [WS_METHODS.getSnapshot, WS_METHODS.replayEvents, WS_METHODS.subscribeConversationMessages, WS_METHODS.subscribeDomainEvents].sort(),
    );
    // pan.deepWipe has no handler on the restricted group: a call cannot reach one.
    expect(restricted.requests.has(WS_METHODS.deepWipe)).toBe(false);
    expect(PanRpcGroup.requests.has(WS_METHODS.deepWipe)).toBe(true);
    expect(omit).toHaveLength(PanRpcGroup.requests.size - 4);
  });

  it('admin credentials get the full group; others get one memoised restricted handler per allowed set', async () => {
    const builds: string[][] = [];
    const source = {
      full: 'FULL',
      build: (omit: ReadonlyArray<string>) => Effect.sync(() => { builds.push([...omit]); return `RESTRICTED:${omit.length}`; }),
    };
    expect(await Effect.runPromise(selectRpcHandler({ kind: 'root-session' }, source))).toBe('FULL');
    expect(await Effect.runPromise(selectRpcHandler({ kind: 'device', deviceId: 'd', scopes: ['admin'] }, source))).toBe('FULL');
    expect(builds).toEqual([]);

    const credential = await machineCredential();
    const first = await Effect.runPromise(selectRpcHandler(credential, source));
    const second = await Effect.runPromise(selectRpcHandler(credential, source));
    // PAN-4835: getSnapshot and replayEvents joined the table, so a machine
    // credential now allows 4 tags (was 2).
    expect(first).toBe(`RESTRICTED:${PanRpcGroup.requests.size - 4}`);
    expect(second).toBe(first);
    expect(builds).toHaveLength(1);

    const eventsOnly = await Effect.runPromise(selectRpcHandler({ kind: 'token', tokenId: 't', scopes: ['read:events'] }, source));
    expect(eventsOnly).toBe(`RESTRICTED:${PanRpcGroup.requests.size - 2}`);
    expect(builds).toHaveLength(2);
  });
});
