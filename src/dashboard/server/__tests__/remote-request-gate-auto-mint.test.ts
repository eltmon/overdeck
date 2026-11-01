/**
 * PAN-4645 WI-15: with a machine link and the YAML key unset, a forwarded
 * loopback session mint is refused; with nothing remote it passes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } from '../../../lib/access-tokens.js';
import { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, upsertLink } from '../../../lib/anywhere/link-store.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig, readRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import { _resetDashboardSessionTokenForTests, rejectUnauthorizedDashboardSessionMintRequest } from '../routes/dashboard-auth.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

function forwardedMint() {
  return HttpServerRequest.fromWeb(new Request('http://dashboard.test/api/dashboard/session', {
    method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' },
  })).modify({ remoteAddress: Option.some('127.0.0.1') });
}

function forwardedLocalRead() {
  return HttpServerRequest.fromWeb(new Request('http://dashboard.test/api/issues', { headers: { 'x-forwarded-for': '203.0.113.9' } }))
    .modify({ remoteAddress: Option.some('127.0.0.1') });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-gate-auto-mint-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'gate-auto-mint-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  await _settleLinkStoreWritesForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  invalidateRemoteAccessConfig();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('forwarded loopback mint with automatic require_token_mint (PAN-4645 WI-15)', () => {
  it('ac2: with nothing remote the forwarded loopback mint and read pass', () => {
    expect(readRemoteAccessConfig().requireTokenMint).toBe(false);
    expect(rejectUnauthorizedDashboardSessionMintRequest(forwardedMint())).toBeNull();
    expect(remoteGateRejection(forwardedLocalRead())).toBeNull();
  });

  it('ac1: one active machine link and the YAML key unset => the forwarded loopback mint returns 401 and the gate treats the peer as remote', async () => {
    await upsertLink({
      environmentId: 'env-peer', label: 'peer', machineKey: 'a1'.repeat(32), token: `odk_${'9'.repeat(64)}`, access: 'operator', routes: [],
    });
    expect(readRemoteAccessConfig()).toMatchObject({ requireTokenMint: true, configured: false, autoReasons: ['machine-link'] });
    expect(rejectUnauthorizedDashboardSessionMintRequest(forwardedMint())?.status).toBe(401);
    expect(remoteGateRejection(forwardedLocalRead())).toEqual({ status: 401 });
    // A plain loopback peer (no forwarding header) still mints: the local browser keeps working.
    const local = HttpServerRequest.fromWeb(new Request('http://dashboard.test/api/dashboard/session', { method: 'POST' }))
      .modify({ remoteAddress: Option.some('127.0.0.1') });
    expect(rejectUnauthorizedDashboardSessionMintRequest(local)?.status).toBe(401);
  });
});
