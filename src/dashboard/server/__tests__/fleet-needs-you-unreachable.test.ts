/**
 * PAN-5111 WI-9 (D-10, D-12): fleet Needs-You lists linked machines this machine
 * could not fetch Needs-You from, and a paired phone reaches that list (only)
 * through its link channel.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { LinkedNeedsYouFailure, LinkedNeedsYouSync } from '../services/linked-needs-you-sync.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const AIR = { id: 'link-air', environmentId: 'env-air', label: 'Edwards-MacBook-Air.local', revokedAt: null } as MachineLink;

const mocks = vi.hoisted(() => ({
  channelOfRequest: vi.fn(),
  links: [] as MachineLink[],
  states: {} as Record<string, string>,
}));
vi.mock('../channel-peer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-peer.js')>()),
  channelOfRequest: mocks.channelOfRequest,
}));
vi.mock('../../../lib/anywhere/link-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/anywhere/link-store.js')>()),
  listLinks: async () => mocks.links,
}));
vi.mock('../services/anywhere-boot.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/anywhere-boot.js')>()),
  currentLinkSupervisor: () => ({ status: (linkId: string) => ({ state: mocks.states[linkId] ?? 'online' }) }),
}));

const { buildFleetNeedsYou, fleetAwarenessRouteLayer, UNREACHABLE_FRESH_MS } = await import('../routes/fleet-awareness.js');
type FleetAwarenessDeps = import('../routes/fleet-awareness.js').FleetAwarenessDeps;
const { setLinkedNeedsYouSync } = await import('../services/linked-needs-you-sync.js');
const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');

function failure(minutesAgo: number): LinkedNeedsYouFailure {
  return {
    since: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    lastAttemptAt: new Date(NOW - minutesAgo * 60 * 1000).toISOString(),
    reason: 'Secure channel did not open within 10000 ms',
  };
}

function deps(links: MachineLink[], states: Record<string, string>, failures: Record<string, LinkedNeedsYouFailure>): FleetAwarenessDeps {
  return {
    links: async () => links,
    status: ((linkId: string) => ({ state: states[linkId] ?? 'online' })) as unknown as FleetAwarenessDeps['status'],
    needsYou: () => null,
    needsYouFailure: (environmentId) => failures[environmentId] ?? null,
    now: () => NOW,
  };
}

describe('buildFleetNeedsYou unreachable (PAN-5111 D-10)', () => {
  it('lists an online link whose fetch failed 5 minutes ago', async () => {
    const result = await buildFleetNeedsYou(deps([AIR], {}, { 'env-air': failure(5) }));
    expect(result.unreachable).toEqual([{
      environmentId: 'env-air',
      label: 'Edwards-MacBook-Air.local',
      since: failure(5).since,
      reason: 'Secure channel did not open within 10000 ms',
    }]);
  });

  it('also lists an offline (flapping) link with a recent failure', async () => {
    const result = await buildFleetNeedsYou(deps([AIR], { 'link-air': 'offline' }, { 'env-air': failure(5) }));
    expect(result.unreachable.map((row) => row.environmentId)).toEqual(['env-air']);
    expect(result.machines).toEqual([]);
  });

  it('drops a failure whose last attempt is older than an hour', async () => {
    expect(UNREACHABLE_FRESH_MS).toBe(60 * 60 * 1000);
    const result = await buildFleetNeedsYou(deps([AIR], {}, { 'env-air': failure(61) }));
    expect(result.unreachable).toEqual([]);
  });

  it('skips revoked, hidden and failure-free links', async () => {
    const revoked = { ...AIR, id: 'link-r', environmentId: 'env-r', revokedAt: '2026-11-01T00:00:00.000Z' } as MachineLink;
    const hidden = { ...AIR, id: 'link-h', environmentId: 'env-h', hidden: true } as MachineLink;
    const supervisorRevoked = { ...AIR, id: 'link-s', environmentId: 'env-s' } as MachineLink;
    const result = await buildFleetNeedsYou(deps(
      [revoked, hidden, supervisorRevoked, DESK],
      { 'link-s': 'revoked' },
      { 'env-r': failure(5), 'env-h': failure(5), 'env-s': failure(5) },
    ));
    expect(result.unreachable).toEqual([]);
  });
});

describe('GET /api/fleet/needs-you through a channel (PAN-5111 D-12)', () => {
  const PHONE_KEY = 'a1'.repeat(32);
  const MACHINE_KEY = 'd2'.repeat(32);
  const originalHome = process.env.OVERDECK_HOME;
  const originalInternalToken = process.env.OVERDECK_INTERNAL_TOKEN;
  let home: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    home = await mkdtemp(join(tmpdir(), 'pan-5111-fleet-unreachable-'));
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetAccessTokensForTests();
    mocks.links = [AIR];
    mocks.states = {};
    setLinkedNeedsYouSync({
      feedFor: () => ({ hash: 'h', conversations: [{ name: 'conv-q' }], agents: [] }),
      failureFor: (environmentId: string) => (environmentId === 'env-air' ? failure(5) : null),
    } as unknown as LinkedNeedsYouSync);
  });

  afterEach(async () => {
    vi.useRealTimers();
    setLinkedNeedsYouSync(null);
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalInternalToken === undefined) delete process.env.OVERDECK_INTERNAL_TOKEN;
    else process.env.OVERDECK_INTERNAL_TOKEN = originalInternalToken;
    _resetInternalTokenCacheForTests();
    await rm(home, { recursive: true, force: true });
  });

  async function call(token: string, remoteKeyHex: string): Promise<{ status: number; body: Record<string, unknown> }> {
    mocks.channelOfRequest.mockReturnValue({ mode: 'link', remoteKeyHex, pairingId: null });
    const req = HttpServerRequest.fromWeb(new Request('http://link.invalid/api/fleet/needs-you', {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    }));
    const response = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(HttpRouter.toHttpEffect(fleetAwarenessRouteLayer), (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req))),
    );
    const responseBody = response.body as { body?: Uint8Array } | null;
    const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  }

  it('gives a paired phone the unreachable list and no machine rows', async () => {
    const { token } = await createAccessToken({
      name: 'phone:pixel',
      kind: 'phone',
      scopes: ['read:conversations'],
      phoneKey: PHONE_KEY,
      clientId: '44444444-4444-4444-8444-444444444444',
    });
    expect(await call(token, PHONE_KEY)).toEqual({
      status: 200,
      body: {
        machines: [],
        unreachable: [{ environmentId: 'env-air', label: 'Edwards-MacBook-Air.local', since: failure(5).since, reason: 'Secure channel did not open within 10000 ms' }],
      },
    });
  });

  it('still refuses a linked machine', async () => {
    const { token } = await createAccessToken({
      name: 'machine:desk',
      kind: 'machine',
      scopes: ['read:conversations'],
      machineKey: MACHINE_KEY,
      environmentId: 'env-desk',
      access: 'operator',
    });
    expect(await call(token, MACHINE_KEY)).toEqual({
      status: 403,
      body: { error: 'a linked machine cannot use the fleet routes here' },
    });
  });
});
