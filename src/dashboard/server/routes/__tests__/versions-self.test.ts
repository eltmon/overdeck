/**
 * PAN-4654 WI-3: GET /api/versions/self reports this machine's Overdeck and
 * harness CLI versions, and a linked machine reaches it with `read:state`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessVersionView } from '@overdeck/contracts';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  MACHINE_TOKEN_SCOPES,
} from '../../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../../channel-peer.js';
import { remoteGateRejection } from '../../remote-request-gate.js';
import { requiredScopeFor } from '../../route-scopes.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { buildVersionsReport } from '../versions-self.js';

const KEY = 'd4'.repeat(32);
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY, pairingId: null };
const originalHome = process.env.OVERDECK_HOME;
let home: string;

const CLAUDE: HarnessVersionView = {
  binary: 'claude', label: 'Claude Code', harnesses: ['claude-code'], version: '2.1.293',
  updatable: true, command: 'claude update', reason: null,
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4654-versions-self-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'versions-self-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
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

describe('GET /api/versions/self (PAN-4654 WI-3)', () => {
  it('reports the link protocol, the install mode and the injected harness list', async () => {
    const refreshes: boolean[] = [];
    const report = await buildVersionsReport({ refresh: true }, {
      listHarnessClis: async ({ refresh }) => { refreshes.push(refresh); return [CLAUDE]; },
      currentJob: () => null,
    });
    expect(report.overdeck.linkProtocol).toBe(1);
    expect(['npm-global', 'development', 'desktop']).toContain(report.overdeck.installMode);
    expect(report.overdeck.version).toMatch(/\d+\.\d+\.\d+/);
    expect(report.environmentId).toMatch(/\S/);
    expect(report.harnesses).toEqual([CLAUDE]);
    expect(report.job).toBeNull();
    expect(refreshes).toEqual([true]);
  });

  it('is a read:state row a machine credential reaches over its channel, on either access level', async () => {
    expect(requiredScopeFor('GET', '/api/versions/self')).toBe('read:state');
    for (const access of ['operator', 'agent-fenced'] as const) {
      const { token } = await createAccessToken({
        name: `machine:${access}`, kind: 'machine', scopes: MACHINE_TOKEN_SCOPES(access),
        machineKey: KEY, environmentId: `env-${access}`, access,
      });
      const request = HttpServerRequest
        .fromWeb(new Request('http://dashboard.test/api/versions/self', { headers: { authorization: `Bearer ${token}` } }))
        .modify({ remoteAddress: Option.some(`link:${KEY.slice(0, 16)}`) });
      expect(remoteGateRejection(request, LINK), access).toBeNull();
    }
  });
});
