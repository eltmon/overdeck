/**
 * PAN-4654 WI-3: GET /api/versions/self reports this machine's Overdeck and
 * harness CLI versions, and a linked machine reaches it with `read:state`.
 * WI-6: POST/DELETE /api/versions/self/update are fenced to an operator-level
 * link acting for the operator (D-10) and follow the D-13 job rules.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetUpdateJob, HarnessVersionView } from '@overdeck/contracts';

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
import { FleetUpdateService } from '../../services/fleet-update-service.js';
import { _resetDashboardSessionTokenForTests, type DashboardCredential } from '../dashboard-auth.js';
import { buildVersionsReport, type FleetUpdateRequest, type FleetUpdateRouteDeps, handleFleetUpdate } from '../versions-self.js';

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

function service(options: { turns?: number; run?: () => Promise<{ code: number; output: string }> } = {}) {
  const runCommand = vi.fn(options.run ?? (async () => ({ code: 0, output: '' })));
  const svc = new FleetUpdateService({
    jobPath: '/h/fleet-update.json',
    readFile: async () => { throw new Error('ENOENT'); },
    writeFile: async () => undefined,
    rename: async () => undefined,
    detectClis: async () => [{
      binary: 'claude', label: 'Claude Code', harnesses: ['claude-code'], version: '2.1.0', updatable: true,
      command: 'claude update', reason: null, binaryPath: '/b/claude', plan: { argv: ['/b/claude', 'update'], display: 'claude update', reason: null },
    }],
    readVersion: async () => '2.1.5',
    runCommand,
    countWorkingTurns: async () => options.turns ?? 0,
    overdeck: { installMode: () => 'development', version: async () => '0.73.0', manager: async () => { throw new Error('unused'); } },
    restart: async () => ({ ok: true, pid: null }),
    emit: () => undefined,
    now: () => Date.now(),
    randomId: () => 'job-1',
  });
  return { svc, runCommand };
}

function routeDeps(svc: FleetUpdateService, primary = true): FleetUpdateRouteDeps {
  return { service: svc, primary: () => primary, machineName: (tokenId) => (tokenId === 'tok-desk' ? 'machine:desk' : null) };
}

const machine = (actor: 'operator' | { agentId: string }, access: 'operator' | 'agent-fenced'): DashboardCredential => ({
  kind: 'machine', tokenId: 'tok-desk', environmentId: 'env-desk', scopes: ['read:state', 'operate'], actor, access,
});

function fleetRequest(overrides: Partial<FleetUpdateRequest> = {}): FleetUpdateRequest {
  return { method: 'POST', bodyText: '{}', viaChannel: false, credential: { kind: 'root-session' }, localRejection: null, ...overrides };
}

async function call(request: FleetUpdateRequest, deps: FleetUpdateRouteDeps): Promise<{ status: number; body: { error?: string; job?: FleetUpdateJob | null } }> {
  const response = await handleFleetUpdate(request, deps);
  const web = HttpServerResponse.toWeb(response);
  return { status: web.status, body: await web.json() as { error?: string; job?: FleetUpdateJob | null } };
}

describe('POST and DELETE /api/versions/self/update (PAN-4654 WI-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is an operate row in the scope table', () => {
    expect(requiredScopeFor('POST', '/api/versions/self/update')).toBe('operate');
    expect(requiredScopeFor('DELETE', '/api/versions/self/update')).toBe('operate');
  });

  it('a machine credential with an agent actor gets 403 and starts nothing', async () => {
    const { svc } = service();
    const result = await call(fleetRequest({ viaChannel: true, credential: machine({ agentId: 'pan-12' }, 'operator') }), routeDeps(svc));
    expect(result).toMatchObject({ status: 403, body: { error: 'fleet-update-forbidden' } });
    expect(svc.current()).toBeNull();
  });

  it('an operator actor on an agent-fenced link gets 403', async () => {
    const { svc } = service();
    const result = await call(fleetRequest({ viaChannel: true, credential: machine({ agentId: 'operator-fenced' }, 'agent-fenced') }), routeDeps(svc));
    expect(result.status).toBe(403);
    expect(svc.current()).toBeNull();
  });

  it('a request through a channel without a machine credential gets 403', async () => {
    const { svc } = service();
    expect((await call(fleetRequest({ viaChannel: true, credential: null }), routeDeps(svc))).status).toBe(403);
  });

  it('an operator actor on an operator-level link starts a job: 202, requested by the machine', async () => {
    const { svc } = service({ turns: 1 });
    const result = await call(fleetRequest({ viaChannel: true, credential: machine('operator', 'operator') }), routeDeps(svc));
    expect(result.status).toBe(202);
    expect(result.body.job).toMatchObject({ phase: 'waiting', mode: 'when-idle', requestedBy: 'machine:desk' });
  });

  it('a token credential without admin gets 403 outside a channel; the local mutation guard answers first', async () => {
    const { svc } = service();
    const token: DashboardCredential = { kind: 'token', tokenId: 't1', scopes: ['operate'] };
    expect((await call(fleetRequest({ credential: token }), routeDeps(svc))).status).toBe(403);
    const admin: DashboardCredential = { kind: 'token', tokenId: 't2', scopes: ['admin'] };
    const rejection = HttpServerResponse.text('csrf', { status: 403 });
    expect(await handleFleetUpdate(fleetRequest({ credential: admin, localRejection: rejection }), routeDeps(svc))).toBe(rejection);
    expect(svc.current()).toBeNull();
    expect((await call(fleetRequest({ credential: admin }), routeDeps(svc))).status).toBe(202);
    expect(svc.current()?.requestedBy).toBe('operator');
  });

  it('rejects a body mode other than when-idle or now', async () => {
    const { svc } = service();
    expect(await call(fleetRequest({ bodyText: '{"mode":"later"}' }), routeDeps(svc))).toMatchObject({ status: 400, body: { error: 'mode must be when-idle or now' } });
    expect(await call(fleetRequest({ bodyText: 'nope' }), routeDeps(svc))).toMatchObject({ status: 400 });
  });

  it('a peer dashboard answers 409 not-primary', async () => {
    const { svc } = service();
    expect(await call(fleetRequest(), routeDeps(svc, false))).toMatchObject({ status: 409, body: { error: 'not-primary' } });
  });

  it('mode now on a waiting job answers 200 and escalates; a second start answers 409 update-in-progress', async () => {
    const { svc, runCommand } = service({ turns: 1, run: () => new Promise(() => undefined) });
    expect((await call(fleetRequest(), routeDeps(svc))).status).toBe(202);
    const escalated = await call(fleetRequest({ bodyText: '{"mode":"now"}' }), routeDeps(svc));
    expect(escalated).toMatchObject({ status: 200, body: { job: { mode: 'now' } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(await call(fleetRequest({ bodyText: '{"mode":"now"}' }), routeDeps(svc))).toMatchObject({ status: 409, body: { error: 'update-in-progress', job: { phase: 'updating' } } });
  });

  it('DELETE on a waiting job cancels it; on an updating job answers 409 not-waiting', async () => {
    const waiting = service({ turns: 1 });
    await call(fleetRequest(), routeDeps(waiting.svc));
    expect(await call(fleetRequest({ method: 'DELETE', bodyText: '' }), routeDeps(waiting.svc))).toMatchObject({ status: 200, body: { job: { phase: 'cancelled' } } });

    const busy = service({ run: () => new Promise(() => undefined) });
    await call(fleetRequest({ bodyText: '{"mode":"now"}' }), routeDeps(busy.svc));
    await vi.advanceTimersByTimeAsync(0);
    expect(await call(fleetRequest({ method: 'DELETE', bodyText: '' }), routeDeps(busy.svc))).toMatchObject({ status: 409, body: { error: 'not-waiting', job: { phase: 'updating' } } });

    const idle = service();
    expect(await call(fleetRequest({ method: 'DELETE', bodyText: '' }), routeDeps(idle.svc))).toMatchObject({ status: 409, body: { error: 'not-waiting', job: null } });
  });
});
