/**
 * PAN-5447 IC-2: interrupting the request fiber (what NodeHttpServer does when
 * the client disconnects) must abort the signal the palette search receives.
 */
import { Effect, Fiber } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ signal: undefined as AbortSignal | undefined }));

vi.mock('../dashboard-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-auth.js')>()),
  rejectUnauthorizedDashboardRequest: () => null,
}));
vi.mock('../origin-validation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../origin-validation.js')>()),
  validateOrigin: () => ({ ok: true }),
}));
vi.mock('../../../../lib/projects.js', () => ({ listProjectsSync: vi.fn(() => []) }));
vi.mock('../../../../lib/memory/fts-db.js', () => ({ runMemoryFtsStatement: vi.fn(async () => []) }));
vi.mock('../../../../lib/overdeck/conversation-title-search.js', () => ({ searchConversationTitles: vi.fn(() => []) }));
vi.mock('../../services/conversation-search-service.js', () => ({
  searchConversationChunks: vi.fn((input: { signal?: AbortSignal }) => {
    captured.signal = input.signal;
    return new Promise(() => undefined);
  }),
}));

import { searchConversationChunks } from '../../services/conversation-search-service.js';
import { paletteRouteLayer } from '../palette.js';

describe('GET /api/palette/search request signal (PAN-5447)', () => {
  it('aborts the signal passed to searchConversationChunks when the request fiber is interrupted', async () => {
    const req = HttpServerRequest.fromWeb(new Request('http://localhost/api/palette/search?q=needle'));
    const fiber = Effect.runFork(
      Effect.scoped(Effect.flatMap(
        HttpRouter.toHttpEffect(paletteRouteLayer),
        (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      )),
    );

    await vi.waitFor(() => expect(searchConversationChunks).toHaveBeenCalled());
    expect(captured.signal).toBeInstanceOf(AbortSignal);
    expect(captured.signal?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(captured.signal?.aborted).toBe(true);
  });
});
