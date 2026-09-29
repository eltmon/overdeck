import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.hoisted(() => ({ getClaudeCodeStatus: vi.fn() }));
vi.mock('../../../../lib/claude-code/status.js', () => ({ getClaudeCodeStatus: statusMock.getClaudeCodeStatus }));

const tmuxMock = vi.hoisted(() => ({
  createSession: vi.fn(),
  sessionExists: vi.fn(),
}));
vi.mock('../../../../lib/tmux.js', () => ({
  createSession: tmuxMock.createSession,
  sessionExists: tmuxMock.sessionExists,
}));

vi.mock('../origin-validation.js', () => ({
  validateOrigin: () => ({ ok: true }),
}));

import { claudeCodeRouteLayer } from '../claude-code.js';

const RUNNABLE_UPGRADE = {
  method: 'npm' as const,
  argv: ['npm', 'install', '-g', '--prefix', '/usr/local', '@anthropic-ai/claude-code@latest'],
  display: 'npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
  runnable: true,
};

async function runRoute(request: Request) {
  const httpRequest = HttpServerRequest.fromWeb(request);
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(claudeCodeRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, httpRequest),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  statusMock.getClaudeCodeStatus.mockReset();
  tmuxMock.createSession.mockReset().mockReturnValue(Effect.succeed(undefined));
  tmuxMock.sessionExists.mockReset().mockReturnValue(Effect.succeed(false));
});

describe('GET /api/claude-code/status', () => {
  it('returns the aggregated status as JSON', async () => {
    statusMock.getClaudeCodeStatus.mockResolvedValueOnce({ found: false, outdated: false });

    const result = await runRoute(new Request('http://localhost/api/claude-code/status'));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ found: false, outdated: false });
    expect(statusMock.getClaudeCodeStatus).toHaveBeenCalledWith({ refresh: false });
  });

  it('passes ?refresh=1 through as refresh: true', async () => {
    statusMock.getClaudeCodeStatus.mockResolvedValueOnce({ found: false, outdated: false });

    await runRoute(new Request('http://localhost/api/claude-code/status?refresh=1'));

    expect(statusMock.getClaudeCodeStatus).toHaveBeenCalledWith({ refresh: true });
  });
});

describe('POST /api/claude-code/upgrade', () => {
  function postUpgrade(body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    return runRoute(
      new Request('http://localhost/api/claude-code/upgrade', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  it('creates the upgrade session and returns 200 when runnable', async () => {
    statusMock.getClaudeCodeStatus.mockResolvedValue({
      found: true,
      binaryPath: '/usr/local/bin/claude',
      version: '2.1.280',
      outdated: true,
      upgrade: RUNNABLE_UPGRADE,
    });

    const result = await postUpgrade({ command: 'rm -rf /' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ sessionName: 'claude-code-upgrade' });
    expect(tmuxMock.createSession).toHaveBeenCalledTimes(1);

    const [sessionName, , command] = tmuxMock.createSession.mock.calls[0] as [string, string, string];
    expect(sessionName).toBe('claude-code-upgrade');
    expect(command).toContain('@anthropic-ai/claude-code@latest');
    expect(command).not.toContain('rm -rf /');
  });

  it('returns 400 with the copyable command when the plan is not runnable', async () => {
    statusMock.getClaudeCodeStatus.mockResolvedValue({
      found: true,
      binaryPath: '/usr/local/bin/claude',
      version: '2.1.280',
      outdated: true,
      upgrade: {
        method: 'npm',
        argv: null,
        display: 'sudo npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
        runnable: false,
        reason: 'not-writable',
      },
    });

    const result = await postUpgrade();

    expect(result.status).toBe(400);
    expect(result.body.command).toBe('sudo npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest');
    expect(tmuxMock.createSession).not.toHaveBeenCalled();
  });

  it('returns 400 and starts no session when every configured model is already satisfied', async () => {
    statusMock.getClaudeCodeStatus.mockResolvedValue({
      found: true,
      binaryPath: '/usr/local/bin/claude',
      version: '2.1.284',
      outdated: false,
      upgrade: RUNNABLE_UPGRADE,
    });

    const result = await postUpgrade();

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Claude Code already satisfies every configured model');
    expect(tmuxMock.createSession).not.toHaveBeenCalled();
  });

  it('returns 409 when an upgrade session is already running', async () => {
    tmuxMock.sessionExists.mockReturnValue(Effect.succeed(true));
    statusMock.getClaudeCodeStatus.mockResolvedValue({
      found: true,
      binaryPath: '/usr/local/bin/claude',
      version: '2.1.280',
      outdated: true,
      upgrade: RUNNABLE_UPGRADE,
    });

    const result = await postUpgrade();

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ sessionName: 'claude-code-upgrade', alreadyRunning: true });
    expect(tmuxMock.createSession).not.toHaveBeenCalled();
  });
});
