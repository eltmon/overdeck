/**
 * PAN-4927 W-SEC1 and PAN-4942 W-LINK1: the agent request routes through the real remote request
 * gate and access-token registry under a temporary OVERDECK_HOME, plus the
 * handlers' caller, input, ownership and wait checks with injected deps.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardApi } from '../../../lib/mcp/dashboard-api.js';
import { callTool, connectClient, resultJson } from '../../../../tests/unit/lib/mcp/harness.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';

const { emitActivityEntryMock } = vi.hoisted(() => ({ emitActivityEntryMock: vi.fn() }));
vi.mock('../../../lib/activity-logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/activity-logger.js')>()),
  emitActivityEntry: emitActivityEntryMock,
}));

const LAN_PEER = '192.0.2.45';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4941-agent-requests-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { requiredScopeFor } = await import('../route-scopes.js');
const { createAgentRequests } = await import('../services/agent-requests.js');
const {
  handleMachineLinkRequestCreate,
  handleMachineLinkRequestWait,
  handleSecretRequestCreate,
  handleSecretRequestWait,
  makeSelfRequestsRouteLayer,
} = await import('../routes/self-requests.js');
const {
  handleAgentRequestDecline,
  handleAgentRequestLinked,
  handleAgentRequestList,
  handleAgentRequestSecret,
  makeAgentRequestsRouteLayer,
} = await import('../routes/agent-requests.js');
const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, markLinkRevoked, upsertLink } = await import('../../../lib/anywhere/link-store.js');

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
const validLinkAsk = JSON.stringify({ hint: 'my desk Mac' });

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
  emitActivityEntryMock.mockClear();
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

describe('self machine-link request routes through the gate', () => {
  it('answers an agent token 201 with next, then 200 with the same requestId for the same hint', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'a', scopes: ['read:state', 'tell'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });

    const first = await send(app, 'POST', '/api/self/machine-link-requests', bearer(token), validLinkAsk);
    expect(first.status).toBe(201);
    const body = first.json as { requestId: string; status: string; expiresAt: string; next: { tool: string; arguments: { requestId: string } } };
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toMatchObject({ status: 'pending', next: { tool: 'link_machine_wait', arguments: { requestId: body.requestId } } });
    expect(typeof body.expiresAt).toBe('string');

    const again = await send(app, 'POST', '/api/self/machine-link-requests', bearer(token), JSON.stringify({ hint: ' MY DESK MAC ' }));
    expect(again.status).toBe(200);
    expect((again.json as { requestId: string }).requestId).toBe(body.requestId);

    const waited = await send(app, 'GET', `/api/self/machine-link-requests/${body.requestId}/wait?timeoutMs=1`, bearer(token));
    expect(waited.status).toBe(200);
    expect(waited.json).toEqual({ requestId: body.requestId, status: 'pending', next: { tool: 'link_machine_wait', arguments: { requestId: body.requestId } } });
  });

  it('refuses a plain token with 403 not-an-agent-token on both routes', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'plain', scopes: ['read:state', 'tell'], kind: 'token' });
    const created = await send(app, 'POST', '/api/self/machine-link-requests', bearer(token), validLinkAsk);
    expect(created.status).toBe(403);
    expect(created.json).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
    const waited = await send(app, 'GET', '/api/self/machine-link-requests/abc/wait', bearer(token));
    expect(waited.status).toBe(403);
    expect(waited.json).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
  });

  it('refuses an agent token holding only read:state at the gate with insufficient_scope on the ask', async () => {
    const requests = createAgentRequests();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfRequestsRouteLayer({ requests, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'r', scopes: ['read:state'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });
    const response = await send(app, 'POST', '/api/self/machine-link-requests', bearer(token), validLinkAsk);
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'insufficient_scope', missingScope: 'tell' });
    expect(requests.listPending()).toEqual([]);
  });

  it('maps the ask to tell and the wait to read:state', () => {
    expect(requiredScopeFor('POST', '/api/self/machine-link-requests')).toBe('tell');
    expect(requiredScopeFor('GET', '/api/self/machine-link-requests/x/wait')).toBe('read:state');
  });
});

describe('self machine-link request handlers', () => {
  const unknownLink = {
    status: 404,
    body: { error: 'no such request; a dashboard restart forgets requests, so call link_machine again', code: 'unknown-request' },
  };

  it('refuses a root session and the internal token with 403 not-an-agent-token', () => {
    const requests = createAgentRequests();
    for (const credential of [{ kind: 'root-session' }, { kind: 'internal-token' }, null] as const) {
      expect(handleMachineLinkRequestCreate(credential, validLinkAsk, { requests, caller: callerDeps })).toEqual({
        status: 403,
        body: { error: 'self routes need an agent token', code: 'not-an-agent-token' },
      });
    }
  });

  it.each([
    ['an empty hint', { hint: '   ' }],
    ['a missing hint', {}],
    ['a number', { hint: 42 }],
    ['a 201-character hint', { hint: 'x'.repeat(201) }],
    ['a hint holding a newline', { hint: 'my desk\nMac' }],
    ['a hint holding DEL', { hint: 'my desk\u007fMac' }],
  ])('refuses %s with 400 bad-hint', (_label, body) => {
    const requests = createAgentRequests();
    const result = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), JSON.stringify(body), { requests, caller: callerDeps });
    expect(result).toEqual({ status: 400, body: { error: 'hint must be 1 to 200 characters with no control characters', code: 'bad-hint' } });
    expect(requests.listPending()).toEqual([]);
  });

  it('refuses a body that is not a JSON object with 400 bad-body', () => {
    const requests = createAgentRequests();
    expect(handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), '[1]', { requests, caller: callerDeps })).toEqual({
      status: 400,
      body: { error: 'body must be a JSON object', code: 'bad-body' },
    });
  });

  it('stores the trimmed hint with the agent label, and accepts a 200-character hint', () => {
    const requests = createAgentRequests();
    expect(handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ hint: '  my desk Mac ' }), { requests, caller: callerDeps }).status).toBe(201);
    expect(handleMachineLinkRequestCreate(agentCredential('abc', 'conversation'), JSON.stringify({ hint: 'y'.repeat(200) }), { requests, caller: callerDeps }).status).toBe(201);
    expect(requests.listPending().map((view) => [view.kind, view.label, view.hint])).toEqual([
      ['machine-link', 'agent-pan-1 · PAN-1', 'my desk Mac'],
      ['machine-link', 'abc', 'y'.repeat(200)],
    ]);
  });

  it('answers 429 too-many-requests when secret requests fill the limit of 20', () => {
    const requests = createAgentRequests();
    for (let i = 0; i < 20; i += 1) {
      const ask = JSON.stringify({ name: `KEY_${i}`, prompt: 'p' });
      expect(handleSecretRequestCreate(agentCredential('agent-pan-1'), ask, { requests, caller: callerDeps }).status).toBe(201);
    }
    expect(handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps })).toEqual({
      status: 429,
      body: { error: 'this agent already has 20 pending requests', code: 'too-many-requests' },
    });
  });

  it('hides another agent\'s request as 404 unknown-request', async () => {
    const requests = createAgentRequests();
    const created = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps });
    const { requestId } = created.body as { requestId: string };
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-2'), requestId, '1', undefined, { requests, caller: callerDeps })).resolves.toEqual(unknownLink);
  });

  it.each(['0', '50001', 'abc', ''])('refuses wait timeoutMs %j with 400 bad-timeout', async (raw) => {
    const requests = createAgentRequests();
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), 'x', raw, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 400,
      body: { error: 'timeoutMs must be an integer from 1 to 50000', code: 'bad-timeout' },
    });
  });

  it('answers linked with the machine, and declined without one', async () => {
    const requests = createAgentRequests();
    const first = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps });
    const { requestId } = first.body as { requestId: string };
    requests.settle(requestId, 'linked', { machine: { environmentId: 'env-1', label: 'desk' } });
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'linked', machine: { environmentId: 'env-1', label: 'desk' } },
    });

    const second = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ hint: 'build box' }), { requests, caller: callerDeps });
    const otherId = (second.body as { requestId: string }).requestId;
    requests.settle(otherId, 'declined');
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), otherId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
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

    it('answers each wait route 404 at once for a request of the other kind (D-5)', async () => {
      const requests = createAgentRequests();
      const secret = handleSecretRequestCreate(agentCredential('agent-pan-1'), validAsk, { requests, caller: callerDeps });
      const link = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps });
      const secretId = (secret.body as { requestId: string }).requestId;
      const linkId = (link.body as { requestId: string }).requestId;
      // No timer advances: each answer must come without starting a wait.
      await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), secretId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual(unknownLink);
      await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), linkId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
        status: 404,
        body: { error: 'no such request; a dashboard restart forgets requests, so call request_secret again', code: 'unknown-request' },
      });
    });

    it('answers pending with next after the 50 s chunk, then linked with the machine after settle', async () => {
      const requests = createAgentRequests();
      const created = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps });
      const { requestId } = created.body as { requestId: string };
      let settled = false;
      const waiting = handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(49_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toEqual({
        status: 200,
        body: { requestId, status: 'pending', next: { tool: 'link_machine_wait', arguments: { requestId } } },
      });

      const second = handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps });
      await vi.advanceTimersByTimeAsync(1_000);
      requests.settle(requestId, 'linked', { machine: { environmentId: 'env-1', label: 'desk' } });
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toEqual({
        status: 200,
        body: { requestId, status: 'linked', machine: { environmentId: 'env-1', label: 'desk' } },
      });
    });
  });
});

const ROOT: DashboardCredential = { kind: 'root-session' };
const active = async () => true;

/** A store holding one pending secret request of agent-pan-1, and its id. */
function storeWithRequest(name = 'OPENAI_API_KEY') {
  const requests = createAgentRequests();
  const created = handleSecretRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ name, prompt: 'The key' }), { requests, caller: callerDeps });
  return { requests, requestId: (created.body as { requestId: string }).requestId };
}

