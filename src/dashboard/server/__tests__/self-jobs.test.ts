/**
 * PAN-4927 W-SELF1 WI-3: the in-memory self-job store, its execFile runner,
 * the identity env a job runs with, and the bounded waits on a job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelfCaller } from '../self-caller.js';
import { buildSelfJobArgv, SelfJobArgError } from '../services/self-job-argv.js';
import {
  createSelfJobs,
  runPanJob,
  SELF_JOB_LIMIT,
  SELF_JOB_MAX_BUFFER,
  type SelfJobRunInput,
  type SelfJobRunResult,
  selfJobAnswer,
  selfJobEnv,
  type SelfJobState,
  tailUtf8,
} from '../services/self-jobs.js';

const agent: SelfCaller = { agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', cwd: '/w/feature-pan-1', issueId: 'PAN-1', tmuxSession: null };
const conversation: SelfCaller = { agentId: 'abc', agentKind: 'conversation', role: 'conversation', cwd: '/p', issueId: null, tmuxSession: 'conv-abc' };

const ok = (overrides: Partial<SelfJobRunResult> = {}): SelfJobRunResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: '',
  stderr: '',
  error: null,
  ...overrides,
});

/** A runner whose jobs settle only when the test resolves them, in start order. */
function controlledRunner() {
  const calls: SelfJobRunInput[] = [];
  const resolvers: Array<(result: SelfJobRunResult) => void> = [];
  const runner = (input: SelfJobRunInput) => {
    calls.push(input);
    return new Promise<SelfJobRunResult>((resolve) => resolvers.push(resolve));
  };
  return { runner, calls, resolvers };
}

function idSequence() {
  let next = 0;
  return () => `job-${++next}`;
}

