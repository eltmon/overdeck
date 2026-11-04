/** PAN-4651 WI-23 (D-4651-19): a machine credential reads the cost summary and the request digest. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  MACHINE_TOKEN_SCOPES,
} from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../channel-peer.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import { requiredScopeFor } from '../route-scopes.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';

const KEY = 'c7'.repeat(32);
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY, pairingId: null };
const originalHome = process.env.OVERDECK_HOME;
let home: string;
let token: string;

const request = (method: string, path: string) => HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, {
  method, headers: { authorization: `Bearer ${token}`, 'x-overdeck-link-actor': 'operator' },
})).modify({ remoteAddress: Option.some(`link:${KEY.slice(0, 16)}`) });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4651-costs-scope-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'costs-scope-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  token = (await createAccessToken({
    name: 'machine:desk', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('agent-fenced'),
    machineKey: KEY, environmentId: 'env-desk', access: 'agent-fenced',
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

describe('cost routes for machine credentials (D-4651-19)', () => {
  it('ac23: maps the summary and the digest to read:costs, and a machine credential passes the gate', () => {
    expect(requiredScopeFor('GET', '/api/costs/summary')).toBe('read:costs');
    expect(requiredScopeFor('GET', '/api/costs/request-digest')).toBe('read:costs');
    expect(remoteGateRejection(request('GET', '/api/costs/summary'), LINK)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/costs/request-digest'), LINK)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/costs/by-issue'), LINK)).toEqual({ status: 403, missingScope: 'admin' });
  });
});
