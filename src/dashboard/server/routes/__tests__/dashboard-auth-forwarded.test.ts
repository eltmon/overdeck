/**
 * PAN-4299: a Docker-bridge peer (how Traefik reaches the host dashboard) is
 * trusted only when its rightmost X-Forwarded-For entry is local. Covers the
 * session mint gate and the remote request gate. `node:os` is mocked so the
 * host has a fixed br-* bridge; kept apart from dashboard-auth.test.ts so that
 * suite keeps the real os module.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const ipv4 = (address: string, netmask: string): NetworkInterfaceInfo =>
    ({ address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: null });
  const networkInterfaces = () => ({
    lo: [ipv4('127.0.0.1', '255.0.0.0')],
    eth0: [ipv4('192.168.1.10', '255.255.255.0')],
    'br-849257118e6e': [ipv4('172.18.0.1', '255.255.0.0')],
  });
  return { ...actual, default: { ...actual, networkInterfaces }, networkInterfaces };
});

import { tmpdir } from 'node:os';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../../lib/remote-access/config.js';
import { _resetDashboardSessionTokenForTests, rejectUnauthorizedDashboardSessionMintRequest } from '../dashboard-auth.js';
import { remoteRequestGateLayer } from '../../remote-request-gate.js';

const BRIDGE_PEER = '172.18.0.2';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

function makeRequest(method: string, path: string, opts: { peer?: string; headers?: Record<string, string> } = {}) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers: opts.headers }))
    .modify({ remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none() });
}

const app = Layer.mergeAll(remoteRequestGateLayer, HttpRouter.add('*', '*', Effect.succeed(HttpServerResponse.text('reached'))));

async function gateStatus(path: string, opts: { peer?: string; headers?: Record<string, string> }) {
  const request = makeRequest('GET', path, opts);
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  return (response as { status: number }).status;
}

function mint(peer: string, headers: Record<string, string> = {}) {
  return rejectUnauthorizedDashboardSessionMintRequest(makeRequest('POST', '/api/dashboard/session', { peer, headers }));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4299-forwarded-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'forwarded-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  invalidateRemoteAccessConfig();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('session mint from a Docker-bridge peer — PAN-4299', () => {
  it('401s when the forwarded client is a LAN address', () => {
    const rejected = mint(BRIDGE_PEER, { 'x-forwarded-for': '192.168.1.50' });
    expect(rejected).not.toBeNull();
    expect((rejected as unknown as { status: number }).status).toBe(401);
  });

  it('401s a spoofed loopback prefix in front of a LAN client', () => {
    expect(mint(BRIDGE_PEER, { 'x-forwarded-for': '127.0.0.1, 192.168.1.50' })).not.toBeNull();
  });

  it('mints when the forwarded client is the bridge gateway or the header is absent', () => {
    expect(mint(BRIDGE_PEER, { 'x-forwarded-for': '172.18.0.1' })).toBeNull();
    expect(mint(BRIDGE_PEER)).toBeNull();
  });

  it('leaves a literal 127.0.0.1 peer unchanged whatever X-Forwarded-For says', async () => {
    await writeFile(join(home, 'config.yaml'), 'dashboard:\n  require_token_mint: false\n', 'utf8');
    invalidateRemoteAccessConfig();
    expect(mint('127.0.0.1', { 'x-forwarded-for': '192.168.1.50' })).toBeNull();
    expect(mint('127.0.0.1')).toBeNull();
  });
});

describe('remote request gate from a Docker-bridge peer — PAN-4299', () => {
  it('401s an uncredentialed request whose forwarded client is a LAN address', async () => {
    expect(await gateStatus('/api/issues', { peer: BRIDGE_PEER, headers: { 'x-forwarded-for': '192.168.1.50' } })).toBe(401);
  });

  it('passes an uncredentialed request whose forwarded client is the bridge gateway', async () => {
    expect(await gateStatus('/api/issues', { peer: BRIDGE_PEER, headers: { 'x-forwarded-for': '172.18.0.1' } })).toBe(200);
  });
});