describe('operator agent request routes through the gate', () => {
  it('refuses a token holding approve and a device on both answer routes with insufficient_scope', async () => {
    const { requests, requestId } = storeWithRequest();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeAgentRequestsRouteLayer({ requests, hasActiveAgentToken: active }));
    const approver = await createAccessToken({ name: 'bot', scopes: ['approve', 'read:conversations', 'tell', 'operate'], kind: 'token' });
    const device = await createAccessToken({ name: 'phone', scopes: ['approve', 'read:conversations'], kind: 'device' });
    for (const headers of [bearer(approver.token), { cookie: `overdeck_device=${device.token}` }]) {
      for (const path of [`/api/agent-requests/${requestId}/secret`, `/api/agent-requests/${requestId}/decline`]) {
        const response = await send(app, 'POST', path, headers, JSON.stringify({ value: 'canary-gate' }));
        expect(response.status, path).toBe(403);
        expect(response.json, path).toEqual({ error: 'insufficient_scope', missingScope: 'admin' });
      }
    }
    expect(requests.getForAnswer(requestId)?.view.status).toBe('pending');
    expect(existsSync(join(home, 'agents', 'agent-pan-1', 'secrets'))).toBe(false);
  });

  it('serves the pending list to read:conversations only, without a value, result or owner directory', async () => {
    const { requests, requestId } = storeWithRequest();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeAgentRequestsRouteLayer({ requests, hasActiveAgentToken: active }));
    const reader = await createAccessToken({ name: 'reader', scopes: ['read:conversations'], kind: 'token' });
    const other = await createAccessToken({ name: 'other', scopes: ['read:state'], kind: 'token' });

    const refused = await send(app, 'GET', '/api/agent-requests', bearer(other.token));
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({ error: 'insufficient_scope', missingScope: 'read:conversations' });

    const listed = await send(app, 'GET', '/api/agent-requests', bearer(reader.token));
    expect(listed.status).toBe(200);
    const rows = (listed.json as { requests: Array<Record<string, unknown>> }).requests;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['agentId', 'agentKind', 'createdAt', 'expiresAt', 'id', 'kind', 'label', 'name', 'prompt']);
    expect(rows[0]).toMatchObject({ id: requestId, kind: 'secret', agentId: 'agent-pan-1', label: 'agent-pan-1 · PAN-1', name: 'OPENAI_API_KEY' });
    expect(JSON.stringify(listed.json)).not.toContain(home);
  });

  it('maps the list to read:conversations and the answer routes to admin', () => {
    expect(requiredScopeFor('GET', '/api/agent-requests')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/agent-requests/x/secret')).toBe('admin');
    expect(requiredScopeFor('POST', '/api/agent-requests/x/decline')).toBe('admin');
  });
});

