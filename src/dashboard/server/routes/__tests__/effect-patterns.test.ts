/**
 * Effect pattern tests (PAN-470)
 *
 * Verifies that the refactored route patterns work correctly:
 * - Effect.promise wrapping async FS operations
 * - EventStoreService.append via yield* (not runSync)
 * - httpHandler propagates errors from async routes
 * - EventStoreService Live layer end-to-end (append + readFrom)
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpHandler } from '../http-handler.js';
import { EventStoreService, EventStoreServiceLive } from '../../services/domain-services.js';
import { ReadModelServiceLive } from '../../read-model.js';
import { jsonResponse } from '../../http-helpers.js';

/** Run a route effect and return the response status and parsed JSON body. */
async function runRoute(
  effect: Effect.Effect<typeof HttpServerResponse.Type, unknown, never>
): Promise<{ status: number; body: unknown }> {
  const response = await Effect.runPromise(httpHandler(effect));
  const body = response.body as { body: Uint8Array } | null;
  const text = body?.body ? new TextDecoder().decode(body.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('Effect.promise async FS pattern', () => {
  it('returns 200 when async operation succeeds', async () => {
    const effect = httpHandler(
      Effect.promise(async () => {
        // Simulate async FS read
        const data = await Promise.resolve({ value: 42 });
        return jsonResponse(data);
      })
    );
    const { status, body } = await runRoute(effect);
    expect(status).toBe(200);
    expect((body as { value: number }).value).toBe(42);
  });

  it('maps async rejection to 500 via httpHandler catchCause', async () => {
    const effect = httpHandler(
      Effect.promise(async () => {
        throw new Error('async FS failure');
      }) as Effect.Effect<typeof HttpServerResponse.Type, never, never>
    );
    const { status, body } = await runRoute(effect);
    expect(status).toBe(500);
    expect((body as { error: string }).error).toContain('async FS failure');
  });

  it('inline try/catch returns error response without failing Effect', async () => {
    const effect = httpHandler(
      Effect.promise(async () => {
        try {
          throw new Error('handled error');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return jsonResponse({ error: msg }, { status: 500 });
        }
      })
    );
    const { status, body } = await runRoute(effect);
    expect(status).toBe(500);
    expect((body as { error: string }).error).toBe('handled error');
  });
});

describe('EventStoreServiceLive + ReadModelServiceLive end-to-end', () => {
  it('appends and reads back an event using Live layers with real SQLite', async () => {
    // ReadModelServiceLive bootstrap can take >10s under parallel test load
    // (it initializes 100+ agents from SQLite). Give it room to finish.
    const tmpDir = mkdtempSync(join(tmpdir(), 'pan-470-test-'));
    const originalHome = process.env['PANOPTICON_HOME'];
    process.env['PANOPTICON_HOME'] = tmpDir;

    try {
      // Use vi.resetModules so initEventStore picks up PANOPTICON_HOME
      vi.resetModules();
      const { EventStoreService: ESS, EventStoreServiceLive: ESL } = await import(
        '../../services/domain-services.js'
      );
      const { ReadModelServiceLive: RMSL } = await import('../../read-model.js');

      const program = Effect.gen(function* () {
        const store = yield* ESS;
        yield* store.append({ type: 'test.live', timestamp: new Date().toISOString(), payload: { x: 1 } });
        const events = yield* store.readFrom(0);
        return events;
      });

      const layer = ESL.pipe(Layer.provide(RMSL));
      const events = await Effect.runPromise(Effect.provide(program, layer));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.type === 'test.live')).toBe(true);
    } finally {
      process.env['PANOPTICON_HOME'] = originalHome;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('EventStoreService.append via yield*', () => {
  it('appends events via yield* without runSync', async () => {
    const appended: unknown[] = [];
    const mockEventStore = {
      append: (event: Record<string, unknown>) =>
        Effect.sync(() => {
          appended.push(event);
          return appended.length;
        }),
    };

    const testLayer = Layer.succeed(EventStoreService, mockEventStore as any);

    const routeEffect = Effect.gen(function* () {
      const eventStore = yield* EventStoreService;
      yield* eventStore.append({ type: 'test.event', timestamp: new Date().toISOString(), payload: {} });
      return jsonResponse({ ok: true });
    });

    const response = await Effect.runPromise(
      Effect.provide(httpHandler(routeEffect), testLayer)
    );
    const body = response.body as { body: Uint8Array } | null;
    const text = body?.body ? new TextDecoder().decode(body.body) : '{}';

    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(appended).toHaveLength(1);
    expect((appended[0] as { type: string }).type).toBe('test.event');
  });
});
