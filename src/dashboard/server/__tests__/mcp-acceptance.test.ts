/**
 * PAN-4649 W-10: end-to-end acceptance for the MCP server, the issue's done
 * criterion. The app is the real remote request gate, the real `/mcp` route
 * and stub dashboard routes that record their calls. The route's dashboard
 * API dispatches back into the same app with the caller's Bearer token, so
 * every tool call passes through the real gate and the real route-scope table.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DashboardApiResponse } from '../../../lib/mcp/dashboard-api.js';

const INTERNAL_TOKEN = 'mcp-acceptance-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4649-mcp-acceptance-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');
const { MCP_DEFAULT_SCOPES } = await import('../../../lib/mcp/server.js');
const { jsonResponse } = await import('../http-helpers.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makeMcpRouteLayer } = await import('../routes/mcp.js');

interface StubCall {
  route: string;
  body: unknown;
}
const stubCalls: StubCall[] = [];

function stub(method: 'GET' | 'POST' | 'PUT', path: string, answer: unknown) {
  return HttpRouter.add(method, path, Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = method === 'GET' ? '' : yield* Effect.orDie(request.text);
    stubCalls.push({ route: `${method} ${path}`, body: text ? JSON.parse(text) : null });
    return jsonResponse(answer);
  }));
}

const stubs = Layer.mergeAll(
  stub('GET', '/api/environment', { environmentId: 'env-desk-1', label: 'desk', platform: { os: 'linux', arch: 'x64' }, serverVersion: '1.2.3' }),
  stub('GET', '/api/conversations', [{ name: 'conv-a', title: 'Alpha', status: 'active' }, { name: 'conv-b', title: 'Beta', status: 'ended' }]),
  stub('POST', '/api/conversations/:name/message', { ok: true }),
  stub('POST', '/api/conversations', { name: 'conv-new' }),
  stub('POST', '/api/fleet/conversations', { conversation: 'conv-new', machine: { environmentId: 'env-desk-1', label: 'desk', self: true }, reason: null }),
  stub('GET', '/api/conversations/:id', { name: 'conv-a', harness: 'claude-code' }),
  stub('POST', '/api/conversations/:id/permission', { ok: true }),
  stub('PUT', '/api/settings', { ok: true }),
  // PAN-4944 (PAN-4927 W-APPR1, AC-15): the fleet-wide pending list and every answer tool's route.
  stub('GET', '/api/needs-you', { conversations: [{ name: 'conv-a', pendingPaneChoice: { signature: 'sig-1' } }], agents: [] }),
  stub('GET', '/api/fleet/needs-you', {
    machines: [{ environmentId: 'env-lap-2', label: 'laptop', conversations: [{ name: 'conv-z', pendingAskUserQuestion: { toolUseId: 't9' } }], agents: [] }],
  }),
  stub('POST', '/api/conversations/:id/pane-choice', { ok: true }),
  stub('POST', '/api/conversations/:id/codex-approval', { ok: true }),
  stub('POST', '/api/conversations/:id/pi-ask-answer', { ok: true }),
  stub('POST', '/api/conversations/:name/plan-action', { ok: true }),
  stub('POST', '/api/agents/:id/answer-question', { ok: true }),
  stub('POST', '/api/agents/:id/plan-action', { ok: true }),
  stub('POST', '/api/agents/:id/permissions/:requestId/respond', { ok: true }),
);

interface Sent {
  status: number;
  json: unknown;
}

async function send(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Sent> {
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers, body }))
    .modify({ remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: raw.status, json };
}

const app: Layer.Layer<never, never, never> = Layer.mergeAll(
  remoteRequestGateLayer,
  stubs,
  makeMcpRouteLayer({
    makeApi: (token) => ({
      async request(method, path, body): Promise<DashboardApiResponse> {
        const headers: Record<string, string> = { authorization: `Bearer ${token}` };
        if (method === 'POST') headers['content-type'] = 'application/json';
        return send(method, path, headers, method === 'POST' ? JSON.stringify(body ?? {}) : undefined);
      },
    }),
  }),
) as Layer.Layer<never, never, never>;

let rpcId = 0;
async function rpc(token: string, method: string, params: Record<string, unknown>) {
  rpcId += 1;
  const response = await send('POST', '/mcp', {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  }, JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }));
  expect(response.status).toBe(200);
  return (response.json as { result: Record<string, unknown> }).result;
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const result = (await rpc(token, 'tools/call', { name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: result.isError === true, text: result.content[0]?.text ?? '' };
}

async function mintToken(scopes: string[]): Promise<string> {
  const { token } = await createAccessToken({ name: 'mcp-client', scopes: scopes as never, kind: 'token' });
  return token;
}

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  stubCalls.length = 0;
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('MCP acceptance with the default MCP scopes (PAN-4649 W-10)', () => {
  it('list_conversations returns this machine\'s conversations through the gate', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const result = await callTool(token, 'list_conversations');
    expect(result.isError).toBe(false);
    expect((JSON.parse(result.text) as Array<{ name: string }>).map((row) => row.name)).toEqual(['conv-a', 'conv-b']);
  });

  it('send_message reaches the message route with the given text', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const result = await callTool(token, 'send_message', { conversation: 'conv-a', message: 'status please' });
    expect(result.isError).toBe(false);
    expect(stubCalls).toEqual([{ route: 'POST /api/conversations/:name/message', body: { message: 'status please' } }]);
  });

  it('the same token gets 403 insufficient_scope on PUT /api/settings', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const response = await send('PUT', '/api/settings', { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, '{}');
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'insufficient_scope', missingScope: 'admin' });
    expect(stubCalls).toEqual([]);
  });

  it('tools/list offers no settings, pairing, token, device or vault tool', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const { tools } = (await rpc(token, 'tools/list', {})) as { tools: Array<{ name: string }> };
    for (const tool of tools) {
      for (const forbidden of ['settings', 'pair', 'token', 'device', 'vault']) {
        expect(tool.name, tool.name).not.toContain(forbidden);
      }
    }
  });

  it('answer_permission is hidden without approve and reaches the route with it', async () => {
    const args = { conversation: 'conv-a', signature: 'sig-1', choice: 'allow-once' };
    const refused = await callTool(await mintToken([...MCP_DEFAULT_SCOPES]), 'answer_permission', args);
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe('Unknown tool answer_permission');
    expect(stubCalls).toEqual([]);

    const allowed = await callTool(await mintToken([...MCP_DEFAULT_SCOPES, 'approve']), 'answer_permission', args);
    expect(allowed.isError).toBe(false);
    expect(stubCalls).toEqual([{ route: 'POST /api/conversations/:id/permission', body: { signature: 'sig-1', choice: 'allow-once' } }]);
  });

  it('start_conversation reaches POST /api/fleet/conversations under operate (PAN-4651)', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const result = await callTool(token, 'start_conversation', { message: 'begin' });
    expect(result.isError).toBe(false);
    expect(stubCalls).toEqual([{ route: 'POST /api/fleet/conversations', body: { message: 'begin' } }]);
  });

  it('PAN-4651 ac29: a linked conversation\'s permission prompt is hidden without approve, before any forward', async () => {
    const refused = await callTool(await mintToken([...MCP_DEFAULT_SCOPES]), 'answer_permission', { conversation: '@desk/conv-a', signature: 'sig-1', choice: 'allow-once' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe('Unknown tool answer_permission');
    expect(stubCalls).toEqual([]);
  });
});

describe('MCP acceptance: every new answer tool through the real gate (PAN-4944 AC-15)', () => {
  const CASES: Array<{ name: string; args: Record<string, unknown>; route: string; body: unknown }> = [
    { name: 'answer_pane_choice', args: { conversation: 'conv-a', selectedIndex: 0, signature: 'sig-1' }, route: 'POST /api/conversations/:id/pane-choice', body: { selectedIndex: 0, signature: 'sig-1' } },
    { name: 'answer_codex_approval', args: { conversation: 'conv-a', optionNumber: 1 }, route: 'POST /api/conversations/:id/codex-approval', body: { optionNumber: 1 } },
    { name: 'answer_pi_ask', args: { conversation: 'conv-a', toolUseId: 't1', answers: ['Yes'] }, route: 'POST /api/conversations/:id/pi-ask-answer', body: { toolUseId: 't1', answers: ['Yes'] } },
    { name: 'answer_plan', args: { conversation: 'conv-a', action: 'approve-auto' }, route: 'POST /api/conversations/:name/plan-action', body: { action: 'approve-auto' } },
    { name: 'answer_agent_plan', args: { agentId: 'agent-pan-1', action: 'approve-auto' }, route: 'POST /api/agents/:id/plan-action', body: { action: 'approve-auto' } },
    { name: 'answer_agent_permission', args: { agentId: 'agent-pan-1', requestId: 'req-1', behavior: 'allow' }, route: 'POST /api/agents/:id/permissions/:requestId/respond', body: { behavior: 'allow' } },
    { name: 'answer_question', args: { agentId: 'agent-pan-1', answers: ['Yes'] }, route: 'POST /api/agents/:id/answer-question', body: { answers: ['Yes'] } },
  ];

  it.each(CASES)('$name is hidden without approve and reaches its route with it', async ({ name, args, route, body }) => {
    const refused = await callTool(await mintToken([...MCP_DEFAULT_SCOPES]), name, args);
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`Unknown tool ${name}`);
    expect(stubCalls).toEqual([]);

    const allowed = await callTool(await mintToken([...MCP_DEFAULT_SCOPES, 'approve']), name, args);
    expect(allowed.isError).toBe(false);
    expect(stubCalls).toEqual([{ route, body }]);
  });

  it('list_pending_input returns this machine plus the linked machine, with the linked conversation renamed', async () => {
    const token = await mintToken([...MCP_DEFAULT_SCOPES]);
    const result = await callTool(token, 'list_pending_input');
    expect(result.isError).toBe(false);
    const { machines } = JSON.parse(result.text) as { machines: Array<{ environmentId: string | null; conversations: Array<{ name: string }> }> };
    expect(machines).toHaveLength(2);
    expect(machines[1]?.conversations.map((c) => c.name)).toEqual(['@env-lap-2/conv-z']);
  });
});