describe('operator agent request handlers', () => {
  it('refuses every credential but the internal token and the root session with 403 root-only', async () => {
    const { requests, requestId } = storeWithRequest();
    const refusals: Array<DashboardCredential | null> = [
      null,
      agentCredential('agent-pan-1'),
      { kind: 'token', tokenId: 't', scopes: ['approve'] },
      { kind: 'device', deviceId: 'd', scopes: ['approve'] },
    ];
    for (const credential of refusals) {
      const rootOnly = { status: 403, body: { error: 'only the internal token or the root session can answer agent requests', code: 'root-only' } };
      await expect(handleAgentRequestSecret(credential, requestId, JSON.stringify({ value: 'v' }), { requests, hasActiveAgentToken: active })).resolves.toEqual(rootOnly);
      expect(handleAgentRequestDecline(credential, requestId, { requests })).toEqual(rootOnly);
    }
    expect(requests.getForAnswer(requestId)?.view.status).toBe('pending');
  });

  it('delivers the value as a 0600 file in a 0700 directory, and the wait answers delivered with the path', async () => {
    const { requests, requestId } = storeWithRequest();
    const answered = await handleAgentRequestSecret(ROOT, requestId, JSON.stringify({ value: 'canary-deliver' }), { requests, hasActiveAgentToken: active });
    expect(answered).toEqual({ status: 200, body: { requestId, status: 'delivered' } });

    const file = join(home, 'agents', 'agent-pan-1', 'secrets', 'OPENAI_API_KEY');
    expect(await readFile(file, 'utf8')).toBe('canary-deliver');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'agents', 'agent-pan-1', 'secrets'))).mode & 0o777).toBe(0o700);

    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'delivered', file },
    });
    expect(emitActivityEntryMock).toHaveBeenCalledWith({ source: 'dashboard', level: 'info', message: 'Secret OPENAI_API_KEY delivered to agent-pan-1 · PAN-1' });

    await expect(handleAgentRequestSecret(ROOT, requestId, JSON.stringify({ value: 'again' }), { requests, hasActiveAgentToken: active })).resolves.toEqual({
      status: 409,
      body: { error: 'request is delivered', code: 'not-pending', status: 'delivered' },
    });
    expect(await readFile(file, 'utf8')).toBe('canary-deliver');
    expect(handleAgentRequestList({ requests }).body).toEqual({ requests: [] });
  });

  it('refuses delivery to an agent whose token was revoked with 409 agent-stopped and writes no file', async () => {
    const { requests, requestId } = storeWithRequest('STOPPED_KEY');
    const result = await handleAgentRequestSecret(ROOT, requestId, JSON.stringify({ value: 'canary-stopped' }), { requests, hasActiveAgentToken: async () => false });
    expect(result).toEqual({ status: 409, body: { error: 'the agent stopped; its request expired', code: 'agent-stopped' } });
    expect(existsSync(join(home, 'agents', 'agent-pan-1', 'secrets', 'STOPPED_KEY'))).toBe(false);
    expect(requests.getForAnswer(requestId)?.view.status).toBe('expired');
    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'expired' },
    });
  });

  it('checks the agent token in the registry by default: active delivers, revoked is agent-stopped', async () => {
    const { requests, requestId } = storeWithRequest('REGISTRY_KEY');
    // No agent token for agent-pan-1 exists in the temporary registry.
    await expect(handleAgentRequestSecret(ROOT, requestId, JSON.stringify({ value: 'v' }), { requests })).resolves.toMatchObject({ status: 409, body: { code: 'agent-stopped' } });

    const second = storeWithRequest('REGISTRY_KEY');
    const { record } = await createAccessToken({ name: 'agent:work:agent-pan-1', scopes: ['read:state', 'tell'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });
    await expect(handleAgentRequestSecret(ROOT, second.requestId, JSON.stringify({ value: 'v' }), { requests: second.requests })).resolves.toMatchObject({ status: 200 });
    rmSync(join(home, 'agents'), { recursive: true, force: true });

    const third = storeWithRequest('REVOKED_KEY');
    await revokeAccessToken(record.id);
    await expect(handleAgentRequestSecret(ROOT, third.requestId, JSON.stringify({ value: 'v' }), { requests: third.requests })).resolves.toMatchObject({ status: 409, body: { code: 'agent-stopped' } });
    expect(existsSync(join(home, 'agents', 'agent-pan-1', 'secrets', 'REVOKED_KEY'))).toBe(false);
  });

  it('declines a request, and the wait answers declined', async () => {
    const { requests, requestId } = storeWithRequest();
    expect(handleAgentRequestDecline({ kind: 'internal-token' }, requestId, { requests })).toEqual({ status: 200, body: { requestId, status: 'declined' } });
    await expect(handleSecretRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'declined' },
    });
    expect(emitActivityEntryMock).toHaveBeenCalledWith({ source: 'dashboard', level: 'info', message: 'Secret OPENAI_API_KEY declined for agent-pan-1 · PAN-1' });
    expect(handleAgentRequestDecline(ROOT, requestId, { requests })).toMatchObject({ status: 409, body: { code: 'not-pending' } });
  });

  it('answers 404 unknown-request for an unknown id', async () => {
    const requests = createAgentRequests();
    await expect(handleAgentRequestSecret(ROOT, 'f'.repeat(32), JSON.stringify({ value: 'v' }), { requests, hasActiveAgentToken: active })).resolves.toMatchObject({
      status: 404,
      body: { code: 'unknown-request' },
    });
    expect(handleAgentRequestDecline(ROOT, 'f'.repeat(32), { requests })).toMatchObject({ status: 404, body: { code: 'unknown-request' } });
  });

  it.each([
    ['an empty value', JSON.stringify({ value: '' })],
    ['a number', JSON.stringify({ value: 42 })],
    ['a missing value', JSON.stringify({})],
    ['a value over 65536 bytes', JSON.stringify({ value: 'é'.repeat(32_769) })],
  ])('refuses %s with 400 bad-value', async (_label, bodyText) => {
    const { requests, requestId } = storeWithRequest();
    await expect(handleAgentRequestSecret(ROOT, requestId, bodyText, { requests, hasActiveAgentToken: active })).resolves.toEqual({
      status: 400,
      body: { error: 'value must be a non-empty string of at most 65536 bytes', code: 'bad-value' },
    });
  });

  it('refuses a malformed body holding a canary without echoing or logging it', async () => {
    const canary = `canary-${crypto.randomUUID()}`;
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    try {
      const { requests, requestId } = storeWithRequest();
      const result = await handleAgentRequestSecret(ROOT, requestId, `{"value": "${canary}"`, { requests, hasActiveAgentToken: active });
      expect(result).toMatchObject({ status: 400, body: { code: 'bad-value' } });
      expect(JSON.stringify(result)).not.toContain(canary);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(emitActivityEntryMock.mock.calls)).not.toContain(canary);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

/** A store holding one pending machine-link request of agent-pan-1, and its id. */
function storeWithLinkRequest(hint = 'my desk Mac') {
  const requests = createAgentRequests();
  const created = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), JSON.stringify({ hint }), { requests, caller: callerDeps });
  return { requests, requestId: (created.body as { requestId: string }).requestId };
}

