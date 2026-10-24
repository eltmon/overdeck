/**
 * PAN-4527: a review request joins a live verification worker only while that
 * worker is still verifying the requested head.
 * PAN-4532: a finished result nobody consumed is adopted for the same head,
 * at most once, and a restarted dashboard re-attaches to surviving workers.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspace: '',
  launches: [] as Array<{ resultPath: string }>,
  failConsumptionWrite: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (mocks.failConsumptionWrite && String(args[1]).includes('resultConsumedAt')) throw new Error('ENOSPC');
      return actual.writeFileSync(...args);
    },
  };
});

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

import { createRequestReviewPipeline, registerRequestReviewStarter } from '../request-review-pipeline.js';
import { adoptSurvivingVerificationWorkers } from '../verification-boot-adoption.js';
import {
  listAdoptableVerificationWorkers,
  readVerificationWorkerState,
  runSupervisedVerification,
} from '../verification-worker-supervisor.js';

const LIVE_PID = 4_000_001;
const FRESH_PID = 4_000_002;

let root: string;
let home: string;
let previousHome: string | undefined;
let previousWorkerPath: string | undefined;
let alivePids: Set<number>;
let signalled: Array<{ pid: number; signal: unknown }>;
let liveProbes: number;
/** Which liveness probe of the live worker is the first one inside waitForResult. */
let waitProbeAt: number;
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
function registerLiveWorker(headAnchor: string, extra: Record<string, unknown> = {}): string {
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
    ...extra,
  }));
  return resultPath;
}

/** A request-review worker on `headAnchor` that exited after writing `outcome`, unconsumed. */
function registerFinishedWorker(headAnchor: string, outcome: Record<string, unknown> = { outcome: 'passed' }): string {
  const resultPath = registerLiveWorker(headAnchor, { logPrefix: 'request-review', options: {} });
  writeFileSync(resultPath, JSON.stringify(outcome));
  alivePids.delete(LIVE_PID);
  return resultPath;
}

const review = () => runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'request-review');

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
  mocks.failConsumptionWrite = false;
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
  waitProbeAt = 2;
  onWaitProbe = undefined;
  const realKill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    const target = Math.abs(pid);
    if (target !== LIVE_PID && target !== FRESH_PID) return realKill(pid, signal);
    if (!alivePids.has(target)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (signal === 0 && target === LIVE_PID && ++liveProbes === waitProbeAt) onWaitProbe?.();
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
  registerRequestReviewStarter(null);
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

describe('adopting an unconsumed result (PAN-4532)', () => {
  it('a finished passed result for the current HEAD is adopted: no new worker starts', async () => {
    registerFinishedWorker(commit('a'));

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(0);
    expect(readVerificationWorkerState('PAN-1')?.resultConsumedAt).toEqual(expect.any(String));
  });

  it('a result for the launch head is adopted after the worker\'s own sync merge', async () => {
    registerFinishedWorker(commit('a'));
    git('checkout', '-q', 'main');
    commit('main-update');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', 'feature/pan-1');
    git('merge', '-q', '--no-edit', 'origin/main');

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(0);
  });

  it('a new agent commit since the result starts a fresh worker (PAN-4527)', async () => {
    registerFinishedWorker(commit('a'));
    const headB = commit('b');

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
    expect(readVerificationWorkerState('PAN-1')?.headAnchor).toBe(headB);
  });

  it('a result is consumed at most once', async () => {
    registerFinishedWorker(commit('a'), { outcome: 'failed', failedCheck: 'lint', cycleCount: 1, maxCycles: 3 });

    expect(await review()).toMatchObject({ outcome: 'failed', failedCheck: 'lint' });
    expect(mocks.launches).toHaveLength(0);
    // A second request on the same head is a real re-run (PAN-3965 budget).
    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
  });

  it('a result its waiter already took is not adopted again', async () => {
    const liveResult = registerLiveWorker(commit('a'), { logPrefix: 'request-review', options: {} });
    expect(await joinAndFinish(liveResult, review)).toEqual({ outcome: 'passed' });
    vi.useRealTimers();
    alivePids.delete(LIVE_PID);

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
  });

  it('a result whose consumption cannot be recorded is not adopted: a fresh worker runs', async () => {
    registerFinishedWorker(commit('a'));
    mocks.failConsumptionWrite = true;

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
  });

  it('an error result, or one run with other options, is not adopted', async () => {
    registerFinishedWorker(commit('a'), { outcome: 'error', message: 'boom' });
    await review();
    expect(mocks.launches).toHaveLength(1);

    registerFinishedWorker(git('rev-parse', 'HEAD'));
    await runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'request-review', { skipPlanChecklist: true });
    expect(mocks.launches).toHaveLength(2);
  });
});

describe('re-attaching on dashboard boot (PAN-4532)', () => {
  it('lists running and unconsumed request-review workers only', () => {
    const head = commit('a');
    registerLiveWorker(head, { logPrefix: 'merge-verify', options: { syncTargetBranch: false } });
    expect(listAdoptableVerificationWorkers('request-review')).toEqual([]);

    registerLiveWorker(head, { logPrefix: 'request-review', options: {} });
    expect(listAdoptableVerificationWorkers('request-review').map((w) => w.pid)).toEqual([LIVE_PID]);

    registerFinishedWorker(head);
    expect(listAdoptableVerificationWorkers('request-review').map((w) => w.pid)).toEqual([LIVE_PID]);

    registerFinishedWorker(head, { outcome: 'error', message: 'boom' });
    expect(listAdoptableVerificationWorkers('request-review')).toEqual([]);
  });

  it('a worker alive at boot dispatches review when it later writes passed, with no re-request and no new worker', async () => {
    const liveResult = registerLiveWorker(commit('a'), { logPrefix: 'request-review', options: {} });
    const pipeline = createRequestReviewPipeline();
    const pushBranch = vi.fn(async () => undefined);
    const dispatchReview = vi.fn(async () => undefined);
    const starter = vi.fn(async (issueId: string) => ({
      started: pipeline.start(issueId, {
        verify: review,
        pushBranch,
        dispatchReview,
        onVerificationFailed: vi.fn(),
        onVerificationError: vi.fn(),
      }) as true,
    }));
    registerRequestReviewStarter(starter);
    // Probe 1 is the boot listing; probe 2 the supervisor's join check.
    waitProbeAt = 3;

    let waiting!: () => void;
    const sleeping = new Promise<void>((resolve) => { waiting = resolve; });
    onWaitProbe = () => {
      writeFileSync(liveResult, JSON.stringify({ outcome: 'passed' }));
      waiting();
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    expect(await adoptSurvivingVerificationWorkers()).toEqual(['PAN-1']);
    expect(starter).toHaveBeenCalledWith('PAN-1', expect.objectContaining({ source: 'verification-adoption' }));
    await sleeping;
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(dispatchReview).toHaveBeenCalledTimes(1));

    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(mocks.launches).toHaveLength(0);
    expect(signalled).toEqual([]);
  });
});
