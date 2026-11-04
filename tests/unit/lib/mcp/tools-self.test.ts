/**
 * PAN-4927 W-SELF1 WI-5: `wait_job` is listed only to agent tokens and passes
 * the wait route's answer through, `running` with `next` or `done`.
 */
import { describe, expect, it } from 'vitest';

import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const WAIT_J1 = 'GET /api/self/jobs/j1/wait?timeoutMs=50000';

describe('MCP self tools (PAN-4927 W-SELF1)', () => {
  it('wait_job is hidden from a non-agent token and listed for an agent token', async () => {
    const api = fakeApi({});
    const human = await connectClient(api, ['read:state']);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain('wait_job');
    const call = await callTool(human, 'wait_job', { jobId: 'j1' });
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe('Unknown tool wait_job');
    expect(api.calls).toEqual([]);

    const agent = await connectClient(api, ['read:state'], true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('wait_job');
  });

  it('passes a running answer and its next call through', async () => {
    const running = {
      status: 'running',
      jobId: 'j1',
      verb: 'done',
      startedAt: '2026-11-03T00:00:00.000Z',
      next: { tool: 'wait_job', arguments: { jobId: 'j1' } },
    };
    const api = fakeApi({ [WAIT_J1]: { status: 200, json: running } });
    const client = await connectClient(api, ['read:state'], true);
    expect(resultJson(await callTool(client, 'wait_job', { jobId: 'j1' }))).toEqual(running);
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/self/jobs/j1/wait?timeoutMs=50000' }]);
  });

  it('passes a done answer through', async () => {
    const done = { status: 'done', jobId: 'j1', verb: 'done', exitCode: 0, stdout: 'ok', stderr: '', error: null };
    const client = await connectClient(fakeApi({ [WAIT_J1]: { status: 200, json: done } }), ['read:state'], true);
    expect(resultJson(await callTool(client, 'wait_job', { jobId: 'j1' }))).toMatchObject({ status: 'done', exitCode: 0, stdout: 'ok' });
  });

  it('maps a route 404 to a tool error', async () => {
    const api = fakeApi({ [WAIT_J1]: { status: 404, json: { error: 'no such job', code: 'unknown-job' } } });
    const client = await connectClient(api, ['read:state'], true);
    const result = await callTool(client, 'wait_job', { jobId: 'j1' });
    expect(result.isError).toBe(true);
    expect(resultText(result).startsWith('HTTP 404')).toBe(true);
  });

  it('encodes the job id and requires it', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['read:state'], true);
    await callTool(client, 'wait_job', { jobId: 'a/b' });
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/self/jobs/a%2Fb/wait?timeoutMs=50000' }]);

    const missing = await callTool(client, 'wait_job', {});
    expect(missing.isError).toBe(true);
    expect(resultText(missing)).toContain('jobId');
    expect(api.calls).toHaveLength(1);
  });
});

describe.each(['task_claim', 'task_done'] as const)('%s (PAN-4927 W-SELF2)', (name) => {
  const path = `/api/self/tasks/${name === 'task_claim' ? 'claim' : 'done'}`;

  it('is hidden from a non-agent token with tell and listed for an agent token with tell', async () => {
    const api = fakeApi({});
    const human = await connectClient(api, ['tell']);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain(name);
    const call = await callTool(human, name, { itemId: 'item-a' });
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe(`Unknown tool ${name}`);
    expect(api.calls).toEqual([]);

    const agent = await connectClient(api, ['tell'], true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain(name);
  });

  it('posts exactly itemId and passes the job answer through', async () => {
    const running = { status: 'running', jobId: 'j1', verb: 'task-claim', startedAt: '2026-11-03T00:00:00.000Z', next: { tool: 'wait_job', arguments: { jobId: 'j1' } } };
    const api = fakeApi({ [`POST ${path}`]: { status: 200, json: running } });
    const client = await connectClient(api, ['tell'], true);
    expect(resultJson(await callTool(client, name, { itemId: 'item-a' }))).toEqual(running);
    expect(api.calls).toEqual([{ method: 'POST', path, body: { itemId: 'item-a' } }]);
  });

  it('requires itemId', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['tell'], true);
    const result = await callTool(client, name, {});
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('itemId');
    expect(api.calls).toEqual([]);
  });

  it('maps a route 409 to a tool error', async () => {
    const api = fakeApi({ [`POST ${path}`]: { status: 409, json: { error: 'this agent has no issue', code: 'no-issue' } } });
    const client = await connectClient(api, ['tell'], true);
    const result = await callTool(client, name, { itemId: 'item-a' });
    expect(result.isError).toBe(true);
    expect(resultText(result).startsWith('HTTP 409')).toBe(true);
  });
});

