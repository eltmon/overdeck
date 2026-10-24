/**
 * PAN-4527: a review request joins a live verification worker only while that
 * worker is still verifying the requested head.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspace: '',
  launches: [] as Array<{ resultPath: string }>,
}));

vi.mock('../../project-repos.js', () => ({
  resolveWorkspaceRepoRoots: () => [{
    repoKey: 'pan-1',
    dir: mocks.workspace,
    sourceBranch: 'feature/pan-1',
    targetBranch: 'main',
    isPolyrepo: false,
  }],
}));
vi.mock('../../config-yaml/load.js', () => ({
  loadConfigSync: () => ({ config: { resources: { verificationCpuWeight: 100 } } }),
}));
vi.mock('../verification-worker-launcher.js', () => ({
  buildVerificationWorkerLaunch: (_issueId: string, _runId: string, _workerPath: string, request: string) => ({ request }),
  // The fresh worker "finishes" at once: its result is on disk before the
  // supervisor starts waiting, so no poll ever sleeps.
  launchVerificationWorker: ({ request }: { request: string }) => {
    const { resultPath } = JSON.parse(request) as { resultPath: string };
    mocks.launches.push({ resultPath });
    writeFileSync(resultPath, JSON.stringify({ outcome: 'passed' }));
    return { pid: FRESH_PID, unref: () => undefined };
  },
}));

import { readVerificationWorkerState, runSupervisedVerification } from '../verification-worker-supervisor.js';

const LIVE_PID = 4_000_001;
const FRESH_PID = 4_000_002;

let root: string;
let home: string;
let previousHome: string | undefined;
let previousWorkerPath: string | undefined;
let alivePids: Set<number>;
let signalled: Array<{ pid: number; signal: unknown }>;
let liveProbes: number;
/** Runs on the live worker's second liveness probe: the first inside waitForResult. */
let onWaitProbe: (() => void) | undefined;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: mocks.workspace, encoding: 'utf-8' }).trim();
}

function commit(file: string): string {
  writeFileSync(join(mocks.workspace, file), file);
  git('add', file);
  git('commit', '-q', '-m', file);
  return git('rev-parse', 'HEAD');
}

/** A live worker registered on `headAnchor` that has written no result yet. */
function registerLiveWorker(headAnchor: string): string {
  const dir = join(home, 'verification-workers', 'pan-1');
  mkdirSync(dir, { recursive: true });
  const resultPath = join(dir, 'result-live.json');
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    runId: 'live',
    issueId: 'PAN-1',
    workspacePath: mocks.workspace,
    pid: LIVE_PID,
    startedAt: new Date().toISOString(),
    resultPath,
    phase: 'queued',
    admittedAt: null,
    headAnchor,
  }));
  return resultPath;
}

/**
 * Join `resultPath`'s worker: the result lands while the supervisor is waiting,
 * and its one poll sleep is advanced on fake timers.
 */
async function joinAndFinish(resultPath: string, run: () => Promise<unknown>): Promise<unknown> {
  let waiting!: () => void;
  const sleeping = new Promise<void>((resolve) => { waiting = resolve; });
  onWaitProbe = () => {
    writeFileSync(resultPath, JSON.stringify({ outcome: 'passed' }));
    waiting();
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const outcome = run();
  await sleeping;
  await vi.advanceTimersByTimeAsync(250);
  return outcome;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verification-supervisor-join-'));
  home = join(root, 'home');
  const origin = join(root, 'origin.git');
  mocks.workspace = join(root, 'workspace');
  mocks.launches = [];
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, mocks.workspace], { stdio: 'ignore' });
  git('checkout', '-q', '-b', 'main');
  commit('base');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '-b', 'feature/pan-1');

  previousHome = process.env.OVERDECK_HOME;
  previousWorkerPath = process.env.OVERDECK_VERIFICATION_WORKER_PATH;
  process.env.OVERDECK_HOME = home;
  // Any existing file stands in for the worker bundle; the launcher is mocked.
  process.env.OVERDECK_VERIFICATION_WORKER_PATH = join(mocks.workspace, 'base');

  alivePids = new Set([LIVE_PID]);
  signalled = [];
  liveProbes = 0;
  onWaitProbe = undefined;
  const realKill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    const target = Math.abs(pid);
    if (target !== LIVE_PID && target !== FRESH_PID) return realKill(pid, signal);
    if (!alivePids.has(target)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (signal === 0 && target === LIVE_PID && ++liveProbes === 2) onWaitProbe?.();
    if (signal !== 0) {
      signalled.push({ pid, signal });
      alivePids.delete(target);
    }
    return true;
  }) as typeof process.kill);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  if (previousWorkerPath === undefined) delete process.env.OVERDECK_VERIFICATION_WORKER_PATH;
  else process.env.OVERDECK_VERIFICATION_WORKER_PATH = previousWorkerPath;
  rmSync(root, { recursive: true, force: true });
});

describe('review verification join rule (PAN-4527)', () => {
  it('kills a worker launched on head A and starts a fresh one when the tip is a new agent commit B', async () => {
    const headA = commit('a');
    registerLiveWorker(headA);
    const headB = commit('b');

    const outcome = await runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'test');

    expect(outcome).toEqual({ outcome: 'passed' });
    expect(signalled).toEqual([{ pid: -LIVE_PID, signal: 'SIGTERM' }]);
    expect(mocks.launches).toHaveLength(1);
    const state = readVerificationWorkerState('PAN-1');
    expect(state?.pid).toBe(FRESH_PID);
    expect(state?.headAnchor).toBe(headB);
  });

  it("still joins a worker whose only HEAD change is its own target-branch sync merge", async () => {
    const headA = commit('a');
    const liveResult = registerLiveWorker(headA);
    // The worker merged origin/main into the workspace (a newer main).
    git('checkout', '-q', 'main');
    commit('main-update');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', 'feature/pan-1');
    git('merge', '-q', '--no-edit', 'origin/main');

    const outcome = await joinAndFinish(liveResult, () => runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'test'));

    expect(outcome).toEqual({ outcome: 'passed' });
    expect(signalled).toEqual([]);
    expect(mocks.launches).toHaveLength(0);
    expect(readVerificationWorkerState('PAN-1')?.pid).toBe(LIVE_PID);
  });

  it('merge verification joins only on the exact launch anchor', async () => {
    const headA = commit('a');
    const liveResult = registerLiveWorker(headA);

    const outcome = await joinAndFinish(liveResult, () => runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'test', { syncTargetBranch: false }));

    expect(outcome).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(0);
  });
});
