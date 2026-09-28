/**
 * PAN-4280 (D6, WI-5): POST /api/terminals accepts an optional single-line
 * `command`, run in the fresh shell with tmux `send-keys -l` then Enter.
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
  tmuxExecAsync: vi.fn(),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
  createSession: routeMocks.createSession,
  killSession: routeMocks.killSession,
  sessionExists: routeMocks.sessionExists,
  tmuxExecAsync: routeMocks.tmuxExecAsync,
  exactPaneTarget: (n: string) => `=${n}:`,
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

async function postTerminal(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(
    new Request('http://localhost/api/terminals', { method: 'POST', body: JSON.stringify(body) }),
  );
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
  routeMocks.getDefaultCwd.mockReturnValue('/home/user');
  routeMocks.createSession.mockReturnValue(Effect.succeed(undefined));
  routeMocks.tmuxExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
});

describe('POST /api/terminals command', () => {
  it('runs a single-line command after creating the session', async () => {
    const response = await postTerminal({ command: 'echo hi' });

    expect(response.status).toBe(200);
    expect(response.body.commandSent).toBe(true);
    expect(routeMocks.createSession).toHaveBeenCalled();
    const sessionName = (response.body.sessionName as string);
    expect(routeMocks.tmuxExecAsync).toHaveBeenNthCalledWith(1, ['send-keys', '-t', `=${sessionName}:`, '-l', 'echo hi']);
    expect(routeMocks.tmuxExecAsync).toHaveBeenNthCalledWith(2, ['send-keys', '-t', `=${sessionName}:`, 'Enter']);
  });

  it('rejects a multi-line command with 400 and creates no session', async () => {
    const response = await postTerminal({ command: 'echo hi\nrm -rf /' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('command must be a single line');
    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('rejects a 2001-character command with 400', async () => {
    const response = await postTerminal({ command: 'a'.repeat(2001) });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('command must be at most 2000 characters');
    expect(routeMocks.createSession).not.toHaveBeenCalled();
  });

  it('creates a plain shell when command is absent', async () => {
    const response = await postTerminal({});

    expect(response.status).toBe(200);
    expect(response.body.commandSent).toBeUndefined();
    expect(routeMocks.tmuxExecAsync).not.toHaveBeenCalled();
  });
});