describe('task_block (PAN-4927 W-SELF2)', () => {
  const path = '/api/self/tasks/block';

  it('is hidden from a non-agent token with tell and listed for an agent token with tell', async () => {
    const api = fakeApi({});
    const human = await connectClient(api, ['tell']);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain('task_block');
    const call = await callTool(human, 'task_block', { itemId: 'item-a' });
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe('Unknown tool task_block');

    const agent = await connectClient(api, ['tell'], true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('task_block');
  });

  it('posts on through when given, and omits it when absent', async () => {
    const done = { status: 'done', jobId: 'j1', verb: 'task-block', exitCode: 0, stdout: '', stderr: '', error: null };
    const api = fakeApi({ [`POST ${path}`]: { status: 200, json: done } });
    const client = await connectClient(api, ['tell'], true);

    await callTool(client, 'task_block', { itemId: 'item-a', on: ['PAN-2', '#45'] });
    expect(api.calls[0]).toEqual({ method: 'POST', path, body: { itemId: 'item-a', on: ['PAN-2', '#45'] } });

    await callTool(client, 'task_block', { itemId: 'item-a' });
    expect(api.calls[1]).toEqual({ method: 'POST', path, body: { itemId: 'item-a' } });
  });

  it('requires itemId and rejects a non-string-array on', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['tell'], true);

    const missing = await callTool(client, 'task_block', {});
    expect(missing.isError).toBe(true);
    expect(resultText(missing)).toContain('itemId');

    const badOn = await callTool(client, 'task_block', { itemId: 'item-a', on: 'not-an-array' });
    expect(badOn.isError).toBe(true);
    expect(resultText(badOn)).toContain('on must be a list of strings');
    expect(api.calls).toEqual([]);
  });
});

describe('done (PAN-4927 W-SELF2)', () => {
  it('is hidden from an agent token without operate and listed for one with operate', async () => {
    const api = fakeApi({});
    const agentNoOperate = await connectClient(api, ['tell'], true);
    expect((await agentNoOperate.listTools()).tools.map((tool) => tool.name)).not.toContain('done');
    const call = await callTool(agentNoOperate, 'done');
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe('Unknown tool done');

    const agentWithOperate = await connectClient(api, ['tell', 'operate'], true);
    expect((await agentWithOperate.listTools()).tools.map((tool) => tool.name)).toContain('done');
  });

  it('posts {}', async () => {
    const running = { status: 'running', jobId: 'j1', verb: 'done', startedAt: '2026-11-03T00:00:00.000Z', next: { tool: 'wait_job', arguments: { jobId: 'j1' } } };
    const api = fakeApi({ 'POST /api/self/done': { status: 200, json: running } });
    const client = await connectClient(api, ['tell', 'operate'], true);
    expect(resultJson(await callTool(client, 'done'))).toEqual(running);
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/self/done', body: {} }]);
  });
});

describe('handoff (PAN-4927 W-SELF2)', () => {
  const path = '/api/self/handoff';

  it('is hidden from a non-agent token with tell and listed for an agent token with tell', async () => {
    const api = fakeApi({});
    const human = await connectClient(api, ['tell']);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain('handoff');
    const call = await callTool(human, 'handoff', { focus: 'Read .pan/brief.md' });
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe('Unknown tool handoff');

    const agent = await connectClient(api, ['tell'], true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('handoff');
  });

  it('posts focus and title through when given, and omits title when absent', async () => {
    const done = { status: 'done', jobId: 'j1', verb: 'handoff', exitCode: 0, stdout: '', stderr: '', error: null };
    const api = fakeApi({ [`POST ${path}`]: { status: 200, json: done } });
    const client = await connectClient(api, ['tell'], true);

    await callTool(client, 'handoff', { focus: 'Read .pan/brief.md', title: 'Next step' });
    expect(api.calls[0]).toEqual({ method: 'POST', path, body: { focus: 'Read .pan/brief.md', title: 'Next step' } });

    await callTool(client, 'handoff', { focus: 'Read .pan/brief.md' });
    expect(api.calls[1]).toEqual({ method: 'POST', path, body: { focus: 'Read .pan/brief.md' } });
  });

  it('requires focus', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['tell'], true);
    const missing = await callTool(client, 'handoff', {});
    expect(missing.isError).toBe(true);
    expect(resultText(missing)).toContain('focus');
    expect(api.calls).toEqual([]);
  });
});

describe('worker_report (PAN-4927 W-SELF2)', () => {
  const path = '/api/self/worker-report';

  it('is hidden from a non-agent token with tell and listed for an agent token with tell', async () => {
    const api = fakeApi({});
    const human = await connectClient(api, ['tell']);
    expect((await human.listTools()).tools.map((tool) => tool.name)).not.toContain('worker_report');
    const call = await callTool(human, 'worker_report', { status: 'done', report: 'R' });
    expect(call.isError).toBe(true);
    expect(resultText(call)).toBe('Unknown tool worker_report');

    const agent = await connectClient(api, ['tell'], true);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('worker_report');
  });

  it('posts status and report', async () => {
    const doneAnswer = { status: 'done', jobId: 'j1', verb: 'worker-report', exitCode: 0, stdout: '', stderr: '', error: null };
    const api = fakeApi({ [`POST ${path}`]: { status: 200, json: doneAnswer } });
    const client = await connectClient(api, ['tell'], true);
    expect(resultJson(await callTool(client, 'worker_report', { status: 'blocked', report: 'R' }))).toEqual(doneAnswer);
    expect(api.calls).toEqual([{ method: 'POST', path, body: { status: 'blocked', report: 'R' } }]);
  });

  it('requires status and report', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, ['tell'], true);
    const missingStatus = await callTool(client, 'worker_report', { report: 'R' });
    expect(missingStatus.isError).toBe(true);
    expect(resultText(missingStatus)).toContain('status');

    const missingReport = await callTool(client, 'worker_report', { status: 'done' });
    expect(missingReport.isError).toBe(true);
    expect(resultText(missingReport)).toContain('report');
    expect(api.calls).toEqual([]);
  });
});
