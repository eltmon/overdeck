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
