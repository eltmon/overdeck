/**
 * PAN-4649 W-7: the MCP approval tools. `answer_question` checks `approve`
 * itself and serves Claude Code conversations only; `answer_permission`
 * validates the choice before any request.
 */
import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';
import { APPROVE_TOOLS, MISSING_APPROVE_TEXT, NOT_CLAUDE_CODE_TEXT } from '../../../../src/lib/mcp/tools-approve.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const APPROVER = ['approve', 'tell', 'read:conversations'];

describe('MCP approval tools (PAN-4649 W-7)', () => {
  it('the approval tools follow the schedule tools', () => {
    expect(APPROVE_TOOLS.map((tool) => tool.name)).toEqual(['list_pending_input', 'answer_question', 'answer_permission']);
    expect(ALL_TOOLS.map((tool) => tool.name)).toEqual([
      'list_machines', 'list_conversations', 'search_conversations', 'read_conversation',
      'send_message', 'start_conversation', 'start_worker',
      'schedule_message', 'schedule_recurring', 'list_scheduled', 'update_scheduled', 'delete_scheduled',
      'list_pending_input', 'answer_question', 'answer_permission',
      'wait_job', 'task_claim', 'task_done', 'task_block', 'done', 'handoff',
    ]);
  });

  it('list_pending_input passes the pending-input feed through', async () => {
    const api = fakeApi({ 'GET /api/conversations/pending-input': { status: 200, json: [{ name: 'conv-a', pendingInputKinds: ['askUserQuestion'] }] } });
    const client = await connectClient(api, APPROVER);
    expect(resultJson(await callTool(client, 'list_pending_input'))).toEqual([{ name: 'conv-a', pendingInputKinds: ['askUserQuestion'] }]);
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

  it('answer_question refuses a codex conversation and posts nothing', async () => {
    const api = fakeApi({ 'GET /api/conversations/conv-c': { status: 200, json: { name: 'conv-c', harness: 'codex' } } });
    const client = await connectClient(api, APPROVER);
    const result = await callTool(client, 'answer_question', { conversation: 'conv-c', answers: ['Yes'] });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(NOT_CLAUDE_CODE_TEXT);
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
});
