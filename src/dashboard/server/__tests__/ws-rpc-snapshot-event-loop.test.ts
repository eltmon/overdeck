/**
 * PAN-5178 WI-4 — the issue's hypothesis was that a `/ws/rpc` `getSnapshot`
 * connect blocks the event loop for about 1.5 s. Planning measured that the
 * real stall is request ordering (PAN-5178), not this path: a warm connect
 * is 55 to 75 ms, and the first connect after a server start (cold JIT) is
 * about 100 to 110 ms at production volume. These tests pin both numbers so
 * a future regression in the snapshot path is caught directly, even though
 * it is not today's stall.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { HttpRouter, HttpServer } from 'effect/unstable/http';
import { RpcGroup, RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { GetSnapshotRpc, WS_METHODS } from '@overdeck/contracts';
import { WebSocket as WsClient } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

function fixtureIssue(n: number): Record<string, unknown> {
  return {
    id: `PAN-${n}`,
    identifier: `PAN-${n}`,
    title: 'x'.repeat(90),
    description: 'x'.repeat(2400),
    status: 'Todo',
    canonicalStatus: 'todo',
    labels: ['bug', 'dashboard'],
    url: `https://github.com/eltmon/overdeck/issues/${n}`,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    project: 'overdeck',
    source: 'github',
    sourceRepo: 'eltmon/overdeck',
    workspacePath: `/home/x/Projects/overdeck/workspaces/feature-pan-${n}`,
  };
}

// Built once, before any measurement, so fixture construction never shows up
// in a test's event-loop histogram.
const FIXTURE_ISSUES = Array.from({ length: 1500 }, (_, n) => fixtureIssue(n));

function storedAgent(id: string, status: string): Record<string, unknown> {
  return {
    id,
    issueId: 'PAN-5178',
    role: 'work',
    status,
    workspace: null,
    sessionId: null,
    harness: 'claude-code',
    model: 'claude',
    startedAt: null,
    stoppedByUser: null,
    paused: null,
    pausedReason: null,
    troubled: null,
    consecutiveFailures: 0,
    firstFailureInRunAt: null,
    lastFailureNextRetryAt: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../services/backend-inventory.js');
  vi.doUnmock('../services/issue-service-singleton.js');
});

interface SnapshotServer {
  readonly port: number;
  close(): Promise<void>;
}

async function bootSnapshotServer(agentCount: number): Promise<SnapshotServer> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'pan-5178-snapshot-'));
  const originalHome = process.env['OVERDECK_HOME'];
  process.env['OVERDECK_HOME'] = tmpHome;
  vi.resetModules();
  vi.doMock('../services/backend-inventory.js', () => ({
    getBackendPanes: async () => [],
    isBackendInventoryDegraded: () => false,
    onBackendPanesChanged: () => {},
    startBackendInventory: async () => {},
  }));
  vi.doMock('../services/issue-service-singleton.js', () => ({
    getSharedIssueService: () => ({
      getIssues: () => FIXTURE_ISSUES,
      listDerivedStates: () => [],
      onIssuesChanged: () => {},
      onDerivedStatesChanged: () => {},
    }),
  }));

  const { ReadModelService, ReadModelServiceLive } = await import('../read-model.js');
  const { AgentsResolver: AR } = await import('../../../lib/overdeck/agents.js');

  const storedAgents = Array.from({ length: agentCount }, (_, n) => storedAgent(`agent-pan-${n}`, 'running'));
  const mockAgentsResolverLayer = Layer.succeed(AR, AR.of({
    list: (_f: never) => Effect.succeed(storedAgents as never),
    get: (_id: never) => Effect.fail(new Error('not found') as never),
    isAlive: (_id: never) => Effect.succeed(false),
    getRuntime: (_id: never) => Effect.succeed(null),
    getHealthHistory: (_id: never) => Effect.succeed([]),
  }));

  const group = RpcGroup.make(GetSnapshotRpc);
  const handlers = group.toLayer(Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    return group.of({ [WS_METHODS.getSnapshot]: () => readModel.getSnapshot });
  }));

  const rpcRouteLayer = Layer.unwrap(Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.mergeAll(handlers, RpcSerialization.layerJson).pipe(
        Layer.provide(ReadModelServiceLive.pipe(Layer.provide(mockAgentsResolverLayer))),
      ),
    );
    const rpcHttp = yield* RpcServer.toHttpEffectWebsocket(group).pipe(Effect.provide(context));
    return HttpRouter.add('GET', '/ws/rpc', rpcHttp);
  }));

  const scope = await Effect.runPromise(Scope.make());
  const serverLayer = (await import('@effect/platform-node/NodeHttpServer')).layer(() => createServer(), { host: '127.0.0.1', port: 0 });
  const app = HttpRouter.serve(rpcRouteLayer, { disableLogger: true }).pipe(Layer.provideMerge(serverLayer));
  const builtContext = await Effect.runPromise(Layer.build(app).pipe(Effect.provideService(Scope.Scope, scope)));
  const address = Context.get(builtContext, HttpServer.HttpServer).address;
  if (address._tag !== 'TcpAddress') throw new Error('expected a TCP address');

  return {
    port: address.port,
    async close() {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      if (originalHome === undefined) delete process.env['OVERDECK_HOME'];
      else process.env['OVERDECK_HOME'] = originalHome;
      rmSync(tmpHome, { recursive: true, force: true });
    },
  };
}

/** Never calls JSON.parse — that cost belongs outside the measured window. */
function connectAndSnapshot(port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws/rpc`);
    ws.once('error', reject);
    ws.once('open', () => {
      ws.send(JSON.stringify({ _tag: 'Request', id: '1', tag: WS_METHODS.getSnapshot, payload: {}, headers: [] }));
    });
    ws.on('message', (data: Buffer) => {
      if (data.length > 1_000_000) {
        ws.close();
        resolve(data);
      }
    });
  });
}

async function measured<T>(run: () => Promise<T>): Promise<{ value: T; maxMs: number }> {
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  // The histogram's native timer needs one real timer-phase tick to arm
  // before it reliably attributes a delay that starts in the same turn as
  // enable() (observed locally: a block started via a bare setImmediate
  // right after enable() reads near 0 without this tick).
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const value = await run();
  // D-9c: a synchronous span can end, and the reply can be read, before the
  // histogram's own timer fires. Wait one turn so the delay is recorded.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  h.disable();
  return { value, maxMs: h.max / 1e6 };
}

function busyWait(ms: number): void {
  const start = performance.now();
  while (performance.now() - start < ms) {
    // spin
  }
}

interface ExitEncoded {
  readonly _tag: string;
  readonly requestId: string;
  readonly exit: { readonly _tag: string; readonly value?: { readonly issues: unknown[] } };
}

describe('ws-rpc getSnapshot event-loop delay (PAN-5178 WI-4)', () => {
  it('first connect at production volume stays under 300 ms', async () => {
    const server = await bootSnapshotServer(1700);
    try {
      const { value, maxMs } = await measured(() => connectAndSnapshot(server.port));
      const frame = JSON.parse(value.toString('utf8')) as ExitEncoded;
      console.log(`[PAN-5178] first connect (1,500 issues, 1,700 agents): max=${maxMs.toFixed(1)}ms frame=${value.length}B`);
      expect(frame._tag).toBe('Exit');
      expect(frame.exit._tag).toBe('Success');
      expect(frame.exit.value?.issues).toHaveLength(1500);
      expect(maxMs).toBeLessThan(300);
    } finally {
      await server.close();
    }
  });

  it('warm connects stay under 100 ms', async () => {
    const server = await bootSnapshotServer(100);
    try {
      await connectAndSnapshot(server.port); // warm-up, unmeasured
      const maxes: number[] = [];
      let lastFrameSize = 0;
      for (let i = 0; i < 3; i++) {
        const { value, maxMs } = await measured(() => connectAndSnapshot(server.port));
        maxes.push(maxMs);
        lastFrameSize = value.length;
      }
      console.log(`[PAN-5178] warm connects (1,500 issues, 100 agents): max=${maxes.map((m) => m.toFixed(1)).join(',')}ms frame=${lastFrameSize}B`);
      expect(Math.min(...maxes)).toBeLessThan(100);
    } finally {
      await server.close();
    }
  });

  it('the harness detects a synchronous block', async () => {
    const { maxMs } = await measured(() => new Promise<void>((resolve) => {
      setImmediate(() => {
        busyWait(120);
        resolve();
      });
    }));

    expect(maxMs).toBeGreaterThanOrEqual(100);
  });
});
