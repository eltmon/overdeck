/**
 * PAN-4649 W-6: the MCP write tools send the exact route, method and body,
 * and an unknown `machine` stops a start tool before any POST.
 */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { WRITE_TOOLS } from '../../../../src/lib/mcp/tools-write.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'read:conversations', 'operate'];

describe('MCP write tools (PAN-4649 W-6)', () => {
  it('the write tools are send_message, start_conversation, start_worker and start_issue', () => {
    expect(WRITE_TOOLS.map((tool) => tool.name)).toEqual(['send_message', 'start_conversation', 'start_worker', 'start_issue']);
  });

  it('PAN-4938: start_issue posts the given fields to the fleet issue-start route', async () => {
    const api = fakeApi({ 'POST /api/fleet/issues/PAN-1/start': { status: 200, json: { issueId: 'PAN-1', agentId: 'agent-pan-1', machine: { self: true }, reason: null } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_issue', { issueId: 'PAN-1', model: 'opus', machine: 'auto', needs: ['docker'] });
    expect(resultJson(result)).toMatchObject({ issueId: 'PAN-1', agentId: 'agent-pan-1' });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/fleet/issues/PAN-1/start', body: { model: 'opus', machine: 'auto', needs: ['docker'] } }]);
  });

  it('PAN-4938: a 422 start_issue answer tells the caller to plan first', async () => {
    const api = fakeApi({ 'POST /api/fleet/issues/PAN-1/start': { status: 422, json: { error: 'PAN-1 has no readable plan' } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_issue', { issueId: 'PAN-1' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('HTTP 422: PAN-1 has no readable plan. If PAN-1 is not planned yet, run pan start PAN-1, which plans first.');
    expect(resultText(result).endsWith('which plans first.')).toBe(true);
  });

  it('PAN-4938: start_issue needs the issue-start route\'s scope and is listed to any token', () => {
    const tool = WRITE_TOOLS.find((candidate) => candidate.name === 'start_issue')!;
    expect(tool.scope).toBe(requiredScopeFor('POST', '/api/fleet/issues/PAN-1/start'));
    expect(tool.audience).toBe('any');
  });

  it('send_message posts { message } to the encoded conversation message route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv%2Fa/message': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'send_message', { conversation: 'conv/a', message: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv%2Fa/message', body: { message: 'hello' } }]);
  });

  it('PAN-4651 ac29: send_message with @desk/conv-a posts to the linked conversation through the proxy', async () => {
    const api = fakeApi({ 'POST /api/conversations/%40desk%2Fconv-a/message': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, SCOPES);
    expect((await callTool(client, 'send_message', { conversation: '@desk/conv-a', message: 'hi' })).isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/%40desk%2Fconv-a/message', body: { message: 'hi' } }]);
  });

  it('start_conversation posts only the given fields to the fleet route and never sends cwd', async () => {
    const api = fakeApi({ 'POST /api/fleet/conversations': { status: 201, json: { conversation: 'conv-new', machine: { label: 'desk' }, reason: null } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_conversation', { message: 'start', projectKey: 'overdeck', effort: 'high', cwd: '/etc' });
    expect(resultJson(result)).toEqual({ conversation: 'conv-new', machine: { label: 'desk' }, reason: null });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/fleet/conversations', body: { message: 'start', projectKey: 'overdeck', effort: 'high' } }]);
  });

  it('start_conversation passes machine and needs to the fleet route, which resolves them', async () => {
    const api = fakeApi({ 'POST /api/fleet/conversations': { status: 201, json: { conversation: '@env-laptop/conv-x' } } });
    const client = await connectClient(api, SCOPES);
    await callTool(client, 'start_conversation', { message: 'start', machine: 'auto', needs: ['docker'] });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/fleet/conversations', body: { message: 'start', machine: 'auto', needs: ['docker'] } }]);
    const refused = await callTool(client, 'start_conversation', { message: 'start', needs: 'docker' });
    expect(refused.isError).toBe(true);
  });

  it('a fleet refusal (unknown machine) is a tool error', async () => {
    const api = fakeApi({ 'POST /api/fleet/conversations': { status: 404, json: { code: 'unknown-machine', error: 'No linked machine is called laptop' } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_conversation', { message: 'start', machine: 'laptop' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('No linked machine is called laptop');
  });

  it('PAN-4651 ac29: start_worker with machine auto posts the worker body to POST /api/fleet/workers', async () => {
    const api = fakeApi({ 'POST /api/fleet/workers': { status: 200, json: { id: 'agent-pan-1-worker-1', machine: { label: 'desk' }, reason: 'Auto → desk', remote: false } } });
    const client = await connectClient(api, SCOPES);
    const result = await callTool(client, 'start_worker', { issueId: 'PAN-1', prompt: 'look', model: 'opus', readOnly: true, name: 'scout', machine: 'auto' });
    expect(resultJson(result)).toMatchObject({ id: 'agent-pan-1-worker-1', remote: false });
    expect(api.calls).toEqual([
      { method: 'POST', path: '/api/fleet/workers', body: { issueId: 'PAN-1', prompt: 'look', model: 'opus', readOnly: true, name: 'scout', machine: 'auto' } },
    ]);
  });

  it('start_worker requires issueId and prompt before any request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES);
    expect((await callTool(client, 'start_worker', { prompt: 'look' })).isError).toBe(true);
    expect((await callTool(client, 'start_worker', { issueId: 'PAN-1', prompt: ' ' })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('a 403 from the start route is a tool error naming the missing scope', async () => {
    const api = fakeApi({ 'POST /api/fleet/conversations': { status: 403, json: { error: 'insufficient_scope', missingScope: 'operate' } } });
    const client = await connectClient(api, ['read:conversations', 'operate']);
    const result = await callTool(client, 'start_conversation', { message: 'start' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('missingScope: operate');
  });
});
