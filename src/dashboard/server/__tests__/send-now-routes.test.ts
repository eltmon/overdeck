/**
 * PAN-5353: the /api/conversations/:name/send-now and /api/agents/:id/send-now
 * routes. Both doors and origin validation are mocked; this file only checks
 * the HTTP wiring (origin check, param pass-through, status mapping).
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SendNowResult } from '../../../lib/agents/send-now.js';

const sendNowToAgent = vi.hoisted(() => vi.fn(async (_id: string): Promise<SendNowResult> => ({ ok: true })));
const sendNowToConversation = vi.hoisted(() => vi.fn(async (_name: string): Promise<SendNowResult> => ({ ok: true })));
const originCheck = vi.hoisted(() => ({ current: { ok: true as const } as { ok: true } | { ok: false; error: string } }));

vi.mock('../../../lib/agents/send-now.js', () => ({ sendNowToAgent }));
vi.mock('../../../lib/overdeck/conversation-send-now.js', () => ({ sendNowToConversation }));
vi.mock('../routes/origin-validation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routes/origin-validation.js')>()),
  validateOrigin: () => originCheck.current,
}));

const { sendNowRouteLayer } = await import('../routes/send-now.js');
const { requiredScopeFor } = await import('../route-scopes.js');

async function post(path: string) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method: 'POST' }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(sendNowRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  sendNowToAgent.mockClear();
  sendNowToConversation.mockClear();
  originCheck.current = { ok: true };
});

describe('POST /api/conversations/:name/send-now and /api/agents/:id/send-now', () => {
  it('refuses both routes with 403 when the origin is refused, calling neither door', async () => {
    originCheck.current = { ok: false, error: 'Missing origin' };

    const convRes = await post('/api/conversations/c1/send-now');
    expect(convRes.status).toBe(403);
    expect(convRes.json).toEqual({ error: 'Missing origin' });

    const agentRes = await post('/api/agents/agent-pan-1/send-now');
    expect(agentRes.status).toBe(403);
    expect(agentRes.json).toEqual({ error: 'Missing origin' });

    expect(sendNowToConversation).not.toHaveBeenCalled();
    expect(sendNowToAgent).not.toHaveBeenCalled();
  });

  it('passes the conversation name to sendNowToConversation and answers 200 ok on success', async () => {
    const res = await post('/api/conversations/c1/send-now');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(sendNowToConversation).toHaveBeenCalledWith('c1');
  });

  it('passes the agent id to sendNowToAgent and answers 200 ok on success', async () => {
    const res = await post('/api/agents/agent-pan-1/send-now');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(sendNowToAgent).toHaveBeenCalledWith('agent-pan-1');
  });

  it.each([
    [404, 'not-found', 'Conversation not found'],
    [409, 'permission-pending', 'Waiting: the agent needs a permission answer first'],
    [422, 'steer-unsupported', 'Codex has no send-now'],
    [502, 'press-failed', "Could not press send-now in conv-c1's pane: boom"],
  ] as const)('maps a %d %s door failure to the response body', async (status, code, error) => {
    sendNowToConversation.mockResolvedValueOnce({ ok: false, status, code, error });
    const res = await post('/api/conversations/c1/send-now');
    expect(res.status).toBe(status);
    expect(res.json).toEqual({ error, code });
  });

  it("requires the 'tell' scope for both paths", () => {
    expect(requiredScopeFor('POST', '/api/conversations/c1/send-now')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/agents/agent-pan-1/send-now')).toBe('tell');
  });
});
