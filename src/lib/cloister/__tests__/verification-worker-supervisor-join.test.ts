/**
 * PAN-4527: a review request joins a live verification worker only while that
 * worker is still verifying the requested head.
 * PAN-4532: a finished result nobody consumed is adopted for the same head,
 * at most once, and a restarted dashboard re-attaches to surviving workers.
 * PAN-4622: a taken pass whose review never dispatched is dispatched at boot
 * without re-running the gates, and boot adoption resumes past a dirty tree,
 * checking head and tree at dispatch time instead.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspace: '',
  launches: [] as Array<{ resultPath: string }>,
  /** Results the next fresh workers write, in order; then `passed`. */
  results: [] as Array<Record<string, unknown>>,
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
    writeFileSync(resultPath, JSON.stringify(mocks.results.shift() ?? { outcome: 'passed' }));
    return { pid: FRESH_PID, unref: () => undefined };
  },
}));

import { createRequestReviewPipeline, registerRequestReviewStarter } from '../request-review-pipeline.js';
import { adoptSurvivingVerificationWorkers } from '../verification-boot-adoption.js';
import { confirmResumedDispatch } from '../verification-resume-dispatch.js';
import {
  clearVerificationDispatchOwed,
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
  mocks.results = [];
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

  it('kills a worker running with other options and starts a fresh one for the same head (PAN-4786)', async () => {
    const headA = commit('a');
    registerLiveWorker(headA, { logPrefix: 'request-review', options: {} });

    const outcome = await runSupervisedVerification('PAN-1', mocks.workspace, { isRemote: false }, 'request-review', { skipPlanChecklist: true });

    expect(outcome).toEqual({ outcome: 'passed' });
    expect(signalled).toEqual([{ pid: -LIVE_PID, signal: 'SIGTERM' }]);
    expect(mocks.launches).toHaveLength(1);
    expect(readVerificationWorkerState('PAN-1')?.options?.skipPlanChecklist).toBe(true);
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
    // PAN-4786: a live worker always records the options it launched with, so
    // the fixture names the same ones the request below will be compared against.
    const liveResult = registerLiveWorker(headA, { options: { syncTargetBranch: false } });

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
    // PAN-4622: until review dispatches, the pass is still owed on this head.
    clearVerificationDispatchOwed('PAN-1');

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
  });

  it('a result whose consumption cannot be recorded is not adopted: a fresh worker runs', async () => {
    registerFinishedWorker(commit('a'));
    mocks.failConsumptionWrite = true;

    // The write still fails for the fresh worker, so its waiter fails closed too.
    expect(await review()).toMatchObject({ outcome: 'error' });
    expect(mocks.launches).toHaveLength(1);
  });

  it('a waiter that cannot record consumption fails closed, and the next request adopts the result once', async () => {
    const liveResult = registerLiveWorker(commit('a'), { logPrefix: 'request-review', options: {} });
    mocks.failConsumptionWrite = true;
    expect(await joinAndFinish(liveResult, review)).toMatchObject({ outcome: 'error' });
    vi.useRealTimers();
    alivePids.delete(LIVE_PID);
    mocks.failConsumptionWrite = false;

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(0);
    expect(readVerificationWorkerState('PAN-1')?.resultConsumedAt).toEqual(expect.any(String));
    // Handed to one continuation already, which dispatched review (PAN-4622):
    // the next request is a real re-run.
    clearVerificationDispatchOwed('PAN-1');
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

describe('a run superseded by an agent commit (PAN-4531)', () => {
  const superseded = { outcome: 'deferred', reason: 'HEAD moved during verification', superseded: { from: 'aaaaaaaa', to: 'bbbbbbbb' } };

  it('restarts on the new head and returns that run\'s verdict to the door', async () => {
    commit('a');
    mocks.results = [superseded];

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(2);
    expect(readVerificationWorkerState('PAN-1')?.headAnchor).toBe(git('rev-parse', 'HEAD'));
  });

  it('gives the door a plain deferred once the head keeps moving past the restart bound', async () => {
    commit('a');
    mocks.results = [superseded, superseded, superseded, superseded, superseded];

    const outcome = await review();

    expect(outcome).toMatchObject({ outcome: 'deferred' });
    expect(outcome).not.toHaveProperty('superseded');
    expect(mocks.launches).toHaveLength(4);
  });
});

describe('a review dispatch owed across a restart (PAN-4622)', () => {
  /** The door's fail-closed tree check, run for real against the workspace. */
  const dirtyError = async (): Promise<string | null> => {
    const { stdout } = await promisify(execFile)('git', ['status', '--porcelain', '-uno'], { cwd: mocks.workspace });
    return stdout.trim() ? 'dirty' : null;
  };

  /** A boot starter that runs the real pipeline the way the resumed door does. */
  function resumingStarter() {
    const pipeline = createRequestReviewPipeline();
    const pushBranch = vi.fn(async () => undefined);
    const dispatchReview = vi.fn(async () => clearVerificationDispatchOwed('PAN-1'));
    const starter = vi.fn(async (issueId: string) => ({
      started: pipeline.start(issueId, {
        verify: review,
        confirmDispatch: () => confirmResumedDispatch(issueId, mocks.workspace, dirtyError),
        pushBranch,
        dispatchReview,
        onVerificationFailed: vi.fn(),
        onVerificationError: vi.fn(),
      }) as true,
    }));
    registerRequestReviewStarter(starter);
    return { pipeline, pushBranch, dispatchReview, starter };
  }

  function journalTail(): { type: string; source?: string; data?: Record<string, unknown> } | undefined {
    const lines = readFileSync(join(mocks.workspace, '.overdeck', 'pipeline.jsonl'), 'utf-8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]!);
  }

  it('records the owed head in the same write as the consumption, for a request-review pass only', async () => {
    const head = commit('a');
    registerFinishedWorker(head);
    expect(await review()).toEqual({ outcome: 'passed' });
    const state = readVerificationWorkerState('PAN-1');
    expect(state?.resultConsumedAt).toEqual(expect.any(String));
    expect(state?.dispatchOwed).toEqual({ head, takenAt: state?.resultConsumedAt });

    registerFinishedWorker(head, { outcome: 'failed', failedCheck: 'lint', cycleCount: 1, maxCycles: 3 });
    await review();
    expect(readVerificationWorkerState('PAN-1')?.dispatchOwed).toBeUndefined();
  });

  it('AC-1: a consumed pass whose dispatch never completed dispatches review at boot with no fresh run', async () => {
    registerFinishedWorker(commit('a'));
    // The previous dashboard took the pass, then died before dispatching.
    expect(await review()).toEqual({ outcome: 'passed' });
    expect(listAdoptableVerificationWorkers('request-review').map((w) => w.pid)).toEqual([LIVE_PID]);
    const { pipeline, pushBranch, dispatchReview, starter } = resumingStarter();

    expect(await adoptSurvivingVerificationWorkers()).toEqual(['PAN-1']);
    expect(starter).toHaveBeenCalledWith('PAN-1', expect.objectContaining({ source: 'verification-adoption', resume: true }));
    await vi.waitFor(() => expect(pipeline.isInFlight('PAN-1')).toBe(false));

    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(dispatchReview).toHaveBeenCalledTimes(1);
    expect(mocks.launches).toHaveLength(0);
    // Dispatched: nothing is owed, and the next request on this head re-runs.
    expect(readVerificationWorkerState('PAN-1')?.dispatchOwed).toBeUndefined();
    expect(listAdoptableVerificationWorkers('request-review')).toEqual([]);
    await review();
    expect(mocks.launches).toHaveLength(1);
  });

  it('a moved head clears the marker and re-verifies the new head', async () => {
    registerFinishedWorker(commit('a'));
    await review();
    const headB = commit('b');

    expect(await confirmResumedDispatch('PAN-1', mocks.workspace, dirtyError)).toBe(false);
    expect(journalTail()).toMatchObject({ type: 'review.resume-declined', data: { reason: 'the head moved after verification passed' } });

    expect(await review()).toEqual({ outcome: 'passed' });
    expect(mocks.launches).toHaveLength(1);
    expect(readVerificationWorkerState('PAN-1')?.dispatchOwed?.head).toBe(headB);
  });

  /** A live worker at boot with a tracked file modified; it writes `passed` while joined. */
  function liveWorkerWithDirtyTree(cleanBeforePass: boolean): void {
    const liveResult = registerLiveWorker(commit('a'), { logPrefix: 'request-review', options: {} });
    writeFileSync(join(mocks.workspace, 'a'), 'installing');
    // Probe 1 is the boot listing; probe 2 the supervisor's join check.
    waitProbeAt = 3;
    onWaitProbe = () => {
      if (cleanBeforePass) git('checkout', '--', 'a');
      writeFileSync(liveResult, JSON.stringify({ outcome: 'passed' }));
    };
  }

  it('AC-2: a live worker with a tracked file modified at boot dispatches review when it writes passed, with no re-request', async () => {
    liveWorkerWithDirtyTree(true);
    const { pipeline, pushBranch, dispatchReview, starter } = resumingStarter();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    expect(await adoptSurvivingVerificationWorkers()).toEqual(['PAN-1']);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(pipeline.isInFlight('PAN-1')).toBe(false));

    expect(starter).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(dispatchReview).toHaveBeenCalledTimes(1);
    expect(mocks.launches).toHaveLength(0);
  });

  it('a tree still dirty at dispatch falls back: nothing is pushed or dispatched, and the reason is journalled', async () => {
    liveWorkerWithDirtyTree(false);
    const { pipeline, pushBranch, dispatchReview } = resumingStarter();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    expect(await adoptSurvivingVerificationWorkers()).toEqual(['PAN-1']);
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(pipeline.isInFlight('PAN-1')).toBe(false));

    expect(pushBranch).not.toHaveBeenCalled();
    expect(dispatchReview).not.toHaveBeenCalled();
    expect(journalTail()).toMatchObject({
      type: 'review.resume-declined',
      source: 'verification-adoption',
      data: { reason: 'the working tree has uncommitted changes', head: git('rev-parse', 'HEAD').slice(0, 8) },
    });
    // The pass stays owed, so the recovered request dispatches without re-running the gates.
    expect(readVerificationWorkerState('PAN-1')?.dispatchOwed).toBeDefined();
  });
});
