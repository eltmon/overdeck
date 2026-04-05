/**
 * Effect pattern tests (PAN-470)
 *
 * Verifies that the refactored route patterns work correctly:
 * - Effect.promise wrapping async FS operations
 * - EventStoreService.append via yield* (not runSync)
 * - httpHandler propagates errors from async routes
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { httpHandler } from '../http-handler.js';
import { EventStoreService } from '../../services/domain-services.js';
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
