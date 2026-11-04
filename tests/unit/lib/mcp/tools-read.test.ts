/**
 * PAN-4649 W-5: the MCP tool module core and its read tools, driven through an
 * SDK client over an in-memory transport with a fake dashboard API.
 */
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';
import { READ_TOOLS } from '../../../../src/lib/mcp/tools-read.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'read:conversations', 'operate'];

describe('MCP read tools (PAN-4649 W-5)', () => {
  it('the read tools are exactly the four FR-5 read rows, listed first by tools/list', async () => {
    expect(READ_TOOLS.map((tool) => tool.name)).toEqual(['list_machines', 'list_conversations', 'search_conversations', 'read_conversation']);
    const client = await connectClient(fakeApi({}), [...SCOPES, 'approve']);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(ALL_TOOLS.filter((tool) => tool.audience === 'any').map((tool) => tool.name));
    expect(tools.slice(0, READ_TOOLS.length).map((tool) => tool.name)).toEqual(READ_TOOLS.map((tool) => tool.name));
  });

  it('PAN-4651 ac29: list_machines returns this machine and a linked one with its state', async () => {
    const machines = [
      { environmentId: 'env-desk-1', label: 'desk', thisMachine: true, state: 'online', load: null, tags: ['linux'] },
      { environmentId: 'env-laptop', label: 'laptop', thisMachine: false, state: 'offline', load: null, tags: [] },
    ];
    const api = fakeApi({ 'GET /api/fleet/machines': { status: 200, json: machines } });
    const client = await connectClient(api, SCOPES);
    expect(resultJson(await callTool(client, 'list_machines'))).toEqual(machines);
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/fleet/machines' }]);
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
    const client = await connectClient(api, ['read:conversations']);
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

  it('PAN-4651: search_conversations merges the linked machines\' hits with their machine label', async () => {
    const api = fakeApi({
      'GET /api/palette/search?q=cache&limit=20': { status: 200, json: { conversations: [{ conversationId: 'conv-b' }] } },
      'GET /api/fleet/search?q=cache&limit=20': { status: 200, json: { machines: [{ label: 'laptop', conversations: [{ conversationId: '@env-laptop/conv-z' }] }] } },
    });
    const client = await connectClient(api, SCOPES);
    expect(resultJson(await callTool(client, 'search_conversations', { query: 'cache' }))).toEqual([
      { conversationId: 'conv-b' }, { conversationId: '@env-laptop/conv-z', machineLabel: 'laptop' },
    ]);
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
});
