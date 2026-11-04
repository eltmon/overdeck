/**
 * PAN-4835 WI-2: a `phone` credential resolves only inside a link-mode
 * channel bound to its `phoneKey`; a pairing or approval channel, another
 * key, and a plain socket all resolve to nothing. The CSRF/Origin skip
 * (channel-aware resolver) admits a phone's bearer and still 403s a
 * cookie-borne device credential without a CSRF token.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, MACHINE_TOKEN_SCOPES, PHONE_TOKEN_SCOPES } from '../../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import type { ChannelMarker } from '../../channel-peer.js';
import {
  _resetDashboardSessionTokenForTests,
  rejectUnsafeDashboardMutationRequest,
  resolveDashboardCredential,
} from '../dashboard-auth.js';

const PHONE_KEY_A = 'a1'.repeat(32);
const PHONE_KEY_B = 'b2'.repeat(32);
const MACHINE_KEY = 'd4'.repeat(32);
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: PHONE_KEY_A, pairingId: null };
const OTHER_LINK: ChannelMarker = { mode: 'link', remoteKeyHex: PHONE_KEY_B, pairingId: null };
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: PHONE_KEY_A, pairingId: 'cd'.repeat(16) };
const originalHome = process.env.OVERDECK_HOME;

/** A `ChannelSocket` stand-in: just the symbol `isChannelSocket` checks for, and the marker. */
function channelSocket(marker: ChannelMarker) {
  return { [Symbol.for('overdeck.anywhere.channelSocket')]: true, channel: marker };
}

function fakeRequest(headers: Record<string, string>, route: { method: string; url: string } = { method: 'GET', url: '/api/settings' }) {
  return { ...route, headers, remoteAddress: Option.none() } as unknown as Parameters<typeof rejectUnsafeDashboardMutationRequest>[0];
}

function fakeChannelRequest(headers: Record<string, string>, marker: ChannelMarker, route: { method: string; url: string }) {
  return {
    ...route,
    headers,
    remoteAddress: Option.none(),
    source: { socket: channelSocket(marker) },
  } as unknown as Parameters<typeof rejectUnsafeDashboardMutationRequest>[0];
}

let home: string;
let phoneToken: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4835-phone-cred-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'phone-cred-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  phoneToken = (await createAccessToken({
    name: 'phone:iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
    phoneKey: PHONE_KEY_A, clientId: CLIENT_ID,
  })).token;
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe('phone credential resolution (PAN-4835 FR-3)', () => {
  it('resolves a phone credential with the eight scopes inside a link channel bound to its key', () => {
    const credential = resolveDashboardCredential(bearer(phoneToken), LINK);
    expect(credential).toEqual({ kind: 'phone', tokenId: expect.any(String), clientId: CLIENT_ID, phoneKey: PHONE_KEY_A, scopes: [...PHONE_TOKEN_SCOPES] });
  });

  it('resolves nothing inside a channel bound to another key, a pairing channel, or a plain socket', () => {
    expect(resolveDashboardCredential(bearer(phoneToken), OTHER_LINK)).toBeNull();
    expect(resolveDashboardCredential(bearer(phoneToken), PAIRING)).toBeNull();
    expect(resolveDashboardCredential(bearer(phoneToken))).toBeNull();
    expect(resolveDashboardCredential(bearer(phoneToken), null)).toBeNull();
  });

  it('still resolves a machine credential as before, unaffected by the phone branch', async () => {
    const machine = await createAccessToken({
      name: 'machine:desk', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
      machineKey: MACHINE_KEY, environmentId: 'env-desk', access: 'operator',
    });
    const machineLink: ChannelMarker = { mode: 'link', remoteKeyHex: MACHINE_KEY, pairingId: null };
    const credential = resolveDashboardCredential(bearer(machine.token), machineLink);
    expect(credential).toMatchObject({ kind: 'machine', environmentId: 'env-desk' });
  });
});

describe('phone credential skips Origin/CSRF on a mutation (PAN-4835 D-5)', () => {
  const json = { 'content-type': 'application/json' };
  // A route already in the scope table with `scope: 'tell'` (one of PHONE_TOKEN_SCOPES),
  // so this test does not depend on WI-5's phone-specific scope rows.
  const route = { method: 'POST', url: '/api/conversations/c1/message' };

  it('admits a phone bearer over its channel with no CSRF header', () => {
    const request = fakeChannelRequest({ ...json, ...bearer(phoneToken) }, LINK, route);
    expect(rejectUnsafeDashboardMutationRequest(request)).toBeNull();
  });

  it('still 403s a cookie-borne device credential with no CSRF token', async () => {
    const device = await createAccessToken({ name: 'browser', scopes: ['admin'], kind: 'device' });
    const request = fakeRequest({ ...json, cookie: `overdeck_device=${device.token}` }, route);
    expect(rejectUnsafeDashboardMutationRequest(request)?.status).toBe(403);
  });
});
