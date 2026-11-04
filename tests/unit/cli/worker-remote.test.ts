/** PAN-4651 WI-13 (D-4651-6/7): `pan worker run --machine` and waiting on a stand-in. */
import { describe, expect, it, vi } from 'vitest';

import { checkUnpushedCommits, type GitRunner } from '../../../src/cli/commands/delegation-push-check.js';
import { WORKER_EXIT, workerRunCommand, type WorkerCliDeps } from '../../../src/cli/commands/worker.js';
import { FLY_CLI_REFUSAL, type RemoteWorkerCliDeps, standInWaitDeps } from '../../../src/cli/commands/worker-remote.js';
import type { RemoteStandIn } from '../../../src/lib/agents/worker/remote-standin.js';
import { waitForWorkerReport, type WaitOutcome } from '../../../src/lib/agents/worker/index.js';

const STAND_IN: RemoteStandIn = {
  v: 1, environmentId: 'env-desk', label: 'desk', remoteId: 'agent-pan-9-worker-4', parentId: 'agent-pan-9-review', issueId: 'PAN-9',
  createdAt: '2026-11-01T12:00:00.000Z', state: 'running', lastSeq: 0, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
};

function gitWith(count: string): GitRunner {
  return vi.fn<GitRunner>(async (args) => ({ stdout: args[0] === 'rev-list' ? count : args[0] === 'rev-parse' ? 'feature/pan-9' : '' }));
}

function makeDeps(git: GitRunner) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const remote: RemoteWorkerCliDeps = {
    call: vi.fn(async (path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => {
      calls.push({ path, body: init.body, headers: init.headers });
      if (path === '/api/machines') return { status: 200, json: { self: { environmentId: 'env-laptop', label: 'laptop' }, links: [{ environmentId: 'env-desk', label: 'desk' }] } };
      if (path === '/api/fleet/workers') return { status: 200, json: { id: 'agent-pan-9-worker-2', machine: { label: 'desk' }, reason: null, remote: true } };
      return { status: 404, json: { error: 'not found' } };
    }),
    senderId: () => 'agent-pan-9-review',
    issueOrigin: async () => 'github.com/eltmon/overdeck',
    pushCheck: (cwd, options) => checkUnpushedCommits(cwd, options, git),
  };
  const deps: WorkerCliDeps = {
    startWorker: vi.fn(),
    waitForWorkerReport: vi.fn(async (): Promise<WaitOutcome> => ({ kind: 'report', report: { seq: 1, at: 'x', status: 'done', body: 'remote findings' } })),
    writeWorkerReport: vi.fn(), listWorkers: vi.fn(), isAlive: vi.fn(), stopWorker: vi.fn(), workerExists: vi.fn(), registerExternal: vi.fn(),
    cwd: () => '/ws/feature-pan-9', readFile: vi.fn(), readStdin: vi.fn(), stdinIsTTY: () => false,
    env: { OVERDECK_AGENT_ID: 'agent-pan-9-review' },
    stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); },
    remote,
  };
  return { deps, out, err, calls };
}

describe('pan worker run --machine (PAN-4651 WI-13)', () => {
  it('ac13: --machine desk with 2 unpushed commits exits 1 with the D-4651-7 message and starts nothing', async () => {
    const { deps, err, calls } = makeDeps(gitWith('2'));
    const code = await workerRunCommand({ issue: 'pan-9', prompt: 'Run it.', machine: 'desk' }, deps);
    expect(code).toBe(WORKER_EXIT.usage);
    expect(err).toContain('2 commits on feature/pan-9 are not pushed; desk starts from origin. Re-run with --push-first to push them, or --ignore-unpushed.');
    expect(calls.some((call) => call.path === '/api/fleet/workers')).toBe(false);
  });

  it('--push-first pushes then starts the worker on desk as this agent, and waits on the stand-in', async () => {
    const git = gitWith('2');
    const { deps, out, err, calls } = makeDeps(git);
    const code = await workerRunCommand({ issue: 'pan-9', prompt: 'Run it.', machine: 'desk', pushFirst: true, needs: 'Docker' }, deps);
    expect(code).toBe(WORKER_EXIT.done);
    expect(git).toHaveBeenCalledWith(['push'], '/ws/feature-pan-9', 120_000);
    const post = calls.find((call) => call.path === '/api/fleet/workers')!;
    expect(post.body).toMatchObject({ machine: 'desk', issueId: 'PAN-9', prompt: 'Run it.', parentId: 'agent-pan-9-review', needs: ['docker'] });
    expect(post.headers).toEqual({ 'x-overdeck-sender': 'agent-pan-9-review' });
    expect(err).toContain('Started agent-pan-9-worker-2 on desk');
    expect(deps.waitForWorkerReport).toHaveBeenCalledWith('agent-pan-9-worker-2', { afterSeq: 0, timeoutMs: null });
    expect(out).toEqual(['remote findings']);
    expect(deps.startWorker).not.toHaveBeenCalled();
  });

  it('--machine naming this machine runs the local path', async () => {
    const { deps } = makeDeps(gitWith('9'));
    (deps.startWorker as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-pan-9-worker-1', cwd: '/w', branch: null, paneReady: true });
    expect(await workerRunCommand({ issue: 'pan-9', prompt: 'Run it.', machine: 'laptop' }, deps)).toBe(WORKER_EXIT.done);
    expect(deps.startWorker).toHaveBeenCalled();
  });

  it('ac2 (PAN-4743): --machine fly refuses with FLY_CLI_REFUSAL and never calls the dashboard', async () => {
    const { deps, err, calls } = makeDeps(gitWith('0'));
    expect(await workerRunCommand({ issue: 'pan-9', prompt: 'Run it.', machine: 'fly' }, deps)).toBe(WORKER_EXIT.usage);
    expect(err).toContain(FLY_CLI_REFUSAL);
    expect(calls).toEqual([]);
  });
});

describe('waiting on a stand-in (D-4651-6)', () => {
  const noReports = async () => [];
  const run = (states: RemoteStandIn[]) => {
    let polls = 0;
    const read = async () => states[Math.min(polls, states.length - 1)]!;
    const sleep = async () => { polls += 1; };
    return waitForWorkerReport('agent-pan-9-worker-2', { afterSeq: 0, pollMs: 1, idleGraceMs: 10, startupGraceMs: 0, timeoutMs: undefined }, {
      ...standInWaitDeps('agent-pan-9-worker-2', read), listReports: noReports, sleep, now: () => 1_000 + polls,
    });
  };

  it('ac13: a stand-in with unreachableSince keeps waiting (alive, no idle age), then sees the exit', async () => {
    const unreachable = { ...STAND_IN, unreachableSince: '2026-11-01T12:01:00.000Z', idleAgeMs: 99_999_999 };
    const outcome = await run([unreachable, unreachable, unreachable, { ...STAND_IN, state: 'exited', lastAssistantMessage: 'done here' }]);
    expect(outcome).toEqual({ kind: 'exited-without-report', lastAssistantMessage: 'done here', transcriptPath: null });
  });

  it('a stand-in in exited with no report yields exited-without-report carrying lastAssistantMessage', async () => {
    const outcome = await run([{ ...STAND_IN, state: 'exited', lastAssistantMessage: 'bye' }]);
    expect(outcome).toEqual({ kind: 'exited-without-report', lastAssistantMessage: 'bye', transcriptPath: null });
  });
});