const deskLink = async (environmentId: string) => (environmentId === 'env-1' ? { environmentId: 'env-1', label: 'desk' } : null);
const linkedBody = JSON.stringify({ environmentId: 'env-1' });

describe('operator machine-link routes through the gate', () => {
  it('refuses a token holding approve on /linked with insufficient_scope', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeAgentRequestsRouteLayer({ requests, hasActiveAgentToken: active, findActiveLink: deskLink }));
    const approver = await createAccessToken({ name: 'bot', scopes: ['approve', 'read:conversations', 'tell', 'operate'], kind: 'token' });
    const response = await send(app, 'POST', `/api/agent-requests/${requestId}/linked`, bearer(approver.token), linkedBody);
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'insufficient_scope', missingScope: 'admin' });
    expect(requests.getForAnswer(requestId)?.view.status).toBe('pending');
    expect(requiredScopeFor('POST', '/api/agent-requests/x/linked')).toBe('admin');
  });

  it('lists a machine-link request with its hint', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeAgentRequestsRouteLayer({ requests, hasActiveAgentToken: active }));
    const reader = await createAccessToken({ name: 'reader', scopes: ['read:conversations'], kind: 'token' });
    const listed = await send(app, 'GET', '/api/agent-requests', bearer(reader.token));
    const rows = (listed.json as { requests: Array<Record<string, unknown>> }).requests;
    expect(Object.keys(rows[0]!).sort()).toEqual(['agentId', 'agentKind', 'createdAt', 'expiresAt', 'hint', 'id', 'kind', 'label']);
    expect(rows[0]).toMatchObject({ id: requestId, kind: 'machine-link', hint: 'my desk Mac', label: 'agent-pan-1 · PAN-1' });
  });
});

