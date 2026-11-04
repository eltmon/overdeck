/**
 * PAN-4927 W-SEC1: the agent request routes through the real remote request
 * gate and access-token registry under a temporary OVERDECK_HOME, plus the
 * handlers' caller, input, ownership and wait checks with injected deps.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';

const LAN_PEER = '192.0.2.45';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4941-agent-requests-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { requiredScopeFor } = await import('../route-scopes.js');
const { createAgentRequests } = await import('../services/agent-requests.js');
const { handleSecretRequestCreate, handleSecretRequestWait, makeSelfRequestsRouteLayer } = await import('../routes/self-requests.js');

const callerDeps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId === 'agent-pan-1' || agentId === 'agent-pan-2' ? { workspace: `/w/${agentId}`, issueId: 'PAN-1' } : null),
  getConversationByName: (name) => (name === 'abc' ? { cwd: '/p', tmuxSession: 'conv-abc', issueId: null } : null),
};

const agentCredential = (agentId: string, agentKind: 'agent' | 'conversation' = 'agent'): DashboardCredential => ({
  kind: 'token',
  tokenId: `tok-${agentId}`,
  scopes: ['read:state', 'tell'],
  agentId,
  agentKind,
  role: agentKind === 'agent' ? 'work' : 'conversation',
});

const validAsk = JSON.stringify({ name: 'OPENAI_API_KEY', prompt: 'The key for the eval run' });

async function send(
  app: Layer.Layer<never, never, never>,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = body;
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, init))
    .modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, json: text ? JSON.parse(text) : null };
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  _resetDashboardSessionTokenForTests();
});

describe('self secret request routes through the gate', () => {
  it('answers an agent token 201 with next, then 200 with the same requestId for a repeated ask', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'a', scopes: ['read:state', 'tell'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });

    const first = await send(app, 'POST', '/api/self/secret-requests', bearer(token), validAsk);
    expect(first.status).toBe(201);
    const body = first.json as { requestId: string; status: string; expiresAt: string; next: { tool: string; arguments: { requestId: string } } };
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toMatchObject({ status: 'pending', next: { tool: 'secret_wait', arguments: { requestId: body.requestId } } });
    expect(typeof body.expiresAt).toBe('string');

    const again = await send(app, 'POST', '/api/self/secret-requests', bearer(token), validAsk);
    expect(again.status).toBe(200);
    expect((again.json as { requestId: string }).requestId).toBe(body.requestId);

    const waited = await send(app, 'GET', `/api/self/secret-requests/${body.requestId}/wait?timeoutMs=1`, bearer(token));
    expect(waited.status).toBe(200);
    expect(waited.json).toEqual({ requestId: body.requestId, status: 'pending', next: { tool: 'secret_wait', arguments: { requestId: body.requestId } } });
  });

  it('refuses a plain token with 403 not-an-agent-token on both routes', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'plain', scopes: ['read:state', 'tell'], kind: 'token' });
    const created = await send(app, 'POST', '/api/self/secret-requests', bearer(token), validAsk);
    expect(created.status).toBe(403);
    expect(created.json).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
    const waited = await send(app, 'GET', '/api/self/secret-requests/abc/wait', bearer(token));
    expect(waited.status).toBe(403);
    expect(waited.json).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
  });

  it('refuses an agent token holding only read:state at the gate with insufficient_scope on the ask', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'r', scopes: ['read:state'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });
    const response = await send(app, 'POST', '/api/self/secret-requests', bearer(token), validAsk);
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'insufficient_scope', missingScope: 'tell' });
    expect(requests.listPending()).toEqual([]);
  });

  it('maps the ask to tell and the wait to read:state', () => {
    expect(requiredScopeFor('POST', '/api/self/secret-requests')).toBe('tell');
    expect(requiredScopeFor('GET', '/api/self/secret-requests/x/wait')).toBe('read:state');
  });
});

describe('self secret request handlers', () => {
  it('refuses a root session and the internal token with 403 not-an-agent-token', () => {
    const requests = createAgentRequests();
    for (const credential of [{ kind: 'root-session' }, { kind: 'internal-token' }, null] as const) {
      expect(handleSecretRequestCreate(credential, validAsk, { requests, caller: callerDeps })).toEqual({
        status: 403,
        body: { error: 'self routes need an agent token', code: 'not-an-agent-token' },
      });
    }
  });

  it.each([
    ['a lower-case name', { name: 'openai_key', prompt: 'p' }, 'bad-name'],
    ['a path name', { name: '../X', prompt: 'p' }, 'bad-name'],
    ['a missing name', { prompt: 'p' }, 'bad-name'],
    ['an empty prompt', { name: 'OPENAI_API_KEY', prompt: '   ' }, 'bad-prompt'],
    ['a long prompt', { name: 'OPENAI_API_KEY', prompt: 'x'.repeat(301) }, 'bad-prompt'],
    ['timeoutMs 5', { name: 'OPENAI_API_KEY', prompt: 'p', timeoutMs: 5 }, 'bad-timeout'],
    ['a fractional timeoutMs', { name: 'OPENAI_API_KEY', prompt: 'p', timeoutMs: 60_000.5 }, 'bad-timeout'],
    ['a timeoutMs over an hour', { name: 'OPENAI_API_KEY', prompt: 'p', timeoutMs: 3_600_001 }, 'bad-timeout'],
  ])('refuses %s with 400', (_label, body, code) => {
    const requests = createAgentRequests();
    const result = handleSecretRequestCreate(agentCredential('agent-pan-1'), JSON.stringify(body), { requests, caller: callerDeps });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code });
    expect(requests.listPending()).toEqual([]);
  });

  it.each(['{not json canary-4941', '[1,2]', '"text"', 'null'])('refuses the body %j with 400 bad-body and never quotes it', (bodyText) => {
    const requests = createAgentRequests();
    const result = handleSecretRequestCreate(agentCredential('agent-pan-1'), bodyText, { requests, caller: callerDeps });
    expect(result).toEqual({ status: 400, body: { error: 'body must be a JSON object', code: 'bad-body' } });
  });

  it('labels a request with the agent and its issue, and a conversation by its name', () => {
    const requests = createAgentRequests();
    expect(handleSecretRequestCreate(agentCredential('agent-pan-1'), validAsk, { requests, caller: callerDeps }).status).toBe(201);
    expect(handleSecretRequestCreate(agentCredential('abc', 'conversation'), validAsk, { requests, caller: callerDeps }).status).toBe(201);
    expect(requests.listPending().map((view) => [view.label, view.prompt])).toEqual([
      ['agent-pan-1 · PAN-1', 'The key for the eval run'],
      ['abc', 'The key for the eval run'],
    ]);
  });

  it('accepts a timeoutMs in range and sets expiresAt from it', () => {
    const requests = createAgentRequests({ now: () => Date.parse('2026-11-04T00:00:00.000Z') });
    const result = handleSecretRequestCreate(
      agentCredential('agent-pan-1'),
      JSON.stringify({ name: 'OPENAI_API_KEY', prompt: 'p', timeoutMs: 120_000 }),
      { requests, caller: callerDeps },
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ expiresAt: '2026-11-04T00:02:00.000Z' });
  });

  it('answers 429 too-many-requests at 20 pending requests', () => {
    const requests = createAgentRequests();
    for (let i = 0; i < 20; i += 1) {
      const ask = JSON.stringify({ name: `KEY_${i}`, prompt: 'p' });
      expect(handleSecretRequestCreate(agentCredential('agent-pan-1'), ask, { requests, caller: callerDeps }).status).toBe(201);
    }
    expect(handleSecretRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ name: 'KEY_X', prompt: 'p' }), { requests, caller: callerDeps })).toEqual({
      status: 429,
      body: { error: 'this agent already has 20 pending requests', code: 'too-many-requests' },
    });
  });

  it('hides another agent\'s request as 404 unknown-request', async () => {
    const requests = createAgentRequests();
    const created = handleSecretRequestCreate(agentCredential('agent-pan-1'), validAsk, { requests, caller: callerDeps });
    const { requestId } = created.body as { requestId: string };
    await expect(handleSecretRequestWait(agentCredential('agent-pan-2'), requestId, '1', undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 404,
      body: { error: 'no such request; a dashboard restart forgets requests, so call request_secret again', code: 'unknown-request' },
    });
  });

  it.each(['0', '50001', 'abc', ''])('refuses wait timeoutMs %j with 400 bad-timeout', async (raw) => {
    const requests = createAgentRequests();
    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), 'x', raw, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 400,
      body: { error: 'timeoutMs must be an integer from 1 to 50000', code: 'bad-timeout' },
    });
  });

  it('answers delivered with the file, and declined without one', async () => {
    const requests = createAgentRequests();
    const first = handleSecretRequestCreate(agentCredential('agent-pan-1'), validAsk, { requests, caller: callerDeps });
    const { requestId } = first.body as { requestId: string };
    requests.settle(requestId, 'delivered', { file: '/home/x/.overdeck/agents/agent-pan-1/secrets/OPENAI_API_KEY' });
    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'delivered', file: '/home/x/.overdeck/agents/agent-pan-1/secrets/OPENAI_API_KEY' },
    });

    const second = handleSecretRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ name: 'OTHER_KEY', prompt: 'p' }), { requests, caller: callerDeps });
    const otherId = (second.body as { requestId: string }).requestId;
    requests.settle(otherId, 'declined');
    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), otherId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId: otherId, status: 'declined' },
    });
  });

  describe('waits on fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers pending with next after the 50 s chunk, not before', async () => {
      const requests = createAgentRequests();
      const created = handleSecretRequestCreate(agentCredential('agent-pan-1'), validAsk, { requests, caller: callerDeps });
      const { requestId } = created.body as { requestId: string };
      let settled = false;
      const waiting = handleSecretRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(49_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toEqual({
        status: 200,
        body: { requestId, status: 'pending', next: { tool: 'secret_wait', arguments: { requestId } } },
      });
    });
  });
});
