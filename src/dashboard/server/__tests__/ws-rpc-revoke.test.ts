/**
 * PAN-4645 WI-7: revoking the credential behind an open /ws/rpc socket closes
 * it with code 4401, in process and when another process wrote the revoke
 * (seen at the next refresh tick), and revoking a machine record destroys that
 * peer's secure channels.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context, Effect, Exit, Layer, Schema, Scope } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/unstable/http';
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { WebSocket as WsClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  ACCESS_TOKEN_REFRESH_MS,
  createAccessToken,
  MACHINE_TOKEN_SCOPES,
  PHONE_TOKEN_SCOPES,
  revokeAccessToken,
  startAccessTokenRefresh,
  stopAccessTokenRefresh,
} from '../../../lib/access-tokens.js';
import { openChannel } from '../../../lib/anywhere/channel/open.js';
import type { MachineKeyPair } from '../../../lib/anywhere/machine-key.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { _resetChannelListenerForTests, installChannelListener, liveChannelCount } from '../channel-listener.js';
import { revocableCredentialId } from '../device-connections.js';
import { jsonResponse } from '../http-helpers.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { authorizeRpcUpgrade, registerRevocationClosers, websocketOfRawSocket, withRpcRevocation } from '../ws-rpc-auth.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const PingRpc = Rpc.make('test.ping', { payload: Schema.Struct({}), success: Schema.String });
const TestGroup = RpcGroup.make(PingRpc);
const TestHandlers = TestGroup.toLayer({ 'test.ping': () => Effect.succeed('pong') });

const rpcRouteLayer = Layer.unwrap(Effect.gen(function* () {
  const context = yield* Layer.build(Layer.mergeAll(TestHandlers, RpcSerialization.layerJson));
  const rpcHttp = yield* RpcServer.toHttpEffectWebsocket(TestGroup).pipe(Effect.provide(context));
  return HttpRouter.add('GET', '/ws/rpc', Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = authorizeRpcUpgrade(request);
    if (!auth.ok) return jsonResponse({ error: auth.message }, { status: auth.status });
    return yield* withRpcRevocation(rpcHttp, auth.credential, request);
  }));
}));

const originalHome = process.env.OVERDECK_HOME;
let home: string;
let scope: Scope.Closeable;
let port: number;
let unregisterClosers: () => void;
const cleanups: Array<() => Promise<void> | void> = [];

async function bootRpcServer(): Promise<number> {
  scope = await Effect.runPromise(Scope.make());
  const serverLayer = (await import('@effect/platform-node/NodeHttpServer')).layer(() => createServer(), { host: '127.0.0.1', port: 0 });
  const app = HttpRouter.serve(rpcRouteLayer, { disableLogger: true }).pipe(Layer.provideMerge(serverLayer));
  const context = await Effect.runPromise(Layer.build(app).pipe(Effect.provideService(Scope.Scope, scope)));
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag !== 'TcpAddress') throw new Error('expected a TCP address');
  return address.port;
}

function connect(token: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws/rpc`, { headers: { authorization: `Bearer ${token}` } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
}

function closed(ws: WsClient): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-rpc-revoke-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'revoke-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  unregisterClosers = registerRevocationClosers();
  port = await bootRpcServer();
});

afterEach(async () => {
  vi.useRealTimers();
  stopAccessTokenRefresh();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  unregisterClosers();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('/ws/rpc revocation (PAN-4645 WI-7)', () => {
  it('ac1: revoking the token in process closes the open socket with 4401', async () => {
    const { token, record } = await createAccessToken({ name: 'events', kind: 'token', scopes: ['read:events'] });
    const ws = await connect(token);
    cleanups.push(() => ws.terminate());
    const closing = closed(ws);

    await revokeAccessToken(record.id);
    expect(await closing).toEqual({ code: 4401, reason: 'device revoked' });
  });

  it('ac2: a revoke written by another process closes the socket after one refresh tick', async () => {
    const { token, record } = await createAccessToken({ name: 'events', kind: 'token', scopes: ['read:events'] });
    const ws = await connect(token);
    cleanups.push(() => ws.terminate());
    const closing = closed(ws);

    // The upgrade's token check queued a lastUsedAt write; let it land so the
    // "other process" rewrite below is not overwritten by it.
    await _settleAccessTokenWritesForTests();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    startAccessTokenRefresh();
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as { tokens: Array<Record<string, unknown>> };
    file.tokens = file.tokens.map((entry) => (entry.id === record.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
    await writeFile(path, JSON.stringify(file), 'utf8');

    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_REFRESH_MS);
    expect(await closing).toEqual({ code: 4401, reason: 'device revoked' });
  });

  it('ac3: revoking a machine record destroys every channel bound to its key', async () => {
    const serverKey = dh.generateKeyPair();
    const peerKey = dh.generateKeyPair();
    const peerHex = peerKey.publicKey.toString('hex');
    const { record } = await createAccessToken({
      name: 'machine:peer', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
      machineKey: peerHex, environmentId: 'env-peer', access: 'operator',
    });
    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === peerHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const channelPort = (http.address() as { port: number }).port;

    const channel = await openChannel(`tcp://127.0.0.1:${channelPort}`, { mode: 'link', localKey: peerKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    const channelClosed = new Promise<void>((resolve) => channel.once('close', resolve));

    await revokeAccessToken(record.id);
    await channelClosed;
    expect(liveChannelCount()).toBe(0);
  });

  it('ac4: revoking a phone record destroys every channel bound to its key (PAN-4835 WI-4)', async () => {
    const serverKey = dh.generateKeyPair();
    const phoneKey = dh.generateKeyPair();
    const phoneHex = phoneKey.publicKey.toString('hex');
    expect(revocableCredentialId({ kind: 'phone', tokenId: 'phone-1', clientId: 'c1', phoneKey: phoneHex, scopes: [...PHONE_TOKEN_SCOPES] })).toBe('phone-1');
    const { record } = await createAccessToken({
      name: 'phone:iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: phoneHex, clientId: '11111111-1111-4111-8111-111111111111',
    });
    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === phoneHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const channelPort = (http.address() as { port: number }).port;

    const channel = await openChannel(`tcp://127.0.0.1:${channelPort}`, { mode: 'link', localKey: phoneKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    const channelClosed = new Promise<void>((resolve) => channel.once('close', resolve));

    await revokeAccessToken(record.id);
    await channelClosed;
    expect(liveChannelCount()).toBe(0);
  });

  it('ac5: a phone-revoke written by another process closes its channel after one refresh tick', async () => {
    const serverKey = dh.generateKeyPair();
    const phoneKey = dh.generateKeyPair();
    const phoneHex = phoneKey.publicKey.toString('hex');
    const { record } = await createAccessToken({
      name: 'phone:iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: phoneHex, clientId: '11111111-1111-4111-8111-111111111111',
    });
    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === phoneHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const channelPort = (http.address() as { port: number }).port;

    const channel = await openChannel(`tcp://127.0.0.1:${channelPort}`, { mode: 'link', localKey: phoneKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    const channelClosed = new Promise<void>((resolve) => channel.once('close', resolve));

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    startAccessTokenRefresh();
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as { tokens: Array<Record<string, unknown>> };
    file.tokens = file.tokens.map((entry) => (entry.id === record.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
    await writeFile(path, JSON.stringify(file), 'utf8');

    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_REFRESH_MS);
    await channelClosed;
    expect(liveChannelCount()).toBe(0);
  });

  it('interrupts the RPC handler at revocation even when the client never answers the close frame', async () => {
    const { withRpcRevocation } = await import('../ws-rpc-auth.js');
    const { closeDeviceConnections } = await import('../device-connections.js');
    const credential = { kind: 'device', deviceId: 'dev-silent', scopes: ['admin'] } as const;
    const request = HttpServerRequest.fromWeb(new Request('http://dashboard.test/ws/rpc'));
    // A handler that would run forever stands in for an RPC stream whose client ignores the close frame.
    const outcome = Effect.runPromise(withRpcRevocation(Effect.never, credential as never, request)).then((response) => response.status);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closeDeviceConnections('dev-silent')).toBe(1);
    const settled = await Promise.race([outcome, new Promise<string>((resolve) => setTimeout(() => resolve('still running'), 1500))]);
    expect(settled).toBe(204);
  });

  it('finds the ws instance on an upgraded socket and nothing on a plain object', () => {
    const fake = { [Symbol('websocket')]: { close: () => undefined } };
    expect(websocketOfRawSocket(fake)).not.toBeNull();
    expect(websocketOfRawSocket({ [Symbol('other')]: {} })).toBeNull();
    expect(websocketOfRawSocket(null)).toBeNull();
  });
});
