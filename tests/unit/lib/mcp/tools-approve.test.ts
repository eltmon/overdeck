/**
 * PAN-4649 W-7: the MCP approval tools. `answer_question` checks `approve`
 * itself and serves Claude Code conversations only; `answer_permission`
 * validates the choice before any request.
 */
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';
import {
  AGENT_ON_LINKED_MACHINE_TEXT,
  APPROVE_TOOLS,
  MISSING_APPROVE_TEXT,
  NOT_CLAUDE_CODE_CODEX_TEXT,
  NOT_CLAUDE_CODE_PI_TEXT,
  NOT_CLAUDE_CODE_TEXT,
} from '../../../../src/lib/mcp/tools-approve.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const APPROVER = ['approve', 'tell', 'read:conversations'];

describe('MCP approval tools (PAN-4649 W-7)', () => {
  it('the approval tools close the list, making twenty-one tools in all', () => {
    expect(APPROVE_TOOLS.map((tool) => tool.name)).toEqual([
      'list_pending_input', 'answer_question', 'answer_permission',
      'answer_pane_choice', 'answer_codex_approval', 'answer_pi_ask', 'answer_plan',
      'answer_agent_plan', 'answer_agent_permission',
    ]);
    expect(ALL_TOOLS.map((tool) => tool.name)).toEqual([
      'list_machines', 'list_conversations', 'search_conversations', 'read_conversation',
      'send_message', 'start_conversation', 'start_worker',
      'schedule_message', 'schedule_recurring', 'list_scheduled', 'update_scheduled', 'delete_scheduled',
      'list_pending_input', 'answer_question', 'answer_permission',
      'answer_pane_choice', 'answer_codex_approval', 'answer_pi_ask', 'answer_plan',
      'answer_agent_plan', 'answer_agent_permission',
    ]);
  });

  it('list_pending_input merges this machine and one linked machine, renaming the linked rows', async () => {
    const api = fakeApi({
      'GET /api/needs-you': { status: 200, json: { conversations: [{ name: 'conv-a' }], agents: [{ id: 'agent-pan-1', pendingInputKinds: ['askUserQuestion'] }] } },
      'GET /api/fleet/needs-you': {
        status: 200,
        json: { machines: [{ environmentId: 'env-lap-2', label: 'laptop', conversations: [{ name: 'conv-z' }], agents: [{ id: 'agent-pan-9' }] }] },
      },
    });
    const client = await connectClient(api, APPROVER);
    expect(resultJson(await callTool(client, 'list_pending_input'))).toEqual({
      machines: [
        { environmentId: null, label: 'this machine', conversations: [{ name: 'conv-a' }], agents: [{ id: 'agent-pan-1', pendingInputKinds: ['askUserQuestion'] }] },
        { environmentId: 'env-lap-2', label: 'laptop', conversations: [{ name: '@env-lap-2/conv-z' }], agents: [{ id: '@env-lap-2/agent-pan-9', remote: true }] },
      ],
    });
  });

  it('list_pending_input keeps the local entry and sets fleetError on a fleet 503', async () => {
    const api = fakeApi({
      'GET /api/needs-you': { status: 200, json: { conversations: [], agents: [] } },
      'GET /api/fleet/needs-you': { status: 503, json: { error: 'fleet down' } },
    });
    const client = await connectClient(api, APPROVER);
    const result = resultJson(await callTool(client, 'list_pending_input')) as { machines: unknown[]; fleetError: string };
    expect(result.machines).toEqual([{ environmentId: null, label: 'this machine', conversations: [], agents: [] }]);
    expect(result.fleetError).toBe('HTTP 503: fleet down');
  });

  it('list_pending_input sets fleetError to the error message when the fleet request throws', async () => {
    const api = fakeApi({ 'GET /api/needs-you': { status: 200, json: { conversations: [], agents: [] } } });
    const throwingApi = { ...api, request: ((method: string, path: string, body?: unknown) => (
      path === '/api/fleet/needs-you' ? Promise.reject(new Error('network down')) : api.request(method as 'GET', path, body)
    )) as typeof api.request };
    const client = await connectClient(throwingApi, APPROVER);
    const result = resultJson(await callTool(client, 'list_pending_input')) as { fleetError: string };
    expect(result.fleetError).toBe('network down');
  });

  it('list_pending_input is a tool error when the local feed answers 500', async () => {
    const api = fakeApi({ 'GET /api/needs-you': { status: 500, json: { error: 'the Needs-You feed could not be built' } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'list_pending_input');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('HTTP 500: the Needs-You feed could not be built');
  });

  it('answer_question without approve is hidden, so tools/call answers like an unknown tool', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['read:conversations', 'operate']);
    const result = await callTool(client, 'answer_question', { conversation: 'conv-a', answers: ['Yes'] });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Unknown tool answer_question');
    expect(api.calls).toEqual([]);
  });

  it('answer_question still checks approve itself when called directly, as defense in depth (D-3)', async () => {
    const api = fakeApi({});
    const answerQuestion = APPROVE_TOOLS.find((tool) => tool.name === 'answer_question')!;
    const result = await answerQuestion.run({ conversation: 'conv-a', answers: ['Yes'] }, { api, scopes: ['read:conversations', 'operate'], isAgent: false });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(MISSING_APPROVE_TEXT);
    expect(api.calls).toEqual([]);
  });

  it('answer_question with approve posts the composed message to a Claude Code conversation', async () => {
    const api = fakeApi({
      'GET /api/conversations/conv-a': { status: 200, json: { name: 'conv-a', harness: 'claude-code' } },
      'POST /api/conversations/conv-a/message': { status: 200, json: { ok: true } },
    });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_question', { conversation: 'conv-a', answers: ['Postgres', 'Yes'], questions: ['Which database?'] });
    expect(result.isError).toBeFalsy();
    expect(api.calls[1]).toEqual({
      method: 'POST',
      path: '/api/conversations/conv-a/message',
      body: { message: 'Operator answered the pending questions:\n\nQ: Which database?\nA: Postgres\n\nQ: Question 2\nA: Yes' },
    });
  });

  it('answer_question refuses a codex conversation, naming answer_codex_approval', async () => {
    const api = fakeApi({ 'GET /api/conversations/conv-c': { status: 200, json: { name: 'conv-c', harness: 'codex' } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_question', { conversation: 'conv-c', answers: ['Yes'] });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(NOT_CLAUDE_CODE_CODEX_TEXT);
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('answer_question refuses an ohmypi (Pi) conversation, naming answer_pi_ask', async () => {
    const api = fakeApi({ 'GET /api/conversations/conv-p': { status: 200, json: { name: 'conv-p', harness: 'ohmypi' } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_question', { conversation: 'conv-p', answers: ['Yes'] });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(NOT_CLAUDE_CODE_PI_TEXT);
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('answer_question treats a missing harness as Claude Code and refuses an unrecognized one', async () => {
    const api = fakeApi({
      'GET /api/conversations/conv-old': { status: 200, json: { name: 'conv-old', harness: null } },
      'POST /api/conversations/conv-old/message': { status: 200, json: { ok: true } },
      'GET /api/conversations/conv-x': { status: 200, json: { name: 'conv-x', harness: 'mystery' } },
    });
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_question', { conversation: 'conv-old', answers: ['Yes'] })).isError).toBeFalsy();
    const refused = await callTool(client, 'answer_question', { conversation: 'conv-x', answers: ['Yes'] });
    expect(resultText(refused)).toBe(NOT_CLAUDE_CODE_TEXT);
    expect(api.calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/api/conversations/conv-old/message']);
  });

  it('answer_permission with an unknown choice posts nothing', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_permission', { conversation: 'conv-a', signature: 'sig-1', choice: 'maybe' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_permission posts { signature, choice } to the permission route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/permission': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_permission', { conversation: 'conv-a', signature: 'sig-1', choice: 'allow-once' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/permission', body: { signature: 'sig-1', choice: 'allow-once' } }]);
  });

  it('answer_pane_choice posts { selectedIndex, signature } to the pane-choice route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/pane-choice': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_pane_choice', { conversation: 'conv-a', selectedIndex: 1, signature: 'sig' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/pane-choice', body: { selectedIndex: 1, signature: 'sig' } }]);
  });

  it('answer_pane_choice encodes a linked conversation name as one path segment', async () => {
    const api = fakeApi({ 'POST /api/conversations/%40desk%2Fconv-a/pane-choice': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_pane_choice', { conversation: '@desk/conv-a', selectedIndex: 0, signature: 'sig' });
    expect(result.isError).toBeFalsy();
    expect(api.calls[0]?.path).toBe('/api/conversations/%40desk%2Fconv-a/pane-choice');
  });

  it('answer_pane_choice makes zero requests for an out-of-range index or a missing signature', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_pane_choice', { conversation: 'conv-a', selectedIndex: 9, signature: 'sig' })).isError).toBe(true);
    expect((await callTool(client, 'answer_pane_choice', { conversation: 'conv-a', selectedIndex: 1 })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_codex_approval posts { optionNumber } with toolUseId when given, else without it', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/codex-approval': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_codex_approval', { conversation: 'conv-a', optionNumber: 2, toolUseId: 't1' })).isError).toBeFalsy();
    expect((await callTool(client, 'answer_codex_approval', { conversation: 'conv-a', optionNumber: 3 })).isError).toBeFalsy();
    expect(api.calls).toEqual([
      { method: 'POST', path: '/api/conversations/conv-a/codex-approval', body: { optionNumber: 2, toolUseId: 't1' } },
      { method: 'POST', path: '/api/conversations/conv-a/codex-approval', body: { optionNumber: 3 } },
    ]);
  });

  it('answer_codex_approval makes zero requests for an out-of-range optionNumber', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_codex_approval', { conversation: 'conv-a', optionNumber: 0 })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_pi_ask posts { toolUseId, answers } to the pi-ask-answer route', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/pi-ask-answer': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_pi_ask', { conversation: 'conv-a', toolUseId: 't1', answers: ['Yes'] });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/pi-ask-answer', body: { toolUseId: 't1', answers: ['Yes'] } }]);
  });

  it('answer_pi_ask makes zero requests for two answers or a blank answer', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_pi_ask', { conversation: 'conv-a', toolUseId: 't1', answers: ['Yes', 'No'] })).isError).toBe(true);
    expect((await callTool(client, 'answer_pi_ask', { conversation: 'conv-a', toolUseId: 't1', answers: ['  '] })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_plan posts { action, feedback } for reject-feedback with feedback', async () => {
    const api = fakeApi({ 'POST /api/conversations/conv-a/plan-action': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_plan', { conversation: 'conv-a', action: 'reject-feedback', feedback: 'try again' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/conversations/conv-a/plan-action', body: { action: 'reject-feedback', feedback: 'try again' } }]);
  });

  it('answer_plan makes zero requests for an invalid action', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_plan', { conversation: 'conv-a', action: 'approve' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_agent_plan posts to /api/agents/agent-pan-1/plan-action', async () => {
    const api = fakeApi({ 'POST /api/agents/agent-pan-1/plan-action': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_agent_plan', { agentId: 'agent-pan-1', action: 'approve-auto' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/agents/agent-pan-1/plan-action', body: { action: 'approve-auto' } }]);
  });

  it('answer_agent_plan refuses an agent on a linked machine with zero requests', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_agent_plan', { agentId: '@desk/agent-pan-1', action: 'approve-auto' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(AGENT_ON_LINKED_MACHINE_TEXT);
    expect(api.calls).toEqual([]);
  });

  it('answer_agent_permission posts { behavior } to the encoded respond path', async () => {
    const api = fakeApi({ 'POST /api/agents/agent-pan-1/permissions/req%201/respond': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_agent_permission', { agentId: 'agent-pan-1', requestId: 'req 1', behavior: 'deny' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/agents/agent-pan-1/permissions/req%201/respond', body: { behavior: 'deny' } }]);
  });

  it('answer_agent_permission makes zero requests for an invalid behavior or a linked agentId', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_agent_permission', { agentId: 'agent-pan-1', requestId: 'req-1', behavior: 'maybe' })).isError).toBe(true);
    expect((await callTool(client, 'answer_agent_permission', { agentId: '@desk/agent-pan-1', requestId: 'req-1', behavior: 'deny' })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('answer_question with agentId posts { answers, toolUseId } to the agent answer-question route', async () => {
    const api = fakeApi({ 'POST /api/agents/agent-pan-1/answer-question': { status: 200, json: { ok: true } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_question', { agentId: 'agent-pan-1', answers: ['Yes'], toolUseId: 't1' });
    expect(result.isError).toBeFalsy();
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/agents/agent-pan-1/answer-question', body: { answers: ['Yes'], toolUseId: 't1' } }]);
  });

  it('answer_question makes zero requests when both or neither of conversation/agentId are given', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, APPROVER);
    expect((await callTool(client, 'answer_question', { conversation: 'conv-a', agentId: 'agent-pan-1', answers: ['Yes'] })).isError).toBe(true);
    expect((await callTool(client, 'answer_question', { answers: ['Yes'] })).isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});
