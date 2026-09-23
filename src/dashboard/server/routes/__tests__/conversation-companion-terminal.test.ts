/**
 * Route tests for the companion terminal mutations (PAN-3974).
 *
 * The lifecycle and the conversation door are mocked; the auth guard, the body
 * whitelist, and the owner resolution run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardCsrfToken,
  dashboardSessionCookieHeader,
} from '../dashboard-auth.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';

const lifecycle = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  closeForOwner: vi.fn(),
}));
const getConversationByName = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/overdeck/companion-terminal/index.js', () => ({
  getCompanionTerminalLifecycle: () => lifecycle,
}));
vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  getConversationByName: (name: string) => getConversationByName(name),
}));

const CONV = {
  name: '20260923-0001',
  tmuxSession: 'conv-20260923-0001',
  cwd: '/work/repo',
  harness: 'opencode',
};
const GENERATION = 'abcdefabcdefabcdefabcdef';

function decode(response: { body: unknown }): unknown {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return text ? JSON.parse(text) : null;
}

function sessionCookie(): string {
  return dashboardSessionCookieHeader().split(';')[0] ?? `${DASHBOARD_SESSION_COOKIE}=`;
}

async function post(
  path: string,
  body: unknown,
  options: { origin?: string; auth?: boolean; csrf?: boolean; rawBody?: string } = {},
) {
  const { conversationCompanionTerminalRouteLayer } = await import('../conversation-companion-terminal.js');
  const headers: Record<string, string> = {
    Origin: options.origin ?? 'http://localhost:3011',
    'Content-Type': 'application/json',
  };
  if (options.auth !== false) headers['Cookie'] = sessionCookie();
  if (options.csrf !== false) headers[DASHBOARD_CSRF_HEADER] = dashboardCsrfToken();
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationCompanionTerminalRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
}

const OPEN = `/api/conversations/${CONV.name}/companion-terminal/open`;
const CLOSE = `/api/conversations/${CONV.name}/companion-terminal/close`;

describe('companion terminal routes', () => {
  beforeEach(() => {
    lifecycle.open.mockReset();
    lifecycle.close.mockReset();
    getConversationByName.mockReset();
    getConversationByName.mockImplementation((name: string) => (name === CONV.name ? CONV : null));
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-dashboard-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('opens with the server-resolved owner only', async () => {
    const attached = {
      status: 'attached',
      kind: 'opencode-attach',
      sessionName: 'companion-conv-20260923-0001',
      generation: GENERATION,
      reused: false,
    };
    lifecycle.open.mockResolvedValue(attached);

    const response = await post(OPEN, {});

    expect(response.status).toBe(200);
    expect(decode(response)).toEqual(attached);
    expect(lifecycle.open).toHaveBeenCalledWith({
      conversationName: CONV.name,
      ownerSession: CONV.tmuxSession,
      cwd: CONV.cwd,
      harness: 'opencode',
    });
  });

  it('returns restart-required as a readable state, not an error', async () => {
    lifecycle.open.mockResolvedValue({ status: 'unavailable', kind: 'opencode-attach', reason: 'restart-required', message: 'Stop and resume' });
    const response = await post(OPEN, {});
    expect(response.status).toBe(200);
    expect(decode(response)).toMatchObject({ reason: 'restart-required' });
  });

  it('maps an owner that restarted mid-open to 409', async () => {
    lifecycle.open.mockResolvedValue({ status: 'unavailable', kind: 'opencode-attach', reason: 'owner-changed', message: 'again' });
    expect((await post(OPEN, {})).status).toBe(409);
  });

  it('maps an unsupported harness to 400', async () => {
    lifecycle.open.mockResolvedValue({ status: 'unavailable', kind: null, reason: 'unsupported', message: 'no' });
    expect((await post(OPEN, {})).status).toBe(400);
  });

  it.each([
    ['url', { url: 'http://127.0.0.1:1' }],
    ['command', { command: 'bash' }],
    ['sessionId', { sessionId: 'ses_evil' }],
    ['cwd', { cwd: '/' }],
    ['target', { target: 'conv-other' }],
    ['port', { port: 22 }],
  ])('rejects caller-controlled %s on open', async (field, body) => {
    const response = await post(OPEN, body);
    expect(response.status).toBe(400);
    expect(decode(response)).toEqual({ error: `Unexpected field: ${field}. The server resolves the terminal target.` });
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('rejects target injection through the query string', async () => {
    const response = await post(`${OPEN}?session=ses_evil`, {});
    expect(response.status).toBe(400);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('rejects a non-object or malformed body', async () => {
    expect((await post(OPEN, ['x'])).status).toBe(400);
    expect((await post(OPEN, null, { rawBody: '{not json' })).status).toBe(400);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('requires dashboard auth', async () => {
    const response = await post(OPEN, {}, { auth: false, csrf: false });
    expect(response.status).toBe(401);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('requires the CSRF header with a session cookie', async () => {
    const response = await post(OPEN, {}, { csrf: false });
    expect(response.status).toBe(403);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('rejects a foreign origin', async () => {
    const response = await post(OPEN, {}, { origin: 'https://evil.example.com' });
    expect(response.status).toBe(403);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('404s an unknown conversation', async () => {
    const response = await post('/api/conversations/nope/companion-terminal/open', {});
    expect(response.status).toBe(404);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('closes with the caller generation', async () => {
    lifecycle.close.mockResolvedValue({ status: 'closed', kind: 'opencode-attach' });
    const response = await post(CLOSE, { generation: GENERATION });
    expect(response.status).toBe(200);
    expect(lifecycle.close).toHaveBeenCalledWith(expect.objectContaining({ ownerSession: CONV.tmuxSession }), GENERATION);
  });

  it('maps a stale close to 409', async () => {
    lifecycle.close.mockResolvedValue({ status: 'stale-generation', message: 'older run' });
    expect((await post(CLOSE, { generation: GENERATION })).status).toBe(409);
  });

  it('requires a well-formed generation and nothing else on close', async () => {
    expect((await post(CLOSE, {})).status).toBe(400);
    expect((await post(CLOSE, { generation: 'not-hex' })).status).toBe(400);
    expect((await post(CLOSE, { generation: GENERATION, sessionName: 'conv-20260923-0001' })).status).toBe(400);
    expect(lifecycle.close).not.toHaveBeenCalled();
  });

  it('requires dashboard auth and origin on close', async () => {
    expect((await post(CLOSE, { generation: GENERATION }, { auth: false, csrf: false })).status).toBe(401);
    expect((await post(CLOSE, { generation: GENERATION }, { origin: 'https://evil.example.com' })).status).toBe(403);
    expect(lifecycle.close).not.toHaveBeenCalled();
  });

  it('turns a lifecycle failure into a 500 with a message', async () => {
    lifecycle.open.mockRejectedValue(new Error('tmux refused'));
    const response = await post(OPEN, {});
    expect(response.status).toBe(500);
    expect(decode(response)).toEqual({ error: 'Could not open the terminal: tmux refused' });
  });
});
