/**
 * Tests for httpHandler — typed error-to-HTTP mapping wrapper (PAN-470)
 */
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { HttpServerResponse as HttpServerResponseModule } from 'effect/unstable/http';
import { httpHandler } from '../http-handler.js';

type HttpServerResponse = HttpServerResponseModule.HttpServerResponse;
import {
  AgentAlreadyRunning,
  AgentStartError,
  BeadsNotInitialized,
  IssueNotFound,
  PlanEmpty,
  RateLimited,
  TrackerApiError,
  TrackerNotConfigured,
  WorkspaceCreateError,
  WorkspaceNotFound,
} from '../../services/typed-errors.js';

/** Run a route effect and return the response status and parsed JSON body. */
async function runRoute(
  effect: Effect.Effect<HttpServerResponse, unknown, never>
): Promise<{ status: number; body: unknown }> {
  const response = await Effect.runPromise(httpHandler(effect));
  const body = response.body as { body: Uint8Array } | null;
  const text = body?.body ? new TextDecoder().decode(body.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('httpHandler', () => {
  it('passes through successful responses unchanged', async () => {
    const effect = Effect.succeed(
      HttpServerResponseModule.text(JSON.stringify({ ok: true }), {
        status: 200,
        contentType: 'application/json',
      })
    );
    const { status } = await runRoute(effect);
    expect(status).toBe(200);
  });

  it('maps IssueNotFound to 404', async () => {
    const effect = Effect.fail(new IssueNotFound({ id: 'PAN-1' }));
    const { status, body } = await runRoute(effect as Effect.Effect<HttpServerResponse, IssueNotFound, never>);
    expect(status).toBe(404);
    expect((body as { error: string }).error).toContain('PAN-1');
  });

  it('maps WorkspaceNotFound to 404', async () => {
    const effect = Effect.fail(new WorkspaceNotFound({ id: 'PAN-2' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, WorkspaceNotFound, never>);
    expect(status).toBe(404);
  });

  it('maps TrackerNotConfigured to 503', async () => {
    const effect = Effect.fail(new TrackerNotConfigured({ tracker: 'linear' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, TrackerNotConfigured, never>);
    expect(status).toBe(503);
  });

  it('maps RateLimited to 429 with retryAfter', async () => {
    const effect = Effect.fail(new RateLimited({ retryAfter: 60 }));
    const { status, body } = await runRoute(effect as Effect.Effect<HttpServerResponse, RateLimited, never>);
    expect(status).toBe(429);
    expect((body as { retryAfter: number }).retryAfter).toBe(60);
  });

  it('maps AgentAlreadyRunning to 409', async () => {
    const effect = Effect.fail(new AgentAlreadyRunning({ id: 'PAN-3' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, AgentAlreadyRunning, never>);
    expect(status).toBe(409);
  });

  it('maps BeadsNotInitialized to 422', async () => {
    const effect = Effect.fail(new BeadsNotInitialized({ workspace: '/tmp/ws' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, BeadsNotInitialized, never>);
    expect(status).toBe(422);
  });

  it('maps PlanEmpty to 422', async () => {
    const effect = Effect.fail(new PlanEmpty({ id: 'PAN-4' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, PlanEmpty, never>);
    expect(status).toBe(422);
  });

  it('maps TrackerApiError to 502', async () => {
    const effect = Effect.fail(new TrackerApiError({ tracker: 'github', message: 'API down' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, TrackerApiError, never>);
    expect(status).toBe(502);
  });

  it('maps WorkspaceCreateError to 500', async () => {
    const effect = Effect.fail(new WorkspaceCreateError({ id: 'PAN-5', message: 'disk full' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, WorkspaceCreateError, never>);
    expect(status).toBe(500);
  });

  it('maps AgentStartError to 500', async () => {
    const effect = Effect.fail(new AgentStartError({ id: 'PAN-6', message: 'crash' }));
    const { status } = await runRoute(effect as Effect.Effect<HttpServerResponse, AgentStartError, never>);
    expect(status).toBe(500);
  });

  it('maps unknown errors to 500', async () => {
    const effect = Effect.die(new Error('unexpected'));
    const { status } = await runRoute(effect as unknown as Effect.Effect<HttpServerResponse, unknown, never>);
    expect(status).toBe(500);
  });
});
