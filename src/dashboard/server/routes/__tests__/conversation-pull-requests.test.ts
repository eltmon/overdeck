import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3822: the link/unlink routes are thin: origin check, body/query parse,
// the shared command, list-cache invalidation. The commands have their own
// temp-DB test (conversation-pull-request-commands.test.ts).

const linkMock = vi.fn();
const unlinkMock = vi.fn();
const getMock = vi.fn();
const invalidateMock = vi.fn();
vi.mock('../../../../lib/overdeck/conversation-pull-request-commands.js', () => ({
  linkPullRequestToConversation: (...args: unknown[]) => linkMock(...args),
  unlinkPullRequestFromConversation: (...args: unknown[]) => unlinkMock(...args),
  getConversationPullRequests: (...args: unknown[]) => getMock(...args),
}));
vi.mock('../../../../lib/overdeck/conversation-list.js', () => ({
  invalidateConversationListEnrichmentCache: () => invalidateMock(),
}));
vi.mock('../../services/pull-request-sync-service.js', () => ({
  refreshPullRequestLinkNow: vi.fn(async () => {}),
}));

const { conversationPullRequestRoutes } = await import('../conversation-pull-requests.js');

async function call(method: string, path: string, init: { body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'http://localhost:3011';
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(conversationPullRequestRoutes),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  linkMock.mockReset();
  unlinkMock.mockReset();
  getMock.mockReset();
  invalidateMock.mockReset();
});

describe('conversation pull-request routes', () => {
  it('POST links with the manual source by default and invalidates the list cache', async () => {
    linkMock.mockResolvedValue({ ok: true, status: 201, body: { number: 42 } });
    const res = await call('POST', '/api/conversations/conv-a/pull-requests', { body: { ref: '#42' } });
    expect(res).toEqual({ status: 201, json: { number: 42 } });
    expect(linkMock).toHaveBeenCalledWith('conv-a', '#42', 'manual', expect.objectContaining({ refreshLink: expect.any(Function) }));
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('POST passes the agent source through and returns command errors unchanged', async () => {
    linkMock.mockResolvedValue({ ok: false, status: 400, body: { error: 'nope', code: 'foreign_repository' } });
    const res = await call('POST', '/api/conversations/conv-a/pull-requests', { body: { ref: 'x/y#1', source: 'agent' } });
    expect(res).toEqual({ status: 400, json: { error: 'nope', code: 'foreign_repository' } });
    expect(linkMock.mock.calls[0]?.[2]).toBe('agent');
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('DELETE reads the ref from the query string', async () => {
    unlinkMock.mockResolvedValue({ ok: true, status: 200, body: { unlinked: true } });
    const ref = encodeURIComponent('https://github.com/eltmon/overdeck/pull/42');
    const res = await call('DELETE', `/api/conversations/conv-a/pull-requests?ref=${ref}`);
    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith('conv-a', 'https://github.com/eltmon/overdeck/pull/42');
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('GET returns the links view', async () => {
    getMock.mockReturnValue({ ok: true, status: 200, body: { links: [], effective: null } });
    expect(await call('GET', '/api/conversations/conv-a/pull-requests')).toEqual({ status: 200, json: { links: [], effective: null } });
  });

  it('refuses a cross-origin write with 403', async () => {
    const res = await call('POST', '/api/conversations/conv-a/pull-requests', { body: { ref: '#1' }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(linkMock).not.toHaveBeenCalled();
  });
});