describe('self jobs', () => {
  describe('waits and retention', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers running after the full 50 s chunk, not before', async () => {
      const { runner } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done', [{ ref: 'PAN-1' }]);
      if (!started.ok) throw new Error('start failed');
      let state: SelfJobState | null | undefined;
      void jobs.wait(started.jobId, agent, 50_000).then((value) => (state = value));
      await vi.advanceTimersByTimeAsync(49_999);
      expect(state).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(state?.status).toBe('running');
    });

    it('answers done as soon as the job ends', async () => {
      const { runner, resolvers } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done');
      if (!started.ok) throw new Error('start failed');
      let state: SelfJobState | null | undefined;
      void jobs.wait(started.jobId, agent, 50_000).then((value) => (state = value));
      await vi.advanceTimersByTimeAsync(10_000);
      resolvers[0](ok({ exitCode: 2, stdout: 'out' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(state).toMatchObject({ status: 'done', exitCode: 2, stdout: 'out' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns early when the request aborts', async () => {
      const { runner } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done');
      if (!started.ok) throw new Error('start failed');
      const controller = new AbortController();
      let state: SelfJobState | null | undefined;
      void jobs.wait(started.jobId, agent, 50_000, controller.signal).then((value) => (state = value));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(state).toBeUndefined();
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(state?.status).toBe('running');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns at once for an already-aborted signal', async () => {
      const { runner } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done');
      if (!started.ok) throw new Error('start failed');
      const controller = new AbortController();
      controller.abort();
      await expect(jobs.wait(started.jobId, agent, 50_000, controller.signal)).resolves.toMatchObject({ status: 'running' });
    });

    it('clamps a longer timeout to 50 s', async () => {
      const { runner } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done');
      if (!started.ok) throw new Error('start failed');
      let state: SelfJobState | null | undefined;
      void jobs.wait(started.jobId, agent, 900_000).then((value) => (state = value));
      await vi.advanceTimersByTimeAsync(50_000);
      expect(state?.status).toBe('running');
    });

    it('keeps a finished job for an hour after it ends', async () => {
      const { runner, resolvers } = controlledRunner();
      const jobs = createSelfJobs({ runner });
      const started = jobs.start(agent, 'done');
      if (!started.ok) throw new Error('start failed');
      resolvers[0](ok());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(jobs.get(started.jobId, agent)?.status).toBe('done');
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(jobs.get(started.jobId, agent)).toBeNull();
    });
  });

  it('hides a job from every caller but its owner', async () => {
    const { runner } = controlledRunner();
    const jobs = createSelfJobs({ runner });
    const started = jobs.start(agent, 'done');
    if (!started.ok) throw new Error('start failed');
    const otherAgent: SelfCaller = { ...agent, agentId: 'agent-pan-2' };
    const sameIdOtherKind: SelfCaller = { ...conversation, agentId: agent.agentId };
    for (const caller of [otherAgent, sameIdOtherKind]) {
      expect(jobs.get(started.jobId, caller)).toBeNull();
      await expect(jobs.wait(started.jobId, caller, 1)).resolves.toBeNull();
    }
    expect(jobs.get('job-unknown', agent)).toBeNull();
    expect(jobs.get(started.jobId, agent)?.status).toBe('running');
  });

  it('runs the bundled CLI with the built argv in the caller cwd', () => {
    const { runner, calls } = controlledRunner();
    const jobs = createSelfJobs({ runner });
    const args = [{ ref: 'PAN-1' }, { ref: 'item-a' }];
    jobs.start(agent, 'task-claim', args, { stdin: 'body' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe(process.execPath);
    expect(call.args[0].replaceAll('\\', '/').endsWith('dist/cli/index.js')).toBe(true);
    expect(call.args.slice(1)).toEqual(buildSelfJobArgv('task-claim', args));
    expect(call.cwd).toBe('/w/feature-pan-1');
    expect(call.stdin).toBe('body');
    expect(call.env.OVERDECK_AGENT_ID).toBe('agent-pan-1');
  });

  describe('selfJobEnv', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/bin',
      OVERDECK_AGENT_ID: 'agent-other',
      OVERDECK_CONVERSATION: 'conv-flywheel',
      OVERDECK_ISSUE_ID: 'PAN-999',
      OVERDECK_CLAIM_ID: 'x',
      OVERDECK_AGENT_STARTED_BY: 'flywheel',
      OVERDECK_MCP_TOKEN: 'odk_secret',
      OVERDECK_MCP_TOKEN_FILE: '/tmp/token',
      PORT: '4011',
    };

    it('gives an agent caller only its own identity', () => {
      const env = selfJobEnv(agent, base);
      expect(env.PATH).toBe('/bin');
      expect(env.OVERDECK_AGENT_ID).toBe('agent-pan-1');
      expect(env.OVERDECK_ISSUE_ID).toBe('PAN-1');
      expect(env.OVERDECK_DASHBOARD_URL).toBe('http://127.0.0.1:4011');
      for (const name of ['OVERDECK_CONVERSATION', 'OVERDECK_CLAIM_ID', 'OVERDECK_AGENT_STARTED_BY', 'OVERDECK_MCP_TOKEN', 'OVERDECK_MCP_TOKEN_FILE']) {
        expect(env).not.toHaveProperty(name);
      }
    });

    it('gives a conversation caller its tmux session, not its name', () => {
      const env = selfJobEnv(conversation, base);
      expect(env.OVERDECK_CONVERSATION).toBe('conv-abc');
      expect(env).not.toHaveProperty('OVERDECK_AGENT_ID');
      expect(env).not.toHaveProperty('OVERDECK_ISSUE_ID');
      expect(env).not.toHaveProperty('OVERDECK_CLAIM_ID');
      expect(env).not.toHaveProperty('OVERDECK_MCP_TOKEN');
      expect(env.OVERDECK_DASHBOARD_URL).toBe('http://127.0.0.1:4011');
    });

    it('prefers API_PORT and defaults to 3011', () => {
      expect(selfJobEnv(agent, { API_PORT: '5000', PORT: '4011' }).OVERDECK_DASHBOARD_URL).toBe('http://127.0.0.1:5000');
      expect(selfJobEnv(agent, {}).OVERDECK_DASHBOARD_URL).toBe('http://127.0.0.1:3011');
    });

    it('leaves the base env untouched', () => {
      selfJobEnv(agent, base);
      expect(base.OVERDECK_MCP_TOKEN).toBe('odk_secret');
    });
  });

  it('refuses a start when every held job is running, then drops the oldest finished job', async () => {
    const { runner, resolvers } = controlledRunner();
    const jobs = createSelfJobs({ runner, newId: idSequence() });
    for (let index = 0; index < SELF_JOB_LIMIT; index++) expect(jobs.start(agent, 'done').ok).toBe(true);
    expect(jobs.start(agent, 'done')).toEqual({ ok: false, code: 'too-many-jobs', error: 'too many self jobs are running; wait for one to finish' });
    resolvers[0](ok());
    await jobs.wait('job-1', agent, 1);
    expect(jobs.get('job-1', agent)?.status).toBe('done');
    expect(jobs.start(agent, 'done')).toEqual({ ok: true, jobId: 'job-201' });
    expect(jobs.get('job-1', agent)).toBeNull();
  });

  it('stores nothing when the args are invalid', () => {
    const { runner, calls } = controlledRunner();
    const jobs = createSelfJobs({ runner, newId: idSequence() });
    expect(() => jobs.start(agent, 'task-claim', [{ ref: '--steal' }])).toThrow(SelfJobArgError);
    expect(calls).toHaveLength(0);
    expect(jobs.start(agent, 'done')).toEqual({ ok: true, jobId: 'job-1' });
  });

  it('records a rejecting runner as a done job with an error', async () => {
    const jobs = createSelfJobs({ runner: () => Promise.reject(new Error('boom')) });
    const started = jobs.start(agent, 'done');
    if (!started.ok) throw new Error('start failed');
    await expect(jobs.wait(started.jobId, agent, 1)).resolves.toMatchObject({ status: 'done', exitCode: null, error: 'Error: boom' });
  });

  it('tailUtf8 keeps the last 16,384 bytes', () => {
    const text = 'a'.repeat(1_024) + 'b'.repeat(16_384);
    expect(text).toHaveLength(17_408);
    expect(tailUtf8(text)).toBe('b'.repeat(16_384));
    expect(tailUtf8('short')).toBe('short');
  });

  it('selfJobAnswer names the next wait only for a running job', () => {
    const running: SelfJobState = {
      jobId: 'j1',
      verb: 'done',
      status: 'running',
      startedAt: '2026-11-03T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      error: null,
    };
    expect(selfJobAnswer(running)).toEqual({
      status: 'running',
      jobId: 'j1',
      verb: 'done',
      startedAt: '2026-11-03T00:00:00.000Z',
      next: { tool: 'wait_job', arguments: { jobId: 'j1' } },
    });
    const done: SelfJobState = { ...running, status: 'done', endedAt: '2026-11-03T00:00:01.000Z', exitCode: 0, stdout: 'ok' };
    const answer = selfJobAnswer(done);
    expect(answer).toEqual(done);
    expect(answer).not.toHaveProperty('next');
  });

  describe('runPanJob (real child process)', () => {
    const input = (args: string[], overrides: Partial<SelfJobRunInput> = {}): SelfJobRunInput => ({
      command: process.execPath,
      args,
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 60_000,
      maxBuffer: SELF_JOB_MAX_BUFFER,
      ...overrides,
    });

    it('keeps a failing exit code and trimmed output', async () => {
      const result = await runPanJob(input(['-e', "process.stdout.write('x'.repeat(17408)); process.stderr.write('e'); process.exit(3)"]));
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toHaveLength(16_384);
      expect(result.stderr).toBe('e');
      expect(result.error).toBeNull();
      expect(result.timedOut).toBe(false);
    });

    it('passes stdin to the child', async () => {
      const result = await runPanJob(input(['-e', 'process.stdin.pipe(process.stdout)'], { stdin: 'hello' }));
      expect(result).toMatchObject({ exitCode: 0, stdout: 'hello', error: null });
    });

    it('reports a spawn failure as an error with no exit code', async () => {
      const result = await runPanJob(input(['-e', '0'], { cwd: '/nonexistent-pan-4936' }));
      expect(result.exitCode).toBeNull();
      expect(result.error).not.toBeNull();
    });
  });
});
