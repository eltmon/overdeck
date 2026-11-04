/**
 * PAN-4927 W-MCP1: `tools/list` and `tools/call` show only a caller's visible
 * tools (scope and audience, D-14); a hidden tool answers like an unknown one.
 */
import { describe, expect, it } from 'vitest';

import { jsonResult, type OverdeckTool } from '../../../../src/lib/mcp/tool.js';
import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const agentProbe: OverdeckTool = {
  name: 'agent_probe',
  description: 'probe',
  inputSchema: { type: 'object', properties: {} },
  scope: 'read:state',
  audience: 'agent',
  async run() {
    return jsonResult({ ok: true });
  },
};

describe('MCP tool visibility (PAN-4927 W-MCP1)', () => {
  it('a read:state-only token sees only list_machines', async () => {
    const client = await connectClient(fakeApi({}), ['read:state']);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['list_machines']);
  });

  it('read:state, read:conversations and operate see every tool but the approve tools', async () => {
    const client = await connectClient(fakeApi({}), ['read:state', 'read:conversations', 'operate']);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('answer_question');
    expect(tools.map((tool) => tool.name)).not.toContain('answer_permission');
    expect(tools).toHaveLength(13);
  });

  it('adding approve lists every tool in ALL_TOOLS order', async () => {
    const client = await connectClient(fakeApi({}), ['read:state', 'read:conversations', 'operate', 'approve']);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(ALL_TOOLS.map((tool) => tool.name));
  });

  it('an audience: agent tool is hidden from a non-agent token and visible to an agent token', async () => {
    const tools = [...ALL_TOOLS, agentProbe];
    const api = fakeApi({});

    const humanClient = await connectClient(api, ['read:state'], false, tools);
    const humanList = await humanClient.listTools();
    expect(humanList.tools.map((t) => t.name)).not.toContain('agent_probe');
    const humanCall = await callTool(humanClient, 'agent_probe');
    expect(humanCall.isError).toBe(true);
    expect(resultText(humanCall)).toBe('Unknown tool agent_probe');

    const agentClient = await connectClient(api, ['read:state'], true, tools);
    const agentList = await agentClient.listTools();
    expect(agentList.tools.map((t) => t.name)).toContain('agent_probe');
    expect(resultJson(await callTool(agentClient, 'agent_probe'))).toEqual({ ok: true });
  });

  it('a hidden real tool answers Unknown tool and makes no dashboard request', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['read:conversations']);
    const result = await callTool(client, 'answer_permission', { conversation: 'c', signature: 's', choice: 'deny' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Unknown tool answer_permission');
    expect(api.calls).toEqual([]);
  });
});
