/**
 * PAN-4927 W-MEM1 (PAN-4940): the memory_add self route's argv building,
 * validation order, caller checks and running/done answers, with injected
 * deps (model: self-jobs-routes.test.ts's "self job handlers" block).
 */
import { describe, expect, it, vi } from 'vitest';

import type { SelfCallerDeps } from '../self-caller.js';
import type { SelfJobRunInput, SelfJobRunResult } from '../services/self-jobs.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { createSelfJobs } from '../services/self-jobs.js';
import { requiredScopeFor } from '../route-scopes.js';
import { handleSelfMemoryAdd, memoryAddJobArgs } from '../routes/self-memory.js';

const callerDeps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId === 'agent-pan-1' ? { workspace: '/w/agent-pan-1', issueId: 'PAN-1' } : null),
  getConversationByName: () => null,
};

const agentCredential = (agentId: string): DashboardCredential => ({
  kind: 'token',
  tokenId: `tok-${agentId}`,
  scopes: ['tell'],
  agentId,
  agentKind: 'agent',
  role: 'work',
});

const tokenCredentialNoAgent: DashboardCredential = { kind: 'token', tokenId: 'tok-x', scopes: ['tell'] } as DashboardCredential;

function controlledJobs() {
  const resolvers: Array<(result: SelfJobRunResult) => void> = [];
  let recordedInput: SelfJobRunInput | undefined;
  let next = 0;
  const jobs = createSelfJobs({
    runner: (input: SelfJobRunInput) => {
      recordedInput = input;
      return new Promise<SelfJobRunResult>((resolve) => resolvers.push(resolve));
    },
    newId: () => `job-${++next}`,
  });
  const finish = (index: number, result: Partial<SelfJobRunResult> = {}) =>
    resolvers[index]({ exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', error: null, ...result });
  return { jobs, finish, getInput: () => recordedInput };
}

describe('memory_add job args', () => {
  it('builds the add argv from the body', () => {
    const result = memoryAddJobArgs({ id: 'my-fact', type: 'feedback', description: ' Decide fast. ', title: 'T', body: 'B', tags: ['a', 'b'] });
    expect(result).toEqual({
      ok: true,
      args: [
        { ref: 'my-fact' },
        { flag: 'type', value: 'feedback' },
        { flag: 'description', value: 'Decide fast.' },
        { flag: 'title', value: 'T' },
        { flag: 'body', value: 'B' },
        { flag: 'tags', value: 'a,b' },
        { switch: 'json' },
      ],
    });
  });

  it('type user defaults to the operator store; store machine switches; type user + store project is bad-request', () => {
    const userDefault = memoryAddJobArgs({ id: 'x', type: 'user', description: 'd' });
    expect(userDefault).toEqual({ ok: true, args: expect.arrayContaining([{ switch: 'user' }]) });
    expect((userDefault as { ok: true; args: unknown[] }).args.at(-1)).toEqual({ switch: 'json' });
    expect((userDefault as { ok: true; args: unknown[] }).args.at(-2)).toEqual({ switch: 'user' });

    const machine = memoryAddJobArgs({ id: 'x', type: 'feedback', description: 'd', store: 'machine' });
    expect((machine as { ok: true; args: unknown[] }).args.at(-2)).toEqual({ switch: 'machine' });

    const badCombo = memoryAddJobArgs({ id: 'x', type: 'user', description: 'd', store: 'project' });
    expect(badCombo).toEqual({ ok: false, error: 'user facts go in the operator store: store must be user or machine' });
  });

  it.each([
    [{ id: 'Bad_Id', type: 'feedback', description: 'd' }],
    [{ id: '-x', type: 'feedback', description: 'd' }],
    [{ id: 'x', type: 'note', description: 'd' }],
    [{ id: 'x', type: 'feedback', description: '' }],
    [{ id: 'x', type: 'feedback', description: 'a'.repeat(201) }],
    [{ id: 'x', type: 'feedback', description: 'a\nb' }],
    [{ id: 'x', type: 'feedback', description: 'd', body: 'a'.repeat(16_385) }],
    [{ id: 'x', type: 'feedback', description: 'd', tags: ['a,b'] }],
    [{ id: 'x', type: 'feedback', description: 'd', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
  ])('refuses a bad field: %j', (body) => {
    const result = memoryAddJobArgs(body as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });
});

describe('handleSelfMemoryAdd', () => {
  it('refuses a non-agent caller before parsing the body', async () => {
    const { jobs } = controlledJobs();
    const notAgent = await handleSelfMemoryAdd(tokenCredentialNoAgent, '{}', undefined, { jobs, caller: callerDeps });
    expect(notAgent).toEqual({ status: 403, body: { error: 'self routes need an agent token', code: 'not-an-agent-token' } });

    const gone = await handleSelfMemoryAdd(agentCredential('agent-pan-9'), '{}', undefined, { jobs, caller: callerDeps });
    expect(gone).toEqual({ status: 404, body: { error: 'the agent for this token no longer exists', code: 'agent-gone' } });
  });

  it('refuses a non-object body with 400 bad-body, before any job', async () => {
    const { jobs } = controlledJobs();
    for (const bodyText of ['[]', 'not json']) {
      const result = await handleSelfMemoryAdd(agentCredential('agent-pan-1'), bodyText, undefined, { jobs, caller: callerDeps });
      expect(result).toEqual({ status: 400, body: { error: 'body must be a JSON object', code: 'bad-body' } });
    }
  });

  it('refuses bad fields with 400 bad-request before any job', async () => {
    const { jobs, getInput } = controlledJobs();
    const result = await handleSelfMemoryAdd(
      agentCredential('agent-pan-1'),
      JSON.stringify({ id: 'x', type: 'note', description: 'd' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe('bad-request');
    expect(getInput()).toBeUndefined();
  });

  it('starts the job in the caller cwd with the caller identity, and answers done', async () => {
    const { jobs, finish, getInput } = controlledJobs();
    const promise = handleSelfMemoryAdd(
      agentCredential('agent-pan-1'),
      JSON.stringify({ id: 'my-fact', type: 'feedback', description: 'Decide fast.' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    finish(0);
    const result = await promise;
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe('done');
    const input = getInput();
    expect(input?.cwd).toBe('/w/agent-pan-1');
    expect(input?.env.OVERDECK_AGENT_ID).toBe('agent-pan-1');
    expect(input?.args.slice(1)).toEqual(['memory', 'add', 'my-fact', '--type=feedback', '--description=Decide fast.', '--json']);
  });

  it('answers running with next at 50 s', async () => {
    vi.useFakeTimers();
    try {
      const { jobs } = controlledJobs();
      const promise = handleSelfMemoryAdd(
        agentCredential('agent-pan-1'),
        JSON.stringify({ id: 'my-fact', type: 'feedback', description: 'Decide fast.' }),
        undefined,
        { jobs, caller: callerDeps },
      );
      await vi.advanceTimersByTimeAsync(50_000);
      const result = await promise;
      expect(result.status).toBe(200);
      const body = result.body as { status: string; jobId: string; next: unknown };
      expect(body.status).toBe('running');
      expect(body.next).toEqual({ tool: 'wait_job', arguments: { jobId: body.jobId } });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the gate', () => {
  it('needs tell for POST /api/self/memory/facts', () => {
    expect(requiredScopeFor('POST', '/api/self/memory/facts')).toBe('tell');
  });
});
