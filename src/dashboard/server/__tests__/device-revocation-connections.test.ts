/**
 * PAN-3762 W2.5: revoking a device closes its live connections. A WebSocket
 * tracked for device A closes with 4401 when A is revoked, B's stays open, an
 * SSE stream opened by A ends while B's keeps flowing, and closed connections
 * leave no registry entries.
 */
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Fiber, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const {
  _deviceConnectionCountForTests,
  closeDeviceConnections,
  endStreamOnDeviceRevocation,
} = await import('../device-connections.js');
const { trackDeviceSocket } = await import('../ws-auth.js');
const { pairingRouteLayer } = await import('../routes/pairing.js');

const INTERNAL_TOKEN = 'revocation-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

class FakeSocket extends EventEmitter {
  closedWith: { code?: number; reason?: string } | null = null;
  close(code?: number, reason?: string): void {
    if (this.closedWith) return;
    this.closedWith = { code, reason };
    this.emit('close');
  }
}

async function revokeThroughRoute(id: string): Promise<number> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/devices/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN },
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pairingRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  return (response as { status: number }).status;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-3762-revocation-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('revocation closes live device connections (PAN-3762)', () => {
  it('closes device A sockets with 4401 on DELETE /api/devices/:id and leaves device B open', async () => {
    const a = await createAccessToken({ name: 'a', scopes: ['admin'], kind: 'device' });
    const b = await createAccessToken({ name: 'b', scopes: ['admin'], kind: 'device' });
    const wsA = new FakeSocket();
    const wsB = new FakeSocket();
    trackDeviceSocket({ kind: 'device', deviceId: a.record.id }, wsA);
    trackDeviceSocket({ kind: 'device', deviceId: b.record.id }, wsB);

    expect(await revokeThroughRoute(a.record.id)).toBe(200);
    expect(wsA.closedWith).toEqual({ code: 4401, reason: 'device revoked' });
    expect(wsB.closedWith).toBeNull();
    expect(_deviceConnectionCountForTests(a.record.id)).toBe(0);
    expect(_deviceConnectionCountForTests(b.record.id)).toBe(1);

    wsB.close(1000, 'bye');
    expect(_deviceConnectionCountForTests()).toBe(0);
  });

  it('leaves root-session and internal-token sockets open when a device is revoked', async () => {
    const device = await createAccessToken({ name: 'd', scopes: ['admin'], kind: 'device' });
    const rootWs = new FakeSocket();
    const internalWs = new FakeSocket();
    const deviceWs = new FakeSocket();
    trackDeviceSocket({ kind: 'root-session' }, rootWs);
    trackDeviceSocket({ kind: 'internal-token' }, internalWs);
    trackDeviceSocket({ kind: 'device', deviceId: device.record.id }, deviceWs);
    expect(_deviceConnectionCountForTests()).toBe(1);

    expect(await revokeThroughRoute(device.record.id)).toBe(200);
    expect(deviceWs.closedWith?.code).toBe(4401);
    expect(rootWs.closedWith).toBeNull();
    expect(internalWs.closedWith).toBeNull();
  });

  it('ends the SSE stream of the revoked device only', async () => {
    const streamA = endStreamOnDeviceRevocation(Stream.never, { kind: 'device', deviceId: 'device-a' });
    const streamB = endStreamOnDeviceRevocation(Stream.never, { kind: 'device', deviceId: 'device-b' });
    const fiberA = Effect.runFork(Stream.runDrain(streamA));
    const fiberB = Effect.runFork(Stream.runDrain(streamB));
    await vi.waitFor(() => expect(_deviceConnectionCountForTests()).toBe(2));

    expect(closeDeviceConnections('device-a')).toBe(1);
    await Effect.runPromise(Fiber.join(fiberA));
    expect(_deviceConnectionCountForTests('device-a')).toBe(0);
    expect(_deviceConnectionCountForTests('device-b')).toBe(1);

    await Effect.runPromise(Fiber.interrupt(fiberB));
    expect(_deviceConnectionCountForTests()).toBe(0);
  });

  it('returns a stream unchanged for a non-device credential', () => {
    const stream = Stream.make(1, 2, 3);
    expect(endStreamOnDeviceRevocation(stream, { kind: 'root-session' })).toBe(stream);
    expect(endStreamOnDeviceRevocation(stream, null)).toBe(stream);
  });
});