describe('operator machine-link handlers', () => {
  it('refuses a device credential and an agent token on /linked with 403 root-only', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    const rootOnly = { status: 403, body: { error: 'only the internal token or the root session can answer agent requests', code: 'root-only' } };
    for (const credential of [null, agentCredential('agent-pan-1'), { kind: 'device', deviceId: 'd', scopes: ['approve'] }] as Array<DashboardCredential | null>) {
      await expect(handleAgentRequestLinked(credential, requestId, linkedBody, { requests, hasActiveAgentToken: active, findActiveLink: deskLink })).resolves.toEqual(rootOnly);
    }
    expect(requests.getForAnswer(requestId)?.view.status).toBe('pending');
  });

  it.each([
    ['a missing environmentId', {}],
    ['an empty environmentId', { environmentId: '' }],
    ['a number', { environmentId: 7 }],
    ['a 201-character environmentId', { environmentId: 'e'.repeat(201) }],
  ])('refuses %s with 400 bad-environment-id', async (_label, body) => {
    const { requests, requestId } = storeWithLinkRequest();
    await expect(handleAgentRequestLinked(ROOT, requestId, JSON.stringify(body), { requests, hasActiveAgentToken: active, findActiveLink: deskLink })).resolves.toEqual({
      status: 400,
      body: { error: 'environmentId must be a string of 1 to 200 characters', code: 'bad-environment-id' },
    });
  });

  it('answers 400 unknown-machine for an environment id with no active link, and leaves the request pending', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    await expect(handleAgentRequestLinked(ROOT, requestId, JSON.stringify({ environmentId: 'env-9' }), { requests, hasActiveAgentToken: active, findActiveLink: deskLink })).resolves.toEqual({
      status: 400,
      body: { error: 'no active link to that machine', code: 'unknown-machine' },
    });
    expect(requests.getForAnswer(requestId)?.view.status).toBe('pending');
  });

  it('finds only an active link by environment id in the link store by default', async () => {
    _resetLinkStoreForTests();
    try {
      const base = { machineKey: 'a'.repeat(64), token: 'odk_test-link', access: 'operator' as const, routes: [] };
      await upsertLink({ ...base, environmentId: 'env-active', label: 'desk' });
      const { link: revoked } = await upsertLink({ ...base, environmentId: 'env-revoked', label: 'old box' });
      await markLinkRevoked(revoked.id);
      await _settleLinkStoreWritesForTests();

      const first = storeWithLinkRequest();
      // The label of a link is not its environment id, and a revoked link does not count.
      for (const environmentId of ['desk', 'env-revoked']) {
        await expect(handleAgentRequestLinked(ROOT, first.requestId, JSON.stringify({ environmentId }), { requests: first.requests, hasActiveAgentToken: active }))
          .resolves.toMatchObject({ status: 400, body: { code: 'unknown-machine' } });
      }
      await expect(handleAgentRequestLinked(ROOT, first.requestId, JSON.stringify({ environmentId: 'env-active' }), { requests: first.requests, hasActiveAgentToken: active })).resolves.toEqual({
        status: 200,
        body: { requestId: first.requestId, status: 'linked', machine: { environmentId: 'env-active', label: 'desk' } },
      });
    } finally {
      await _settleLinkStoreWritesForTests();
      rmSync(join(home, 'machine-links.json'), { force: true });
      _resetLinkStoreForTests();
    }
  });

  it('answers 409 wrong-kind for a secret request id, and /secret answers 409 wrong-kind for a machine-link id', async () => {
    const secret = storeWithRequest();
    await expect(handleAgentRequestLinked(ROOT, secret.requestId, linkedBody, { requests: secret.requests, hasActiveAgentToken: active, findActiveLink: deskLink })).resolves.toEqual({
      status: 409,
      body: { error: 'request is not a machine-link request', code: 'wrong-kind' },
    });
    const link = storeWithLinkRequest();
    await expect(handleAgentRequestSecret(ROOT, link.requestId, JSON.stringify({ value: 'v' }), { requests: link.requests, hasActiveAgentToken: active })).resolves.toEqual({
      status: 409,
      body: { error: 'request is not a secret request', code: 'wrong-kind' },
    });
  });

  it('answers 409 agent-stopped for a stopped agent, and its wait answers expired', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    await expect(handleAgentRequestLinked(ROOT, requestId, linkedBody, { requests, hasActiveAgentToken: async () => false, findActiveLink: deskLink })).resolves.toEqual({
      status: 409,
      body: { error: 'the agent stopped; its request expired', code: 'agent-stopped' },
    });
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'expired' },
    });
  });

  it('answers 409 not-pending when the request already ended', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    requests.settle(requestId, 'declined');
    await expect(handleAgentRequestLinked(ROOT, requestId, linkedBody, { requests, hasActiveAgentToken: active, findActiveLink: deskLink })).resolves.toEqual({
      status: 409,
      body: { error: 'request is declined', code: 'not-pending', status: 'declined' },
    });
  });

  it('declines a machine-link request, and the wait answers declined', async () => {
    const { requests, requestId } = storeWithLinkRequest();
    expect(handleAgentRequestDecline(ROOT, requestId, { requests })).toEqual({ status: 200, body: { requestId, status: 'declined' } });
    await expect(handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps })).resolves.toEqual({
      status: 200,
      body: { requestId, status: 'declined' },
    });
    expect(emitActivityEntryMock).toHaveBeenCalledWith({ source: 'dashboard', level: 'info', message: 'Machine link declined for agent-pan-1 · PAN-1' });
  });

  it('links end to end: the agent gets the link store label, and no pairing code or body label reaches it', async () => {
    const requests = createAgentRequests();
    const agentAnswers: unknown[] = [];
    const created = handleMachineLinkRequestCreate(agentCredential('agent-pan-1'), validLinkAsk, { requests, caller: callerDeps });
    agentAnswers.push(created);
    expect(created.status).toBe(201);
    const { requestId } = created.body as { requestId: string };

    const listed = handleAgentRequestList({ requests });
    expect((listed.body as { requests: Array<{ id: string; hint?: string }> }).requests).toMatchObject([{ id: requestId, hint: 'my desk Mac' }]);

    const body = JSON.stringify({ environmentId: 'env-1', label: 'spoofed', pairingUrl: 'https://desk/#pair=odp_secret' });
    const linked = await handleAgentRequestLinked(ROOT, requestId, body, { requests, hasActiveAgentToken: active, findActiveLink: deskLink });
    expect(linked).toEqual({ status: 200, body: { requestId, status: 'linked', machine: { environmentId: 'env-1', label: 'desk' } } });
    expect(emitActivityEntryMock).toHaveBeenCalledWith({ source: 'dashboard', level: 'info', message: 'Machine desk linked for agent-pan-1 · PAN-1' });

    const waited = await handleMachineLinkRequestWait(agentCredential('agent-pan-1'), requestId, null, undefined, { requests, caller: callerDeps });
    agentAnswers.push(waited);
    expect(waited).toEqual({ status: 200, body: { requestId, status: 'linked', machine: { environmentId: 'env-1', label: 'desk' } } });

    for (const answer of [...agentAnswers, requests.getForAnswer(requestId)?.view, emitActivityEntryMock.mock.calls]) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain('odp_');
      expect(text).not.toContain('pair=');
      expect(text).not.toContain('spoofed');
    }
  });
});

