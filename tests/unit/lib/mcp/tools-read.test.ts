/**
 * PAN-4649 W-5: the MCP tool module core and its read tools, driven through an
 * SDK client over an in-memory transport with a fake dashboard API.
 */
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';
import { READ_TOOLS, resolveMachine } from '../../../../src/lib/mcp/tools-read.js';
import { callTool, connectClient, ENVIRONMENT, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'read:conversations', 'operate'];

describe('MCP read tools (PAN-4649 W-5)', () => {
  it('the read tools are exactly the four FR-5 read rows, listed first by tools/list', async () => {
    expect(READ_TOOLS.map((tool) => tool.name)).toEqual(['list_machines', 'list_conversations', 'search_conversations', 'read_conversation']);
    const client = await connectClient(fakeApi({}), SCOPES);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(ALL_TOOLS.map((tool) => tool.name));
    expect(tools.slice(0, READ_TOOLS.length).map((tool) => tool.name)).toEqual(READ_TOOLS.map((tool) => tool.name));
  });

  it('list_machines returns this machine only', async () => {
    const client = await connectClient(fakeApi({ 'GET /api/environment': ENVIRONMENT }), SCOPES);
    expect(resultJson(await callTool(client, 'list_machines'))).toEqual([
      { environmentId: 'env-desk-1', label: 'desk', platform: { os: 'linux', arch: 'x64' }, serverVersion: '1.2.3', thisMachine: true },
    ]);
  });

  it('list_conversations calls GET /api/conversations?limit=50 and returns only projected keys', async () => {
    const api = fakeApi({
      'GET /api/conversations?limit=50': {
        status: 200,
        json: [{ name: 'conv-a', title: 'Alpha', harness: 'claude-code', status: 'active', cwd: '/home/x', totalCost: 3, sessionAlive: true, pendingInputCount: 1 }],
      },
    });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'list_conversations');
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/conversations?limit=50' }]);
    expect(resultJson(result)).toEqual([{ name: 'conv-a', title: 'Alpha', harness: 'claude-code', status: 'active', sessionAlive: true, pendingInputCount: 1 }]);
  });

  it('list_conversations rejects an out-of-range limit before any request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'list_conversations', { limit: 500 });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('turns a 403 route answer into a tool error naming the missing scope', async () => {
    const api = fakeApi({ 'GET /api/conversations?limit=50': { status: 403, json: { error: 'insufficient_scope', missingScope: 'read:conversations' } } });
    const client = await connectClient(api, ['read:state']);
    const result = await callTool(client, 'list_conversations');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HTTP 403: insufficient_scope');
    expect(resultText(result)).toContain('missingScope: read:conversations');
  });

  it('search_conversations returns the conversations array only', async () => {
    const api = fakeApi({
      'GET /api/palette/search?q=deploy+fix&limit=20': { status: 200, json: { conversations: [{ name: 'conv-b' }], memory: [{ id: 'm1' }] } },
    });
    const client = await connectClient(api, SCOPES);
    expect(resultJson(await callTool(client, 'search_conversations', { query: 'deploy fix' }))).toEqual([{ name: 'conv-b' }]);
  });

  it('search_conversations requires a query', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'search_conversations', {});
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('query');
    expect(api.calls).toEqual([]);
  });

  it('read_conversation encodes the name and passes before and limit only when given', async () => {
    const api = fakeApi({
      'GET /api/conversations/my%20conv/messages': { status: 200, json: { messages: [] } },
      'GET /api/conversations/my%20conv/messages?before=cur-1&limit=10': { status: 200, json: { messages: [{ id: 1 }] } },
    });
    const client = await connectClient(api, SCOPES);
    expect(resultJson(await callTool(client, 'read_conversation', { conversation: 'my conv' }))).toEqual({ messages: [] });
    expect(resultJson(await callTool(client, 'read_conversation', { conversation: 'my conv', before: 'cur-1', limit: 10 }))).toEqual({ messages: [{ id: 1 }] });
  });

  it('an unknown tool name is a tool error', async () => {
    const client = await connectClient(fakeApi({}), SCOPES);
    const result = await callTool(client, 'pair_device');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Unknown tool pair_device');
  });

  it('resolveMachine accepts auto, the label and the id, and refuses any other machine by name', async () => {
    const api = fakeApi({ 'GET /api/environment': ENVIRONMENT });
    await expect(resolveMachine(api)).resolves.toEqual({ ok: true });
    await expect(resolveMachine(api, 'auto')).resolves.toEqual({ ok: true });
    await expect(resolveMachine(api, 'desk')).resolves.toEqual({ ok: true });
    await expect(resolveMachine(api, 'env-desk-1')).resolves.toEqual({ ok: true });
    await expect(resolveMachine(api, 'laptop')).resolves.toEqual({
      ok: false,
      error: 'Unknown machine "laptop". This server can start work only on desk (env-desk-1).',
    });
  });
});
