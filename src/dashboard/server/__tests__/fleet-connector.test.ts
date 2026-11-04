/**
 * PAN-4950 WI-10 (D-5): the fleet spawn routes admit a connector for this machine only. Handler
 * level with injected deps, then the route gate with a real connector record resolved inside a
 * (mocked) link channel.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ channelOfRequest: vi.fn() }));
vi.mock('../channel-peer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-peer.js')>()),
  channelOfRequest: mocks.channelOfRequest,
}));
vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');
const { jsonResponse } = await import('../http-helpers.js');
const {
  fleetCaller,
  fleetWorkRouteLayer,
  handleFleetConversation,
  handleFleetIssueStart,
  handleFleetWorker,
} = await import('../routes/fleet-work.js');
const { readJsonResponse } = await import('../routes/machines-work.js');
type FleetCaller = import('../routes/fleet-work.js').FleetCaller;
type FleetWorkerDeps = import('../routes/fleet-work.js').FleetWorkerDeps;
type FleetTarget = import('../services/fleet-target.js').FleetTarget;
type MachineLink = import('../../../lib/anywhere/link-store.js').MachineLink;

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const SELF: FleetTarget = { ok: true, self: true, environmentId: 'env-laptop', label: 'laptop', reason: null };
const REMOTE: FleetTarget = { ok: true, self: false, link: DESK, environmentId: 'env-desk', label: 'desk', reason: null };
const CONNECTOR: FleetCaller = { actor: 'operator', ceiling: ['read:state', 'operate'], mayCreateFly: false, viaToken: true, localOnly: true };
const LOCAL_ONLY = {
  code: 'connector-local-only',
  error: 'An Overdeck connector reaches only the machine it paired with; run a second connector for desk.',
};

function deps(target: FleetTarget): FleetWorkerDeps {
  return {
    resolveTarget: vi.fn(async () => target),
    projectOrigin: () => null,
    thisLabel: async () => 'laptop',
    createLocal: vi.fn(async () => ({ status: 201, body: { name: 'conv-local' } })),
    fetchPeer: vi.fn(async () => ({ status: 201, json: { name: 'conv-9', id: 'agent-pan-9-worker-4' } })),
    refreshLinked: vi.fn(async () => undefined),
    issueOrigin: async () => ({ gitOrigin: 'github.com/eltmon/overdeck', projectKey: 'overdeck' }),
    startLocal: vi.fn(async () => ({ id: 'agent-pan-9-worker-1' })),
    allocate: vi.fn(async () => 'agent-pan-9-worker-2'),
    writeStandIn: vi.fn(async () => undefined),
    dropStandIn: vi.fn(async () => undefined),
    follow: vi.fn(),
    now: () => new Date('2026-11-04T12:00:00.000Z'),
  };
}

describe('fleetCaller (PAN-4950 D-5)', () => {
  it('maps a connector to the operator, its scopes, no Fly and this machine only', () => {
    const caller = fleetCaller({ kind: 'connector', tokenId: 't', clientId: 'c', connectorKey: 'k', scopes: ['read:state', 'operate'] }, undefined);
    expect(caller).toEqual({ actor: 'operator', ceiling: ['read:state', 'operate'], mayCreateFly: false, viaToken: true, localOnly: true });
  });

  it('leaves a token caller without localOnly', () => {
    expect(fleetCaller({ kind: 'token', tokenId: 't', scopes: ['operate'] }, undefined)?.localOnly).toBeUndefined();
  });
});

describe('fleet spawn handlers with a connector caller', () => {
  it('creates a conversation on this machine', async () => {
    const d = deps(SELF);
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi' }, CONNECTOR, d));
    expect(answer.status).toBe(201);
    expect(d.createLocal).toHaveBeenCalledWith({ message: 'hi' });
  });

  it('refuses a conversation on another machine before any remote call', async () => {
    const d = deps(REMOTE);
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi', machine: 'desk' }, CONNECTOR, d));
    expect(answer).toEqual({ status: 403, body: LOCAL_ONLY });
    expect(d.fetchPeer).not.toHaveBeenCalled();
    expect(d.createLocal).not.toHaveBeenCalled();
  });

  it('refuses a worker on another machine before allocating an id', async () => {
    const d = deps(REMOTE);
    const answer = readJsonResponse(await handleFleetWorker({ machine: 'desk', issueId: 'PAN-9', prompt: 'Run it.' }, CONNECTOR, d));
    expect(answer).toEqual({ status: 403, body: LOCAL_ONLY });
    expect(d.allocate).not.toHaveBeenCalled();
    expect(d.fetchPeer).not.toHaveBeenCalled();
    expect(d.writeStandIn).not.toHaveBeenCalled();
  });

  it('starts an issue on this machine and refuses another machine', async () => {
    const spawn = vi.fn(() => Effect.succeed(jsonResponse({ ok: true })));
    const local = readJsonResponse(await Effect.runPromise(handleFleetIssueStart('PAN-9', {}, CONNECTOR, { ...deps(SELF), spawn })));
    expect(local.status).toBe(200);
    expect(spawn).toHaveBeenCalledWith({ body: { issueId: 'PAN-9' }, internalRequest: false });

    const remoteDeps = { ...deps(REMOTE), spawn: vi.fn(() => Effect.succeed(jsonResponse({}))) };
    const remote = readJsonResponse(await Effect.runPromise(handleFleetIssueStart('PAN-9', { machine: 'desk' }, CONNECTOR, remoteDeps)));
    expect(remote).toEqual({ status: 403, body: LOCAL_ONLY });
    expect(remoteDeps.fetchPeer).not.toHaveBeenCalled();
    expect(remoteDeps.spawn).not.toHaveBeenCalled();
  });

  it('answers connector-local-only for a resolution failure only another machine produces', async () => {
    const offline: FleetTarget = { ok: false, status: 503, body: { code: 'machine-offline', error: 'desk is offline' } };
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi', machine: 'desk' }, CONNECTOR, deps(offline)));
    expect(answer).toEqual({
      status: 403,
      body: { code: 'connector-local-only', error: 'An Overdeck connector reaches only the machine it paired with; run a second connector for that machine.' },
    });
    const fly: FleetTarget = { ok: false, status: 400, body: { code: 'fly-unavailable', error: 'conversations only' } };
    const worker = readJsonResponse(await handleFleetWorker({ machine: 'fly', issueId: 'PAN-9', prompt: 'Run it.' }, CONNECTOR, deps(fly)));
    expect(worker.body).toMatchObject({ code: 'connector-local-only' });
  });

  it('keeps an unknown-machine answer for a connector', async () => {
    const unknown: FleetTarget = { ok: false, status: 404, body: { code: 'unknown-machine', error: 'No linked machine is called nope' } };
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi', machine: 'nope' }, CONNECTOR, deps(unknown)));
    expect(answer).toEqual({ status: 404, body: { code: 'unknown-machine', error: 'No linked machine is called nope' } });
  });

  it('still lets a token caller reach another machine', async () => {
    const d = deps(REMOTE);
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi', machine: 'desk' }, { actor: 'operator', viaToken: true }, d));
    expect(answer.status).toBe(201);
    expect(d.fetchPeer).toHaveBeenCalledTimes(1);
  });
});

describe('fleet spawn gate (route level)', () => {
  const CONNECTOR_KEY = 'c1'.repeat(32);
  const MACHINE_KEY = 'd2'.repeat(32);
  const originalHome = process.env.OVERDECK_HOME;
  const originalInternalToken = process.env.OVERDECK_INTERNAL_TOKEN;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pan-4950-fleet-connector-'));
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetAccessTokensForTests();
  });

  afterEach(async () => {
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalInternalToken === undefined) delete process.env.OVERDECK_INTERNAL_TOKEN;
    else process.env.OVERDECK_INTERNAL_TOKEN = originalInternalToken;
    _resetInternalTokenCacheForTests();
    await rm(home, { recursive: true, force: true });
  });

  async function call(path: string, token: string, remoteKeyHex: string): Promise<{ status: number; body: Record<string, unknown> }> {
    mocks.channelOfRequest.mockReturnValue({ mode: 'link', remoteKeyHex, pairingId: null });
    const req = HttpServerRequest.fromWeb(
      new Request(`http://link.invalid${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{}',
      }),
    );
    const response = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(HttpRouter.toHttpEffect(fleetWorkRouteLayer), (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req))),
    );
    const responseBody = response.body as { body?: Uint8Array } | null;
    const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  }

  it('lets a connector through to the conversation handler', async () => {
    const { token } = await createAccessToken({
      name: 'bot:desk',
      kind: 'connector',
      scopes: ['read:state', 'operate'],
      connectorKey: CONNECTOR_KEY,
      clientId: '33333333-3333-4333-8333-333333333333',
    });
    expect(await call('/api/fleet/conversations', token, CONNECTOR_KEY)).toEqual({ status: 400, body: { error: 'message must be a string' } });
  });

  it('still refuses a linked machine on the spawn routes', async () => {
    const { token } = await createAccessToken({
      name: 'machine:desk',
      kind: 'machine',
      scopes: ['read:state', 'operate'],
      machineKey: MACHINE_KEY,
      environmentId: 'env-desk',
      access: 'operator',
    });
    expect(await call('/api/fleet/conversations', token, MACHINE_KEY)).toEqual({
      status: 403,
      body: { error: 'a linked machine cannot use the fleet routes here' },
    });
  });

  it('still refuses a connector on placement', async () => {
    const { token } = await createAccessToken({
      name: 'bot:desk',
      kind: 'connector',
      scopes: ['read:state', 'operate'],
      connectorKey: CONNECTOR_KEY,
      clientId: '33333333-3333-4333-8333-333333333333',
    });
    expect(await call('/api/fleet/placement', token, CONNECTOR_KEY)).toEqual({
      status: 403,
      body: { error: 'a linked machine cannot use the fleet routes here' },
    });
  });
});
