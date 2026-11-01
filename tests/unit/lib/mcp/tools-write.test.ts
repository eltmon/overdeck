/**
 * PAN-4649 W-6: the MCP write tools send the exact route, method and body,
 * and an unknown `machine` stops a start tool before any POST.
 */
import { describe, expect, it } from 'vitest';

import { WRITE_TOOLS } from '../../../../src/lib/mcp/tools-write.js';
import { callTool, connectClient, ENVIRONMENT, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'read:conversations', 'operate'];

describe('MCP write tools (PAN-4649 W-6)', () => {
  it('the write tools are send_message, start_conversation and start_worker', () => {
    expect(WRITE_TOOLS.map((tool) => tool.name)).toEqual(['send_message', 'start_conversation', 'start_worker']);
  });

  it('send_message posts { message } to the encoded conversation message route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv%2Fa/message': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'send_message', { conversation: 'conv/a', message: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv%2Fa/message', body: { message: 'hello' } }]);
  });

  it('start_conversation posts only the given fields and never sends cwd', async () => {
    const api = fakeApi({ 'POST /api/conversations': { status: 200, json: { name: 'conv-new' } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_conversation', { message: 'start', projectKey: 'overdeck', effort: 'high', cwd: '/etc' });
    expect(resultJson(result)).toEqual({ name: 'conv-new' });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations', body: { message: 'start', projectKey: 'overdeck', effort: 'high' } }]);
  });

  it('start_conversation with this machine\'s label checks the environment, then posts', async () => {
    const api = fakeApi({ 'GET /api/environment': ENVIRONMENT, 'POST /api/conversations': { status: 200, json: { name: 'conv-new' } } });
    const client = await connectClient(api, SCOPES);
    await callTool(client, 'start_conversation', { message: 'start', machine: 'desk' });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/environment', 'POST /api/conversations']);
    expect(api.calls[1]?.body).toEqual({ message: 'start' });
  });

  it('start_conversation with an unknown machine is a tool error and makes no POST', async () => {
    const api = fakeApi({ 'GET /api/environment': ENVIRONMENT });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_conversation', { message: 'start', machine: 'laptop' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Unknown machine "laptop". This server can start work only on desk (env-desk-1).');
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('start_worker posts the worker body to POST /api/workers', async () => {
    const api = fakeApi({ 'POST /api/workers': { status: 200, json: { id: 'worker-pan-1-1', cwd: '/w', branch: null } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_worker', { issueId: 'PAN-1', prompt: 'look', model: 'opus', readOnly: true, name: 'scout', machine: 'auto' });
    expect(resultJson(result)).toEqual({ id: 'worker-pan-1-1', cwd: '/w', branch: null });
    expect(api.calls).toEqual([
      { method: 'POST', path: '/api/workers', body: { issueId: 'PAN-1', prompt: 'look', model: 'opus', readOnly: true, name: 'scout' } },
    ]);
  });

  it('start_worker with an unknown machine makes no POST', async () => {
    const api = fakeApi({ 'GET /api/environment': ENVIRONMENT });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_worker', { issueId: 'PAN-1', prompt: 'look', machine: 'laptop' });
    expect(result.isError).toBe(true);
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('start_worker requires issueId and prompt before any request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES);
    expect((await callTool(client, 'start_worker', { prompt: 'look' })).isError).toBe(true);
    expect((await callTool(client, 'start_worker', { issueId: 'PAN-1', prompt: ' ' })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('a 403 from the start route is a tool error naming the missing scope', async () => {
    const api = fakeApi({ 'POST /api/conversations': { status: 403, json: { error: 'insufficient_scope', missingScope: 'operate' } } });
    const client = await connectClient(api, ['read:conversations', 'tell']);
    const result = await callTool(client, 'start_conversation', { message: 'start' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('missingScope: operate');
  });
});
