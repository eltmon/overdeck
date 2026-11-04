/**
 * PAN-4938 (PAN-4927 W-DEL1): the agent-only delegation tools call the self
 * worker routes and pass the route's answer through.
 */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { DELEGATE_TOOLS } from '../../../../src/lib/mcp/tools-delegate.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'operate'];

describe('MCP delegation tools (PAN-4938 W-DEL1)', () => {
  it('every DELEGATE_TOOLS tool is agent-only', () => {
    expect(DELEGATE_TOOLS.length).toBeGreaterThan(0);
    for (const tool of DELEGATE_TOOLS) expect(tool.audience, tool.name).toBe('agent');
  });

  it('delegate_task is hidden from a non-agent token and listed for an agent token with operate', async () => {
    const human = await connectClient(fakeApi({}), SCOPES);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain('delegate_task');
    const agent = await connectClient(fakeApi({}), SCOPES, true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('delegate_task');
  });

  it('delegate_task posts its arguments to POST /api/self/workers', async () => {
    const answer = { workerId: 'agent-pan-1-worker-1', machine: { self: true }, remote: false, reason: null, next: { tool: 'task_wait', arguments: { workerId: 'agent-pan-1-worker-1' } } };
    const api = fakeApi({ 'POST /api/self/workers': { status: 200, json: answer } });
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'delegate_task', { task: 'Run the suite.', model: 'opus', readOnly: true });
    expect(resultJson(result)).toEqual(answer);
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/self/workers', body: { task: 'Run the suite.', model: 'opus', readOnly: true } }]);
  });

  it('delegate_task needs a task before any request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    expect((await callTool(client, 'delegate_task', {})).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('a 409 no-issue answer is an error that names start_conversation', async () => {
    const api = fakeApi({ 'POST /api/self/workers': { status: 409, json: { code: 'no-issue', error: 'delegate_task needs an issue; use start_conversation' } } });
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'delegate_task', { task: 'x' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('delegate_task needs an issue; use start_conversation');
  });

  it('delegate_task needs the self worker route\'s scope', () => {
    const tool = DELEGATE_TOOLS.find((candidate) => candidate.name === 'delegate_task')!;
    expect(tool.scope).toBe(requiredScopeFor('POST', '/api/self/workers'));
  });

  it('task_wait calls the wait route with and without afterSeq and passes running through', async () => {
    const running = { status: 'running', workerId: 'agent-pan-1-worker-1', next: { tool: 'task_wait', arguments: { workerId: 'agent-pan-1-worker-1' } } };
    const api = fakeApi({
      'GET /api/self/workers/agent-pan-1-worker-1/wait?timeoutMs=50000': { status: 200, json: running },
      'GET /api/self/workers/agent-pan-1-worker-1/wait?timeoutMs=50000&afterSeq=2': { status: 200, json: { status: 'done' } },
    });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'task_wait', { workerId: 'agent-pan-1-worker-1' }))).toEqual(running);
    expect(resultJson(await callTool(client, 'task_wait', { workerId: 'agent-pan-1-worker-1', afterSeq: 2 }))).toEqual({ status: 'done' });
    expect(api.calls.map((call) => call.path)).toEqual([
      '/api/self/workers/agent-pan-1-worker-1/wait?timeoutMs=50000',
      '/api/self/workers/agent-pan-1-worker-1/wait?timeoutMs=50000&afterSeq=2',
    ]);
    expect((await callTool(client, 'task_wait', { workerId: 'agent-pan-1-worker-1', afterSeq: -1 })).isError).toBe(true);
  });

  it('task_wait needs the wait route\'s scope', () => {
    const tool = DELEGATE_TOOLS.find((candidate) => candidate.name === 'task_wait')!;
    expect(tool.scope).toBe(requiredScopeFor('GET', '/api/self/workers/x/wait'));
  });

  it('list_workers and task_status call their routes and need their scopes', async () => {
    const api = fakeApi({
      'GET /api/self/workers': { status: 200, json: { workers: [] } },
      'GET /api/self/workers/agent-pan-1-worker-1': { status: 200, json: { id: 'agent-pan-1-worker-1', state: 'running' } },
    });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'list_workers'))).toEqual({ workers: [] });
    expect(resultJson(await callTool(client, 'task_status', { workerId: 'agent-pan-1-worker-1' }))).toEqual({ id: 'agent-pan-1-worker-1', state: 'running' });
    expect(DELEGATE_TOOLS.find((tool) => tool.name === 'list_workers')!.scope).toBe(requiredScopeFor('GET', '/api/self/workers'));
    expect(DELEGATE_TOOLS.find((tool) => tool.name === 'task_status')!.scope).toBe(requiredScopeFor('GET', '/api/self/workers/x'));
  });
});
