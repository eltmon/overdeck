/**
 * PAN-3331 review cycle 2: DELETE /api/terminals/:name is idempotent.
 *
 * tmux `kill-session` errors on a session that is already gone, so a client
 * holding a remembered session name — the workspace band does exactly that —
 * could never stop or restart a run whose process had already exited.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  sessionExists: vi.fn(),
  getDefaultCwd: vi.fn(),
  validateOrigin: vi.fn(),
  rejectUnauthorizedDashboardRequest: vi.fn(),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  createSession: routeMocks.createSession,
  killSession: routeMocks.killSession,
  sessionExists: routeMocks.sessionExists,
}));

vi.mock('../../../src/lib/default-cwd.js', () => ({
  getDefaultCwd: routeMocks.getDefaultCwd,
}));

vi.mock('../../../src/dashboard/server/routes/origin-validation.js', () => ({
  validateOrigin: routeMocks.validateOrigin,
}));

vi.mock('../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnauthorizedDashboardRequest: routeMocks.rejectUnauthorizedDashboardRequest,
}));

import { terminalsRouteLayer } from '../../../src/dashboard/server/routes/terminals.js';

async function deleteTerminal(name: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/terminals/${name}`, { method: 'DELETE' }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(terminalsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.validateOrigin.mockReturnValue({ ok: true });
  routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(null);
  routeMocks.killSession.mockReturnValue(Effect.succeed(undefined));
  routeMocks.sessionExists.mockReturnValue(Effect.succeed(true));
});

describe('DELETE /api/terminals/:name', () => {
  it('kills a live session', async () => {
    const response = await deleteTerminal('ws-run-abc12345');

    expect(response.status).toBe(200);
    expect(routeMocks.killSession).toHaveBeenCalledWith('ws-run-abc12345');
  });

  it('reports success without killing when the session already exited', async () => {
    routeMocks.sessionExists.mockReturnValue(Effect.succeed(false));

    const response = await deleteTerminal('ws-run-abc12345');

    expect(response.status).toBe(200);
    expect(response.body.alreadyStopped).toBe(true);
    expect(routeMocks.killSession).not.toHaveBeenCalled();
  });

  it('still fails when the kill itself fails', async () => {
    routeMocks.killSession.mockReturnValue(Effect.fail(new Error('tmux server unreachable')));

    const response = await deleteTerminal('ws-run-abc12345');

    expect(response.status).toBe(500);
  });

  it('rejects an unauthorized request before touching tmux', async () => {
    const { jsonResponse } = await import('../../../src/dashboard/server/http-helpers.js');
    routeMocks.rejectUnauthorizedDashboardRequest.mockReturnValue(jsonResponse({ error: 'unauthorized' }, { status: 401 }));

    const response = await deleteTerminal('ws-run-abc12345');

    expect(response.status).toBe(401);
    expect(routeMocks.sessionExists).not.toHaveBeenCalled();
    expect(routeMocks.killSession).not.toHaveBeenCalled();
  });
});
