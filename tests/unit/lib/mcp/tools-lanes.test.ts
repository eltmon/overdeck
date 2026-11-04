/**
 * PAN-4938 (PAN-4927 W-DEL1, D-11, D-13): the agent-only lane tools call the
 * lane routes and are listed only to agent tokens.
 */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { LANE_TOOLS } from '../../../../src/lib/mcp/tools-lanes.js';
import { callTool, connectClient, fakeApi, resultJson } from './harness.js';

const SCOPES = ['read:state', 'operate', 'tell'];
const ROUTES: Record<string, { method: string; path: string }> = {
  lane_start: { method: 'POST', path: '/api/self/lanes' },
  lane_status: { method: 'GET', path: '/api/lanes/abc-builder-1' },
  lane_stop: { method: 'POST', path: '/api/lanes/abc-builder-1/stop' },
  lane_wait: { method: 'POST', path: '/api/self/lanes/wait' },
  lane_report: { method: 'POST', path: '/api/self/lanes/report' },
};

describe('MCP lane tools (PAN-4938 W-DEL1)', () => {
  it('every LANE_TOOLS tool is agent-only, hidden from a non-agent token and listed to an agent token', async () => {
    for (const tool of LANE_TOOLS) expect(tool.audience, tool.name).toBe('agent');
    const human = await connectClient(fakeApi({}), SCOPES);
    const humanNames = (await human.listTools()).tools.map((tool) => tool.name);
    const agent = await connectClient(fakeApi({}), SCOPES, true);
    const agentNames = (await agent.listTools()).tools.map((tool) => tool.name);
    for (const name of Object.keys(ROUTES)) {
      expect(humanNames).not.toContain(name);
      expect(agentNames).toContain(name);
    }
  });

  it('a read:state-only non-agent token still lists only list_machines', async () => {
    const client = await connectClient(fakeApi({}), ['read:state']);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['list_machines']);
  });

  it('each lane tool\'s scope equals its route\'s', () => {
    for (const [name, route] of Object.entries(ROUTES)) {
      expect(LANE_TOOLS.find((tool) => tool.name === name)!.scope, name).toBe(requiredScopeFor(route.method, route.path));
    }
  });

  it('lane_start posts its arguments without parent or force to POST /api/self/lanes', async () => {
    const api = fakeApi({ 'POST /api/self/lanes': { status: 201, json: { conversation: { name: 'abc-builder-1' } } } });
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'lane_start', { role: 'builder', brief: 'Build it.', key: 'k', run: 'r', parent: 'other', force: true });
    expect(resultJson(result)).toEqual({ conversation: { name: 'abc-builder-1' } });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/self/lanes', body: { role: 'builder', brief: 'Build it.', key: 'k', run: 'r' } }]);
  });

  it('lane_status and lane_stop call the lane routes', async () => {
    const api = fakeApi({
      'GET /api/lanes/abc-builder-1': { status: 200, json: { name: 'abc-builder-1' } },
      'POST /api/lanes/abc-builder-1/stop': { status: 200, json: { stopped: true } },
    });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'lane_status', { lane: 'abc-builder-1' }))).toEqual({ name: 'abc-builder-1' });
    expect(resultJson(await callTool(client, 'lane_stop', { lane: 'abc-builder-1' }))).toEqual({ stopped: true });
    expect(api.calls).toEqual([
      { method: 'GET', path: '/api/lanes/abc-builder-1' },
      { method: 'POST', path: '/api/lanes/abc-builder-1/stop', body: {} },
    ]);
  });

  it('lane_wait posts run and after with a 50 s timeout and passes running through', async () => {
    const running = { status: 'running', cursor: '', warnings: [], next: { tool: 'lane_wait', arguments: { run: 'r' } } };
    const api = fakeApi({ 'POST /api/self/lanes/wait': { status: 200, json: running } });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'lane_wait', { run: 'r', after: '1.a.1' }))).toEqual(running);
    expect(resultJson(await callTool(client, 'lane_wait'))).toEqual(running);
    expect(api.calls).toEqual([
      { method: 'POST', path: '/api/self/lanes/wait', body: { timeoutMs: 50_000, run: 'r', after: '1.a.1' } },
      { method: 'POST', path: '/api/self/lanes/wait', body: { timeoutMs: 50_000 } },
    ]);
  });

  it('lane_report posts the report, status, verdict and defects', async () => {
    const api = fakeApi({ 'POST /api/self/lanes/report': { status: 200, json: { status: 'done', exitCode: 0 } } });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'lane_report', { report: '# Verdict', verdict: 'DEFECTS', defects: 3 }))).toEqual({ status: 'done', exitCode: 0 });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/self/lanes/report', body: { report: '# Verdict', verdict: 'DEFECTS', defects: 3 } }]);
    expect((await callTool(client, 'lane_report', { report: 'r', defects: -1 })).isError).toBe(true);
  });
});