describe('secret request flow (AC-12)', () => {
  const INTERNAL_TOKEN = 'pan-4941-internal-token-0123456789';

  beforeEach(async () => {
    await writeFile(join(home, 'internal-token'), INTERNAL_TOKEN, { mode: 0o600 });
    _resetInternalTokenCacheForTests();
  });
  afterEach(() => {
    rmSync(join(home, 'internal-token'), { force: true });
    rmSync(join(home, 'agents'), { recursive: true, force: true });
    _resetInternalTokenCacheForTests();
  });

  it('delivers the value only as a 0600 file: the canary is in no answer, tool result, activity entry or console call', async () => {
    const canary = `canary-${crypto.randomUUID()}`;
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const outputs: unknown[] = [];
    try {
      const requests = createAgentRequests();
      const app = Layer.mergeAll(
        remoteRequestGateLayer,
        makeSelfRequestsRouteLayer({ requests, caller: callerDeps }),
        makeAgentRequestsRouteLayer({ requests }),
      );
      const scopes = ['read:events', 'read:state', 'read:conversations', 'tell', 'operate'] as const;
      const { token } = await createAccessToken({ name: 'agent:work:agent-pan-1', kind: 'token', scopes: [...scopes], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });

      // The agent's MCP tools call the real routes through the real gate with its agent token.
      const api: DashboardApi = {
        async request(method, path, body) {
          const response = await send(app, method as 'GET' | 'POST', path, bearer(token), body === undefined ? undefined : JSON.stringify(body));
          outputs.push(response);
          return response;
        },
      };
      const client = await connectClient(api, scopes, true);

      const asked = await callTool(client, 'request_secret', { name: 'EVAL_API_KEY', prompt: 'The key for the eval run' });
      outputs.push(asked);
      const { requestId } = resultJson(asked) as { requestId: string };

      const root = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };
      const listed = await send(app, 'GET', '/api/agent-requests', root);
      outputs.push(listed);
      expect((listed.json as { requests: Array<{ id: string }> }).requests.map((row) => row.id)).toEqual([requestId]);

      const answered = await send(app, 'POST', `/api/agent-requests/${requestId}/secret`, root, JSON.stringify({ value: canary }));
      outputs.push(answered);
      expect(answered).toEqual({ status: 200, json: { requestId, status: 'delivered' } });

      const waited = await callTool(client, 'secret_wait', { requestId });
      outputs.push(waited);
      const file = join(home, 'agents', 'agent-pan-1', 'secrets', 'EVAL_API_KEY');
      expect(resultJson(waited)).toEqual({ requestId, status: 'delivered', file });

      expect(await readFile(file, 'utf8')).toBe(canary);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, 'agents', 'agent-pan-1', 'secrets'))).mode & 0o777).toBe(0o700);

      expect(outputs.length).toBeGreaterThanOrEqual(6);
      for (const output of outputs) expect(JSON.stringify(output)).not.toContain(canary);
      expect(JSON.stringify(emitActivityEntryMock.mock.calls)).not.toContain(canary);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
      const delivered = emitActivityEntryMock.mock.calls.filter(([entry]) => String((entry as { message?: unknown }).message).startsWith('Secret '));
      expect(delivered).toEqual([[{ source: 'dashboard', level: 'info', message: 'Secret EVAL_API_KEY delivered to agent-pan-1 · PAN-1' }]]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
