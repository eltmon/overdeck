import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isVerificationWorkerActive,
  markVerificationWorkerAdmissionPhase,
  readVerificationWorkerState,
  runSupervisedVerification,
  verificationWorkerDeadline,
} from '../../../../src/lib/cloister/verification-worker-supervisor.js';
import { recordDeployIntent } from '../../../../src/lib/deploy/deploy-queue.js';

const originalHome = process.env.OVERDECK_HOME;
const originalWorkerPath = process.env.OVERDECK_VERIFICATION_WORKER_PATH;
const originalDelay = process.env.VERIFICATION_FIXTURE_DELAY_MS;
const originalEchoOptions = process.env.VERIFICATION_FIXTURE_ECHO_OPTIONS;
const homes: string[] = [];

function useFixture(delayMs = 100): string {
  const home = mkdtempSync(join(tmpdir(), 'verification-worker-'));
  homes.push(home);
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_VERIFICATION_WORKER_PATH = join(
    process.cwd(),
    'tests/fixtures/verification-worker-fixture.mjs',
  );
  process.env.VERIFICATION_FIXTURE_DELAY_MS = String(delayMs);
  return home;
}

afterEach(() => {
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (originalWorkerPath === undefined) delete process.env.OVERDECK_VERIFICATION_WORKER_PATH;
  else process.env.OVERDECK_VERIFICATION_WORKER_PATH = originalWorkerPath;
  if (originalDelay === undefined) delete process.env.VERIFICATION_FIXTURE_DELAY_MS;
  else process.env.VERIFICATION_FIXTURE_DELAY_MS = originalDelay;
  if (originalEchoOptions === undefined) delete process.env.VERIFICATION_FIXTURE_ECHO_OPTIONS;
  else process.env.VERIFICATION_FIXTURE_ECHO_OPTIONS = originalEchoOptions;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('verification worker supervisor', () => {
  it('starts the execution deadline at admission rather than queue time', () => {
    const queued = {
      runId: 'run-1',
      issueId: 'PAN-1',
      workspacePath: '/tmp/workspace',
      pid: process.pid,
      startedAt: '2026-07-19T00:00:00.000Z',
      resultPath: '/tmp/result.json',
      phase: 'queued' as const,
      admittedAt: null,
    };
    expect(verificationWorkerDeadline(queued)).toBeNull();

    const admittedAt = '2026-07-19T01:00:00.000Z';
    expect(verificationWorkerDeadline({ ...queued, phase: 'running', admittedAt }))
      .toBe(Date.parse(admittedAt) + 65 * 60 * 1000);
  });

  it('persists queued and running admission phases without resetting first admission', () => {
    const home = useFixture();
    const dir = join(home, 'verification-workers', 'pan-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      runId: 'run-1',
      issueId: 'PAN-1',
      workspacePath: '/tmp/workspace',
      pid: process.pid,
      startedAt: '2026-07-19T00:00:00.000Z',
      resultPath: join(dir, 'result.json'),
      phase: 'queued',
      admittedAt: null,
    }));

    markVerificationWorkerAdmissionPhase('PAN-1', {
      phase: 'running', gateName: 'typecheck', attempt: 1, admittedAt: '2026-07-19T01:00:00.000Z',
    });
    markVerificationWorkerAdmissionPhase('PAN-1', {
      phase: 'queued', gateName: 'lint', attempt: 1,
    });

    expect(readVerificationWorkerState('PAN-1')).toMatchObject({
      phase: 'queued',
      admittedAt: '2026-07-19T01:00:00.000Z',
      currentGate: 'lint',
      currentAttempt: 1,
    });
  });

  it('runs verification in a detached worker and returns its durable result', async () => {
    const home = useFixture();

    await expect(runSupervisedVerification(
      'PAN-2597',
      '/tmp/workspace',
      { isRemote: false },
      'test',
    )).resolves.toEqual({ outcome: 'passed' });

    const state = readVerificationWorkerState('PAN-2597');
    expect(state?.pid).toBeGreaterThan(0);
    expect(state).toMatchObject({ phase: 'queued', admittedAt: null });
    expect(JSON.parse(readFileSync(state!.resultPath, 'utf8'))).toEqual({ outcome: 'passed' });
    expect(state!.resultPath).toContain(join(home, 'verification-workers', 'pan-2597'));
  });

  it('preserves strike checklist policy across the detached worker boundary', async () => {
    useFixture();
    process.env.VERIFICATION_FIXTURE_ECHO_OPTIONS = '1';

    await expect(runSupervisedVerification(
      'PAN-2864',
      '/tmp/workspace',
      { isRemote: false },
      'test',
      { syncTargetBranch: false, skipPlanChecklist: true },
    )).resolves.toEqual({
      outcome: 'passed',
      options: { syncTargetBranch: false, skipPlanChecklist: true },
    });
  });

  it('spawns a worker even while a dashboard deploy is queued (PAN-3244)', async () => {
    useFixture();
    await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Deployment deferred because a merge specialist session is active.',
      blockedBy: [],
    });

    // Detached workers survive dashboard restarts, so a queued deploy must not
    // defer verification admission — the old drain gate froze every project's
    // pipeline whenever a deploy sat queued behind a busy flywheel run.
    await expect(runSupervisedVerification(
      'PAN-2597',
      '/tmp/workspace',
      { isRemote: false },
      'test',
    )).resolves.toEqual({ outcome: 'passed' });
    expect(readVerificationWorkerState('PAN-2597')?.pid).toBeGreaterThan(0);
  });

  it('joins one live worker instead of starting duplicate verification', async () => {
    useFixture(500);

    const first = runSupervisedVerification('PAN-2597', '/tmp/workspace', { isRemote: false }, 'test');
    await vi.waitFor(() => expect(isVerificationWorkerActive('PAN-2597')).toBe(true));
    const firstPid = readVerificationWorkerState('PAN-2597')!.pid;
    await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    });
    const second = runSupervisedVerification('PAN-2597', '/tmp/workspace', { isRemote: false }, 'test');

    await expect(Promise.all([first, second])).resolves.toEqual([
      { outcome: 'passed' },
      { outcome: 'passed' },
    ]);
    expect(readVerificationWorkerState('PAN-2597')!.pid).toBe(firstPid);
  });

  it('keeps verification alive after the process that dispatched it exits', async () => {
    useFixture(750);
    const parent = spawn(
      process.execPath,
      ['--import', 'tsx', join(process.cwd(), 'tests/fixtures/verification-supervisor-parent.ts')],
      { env: { ...process.env }, stdio: 'ignore' },
    );

    await vi.waitFor(() => expect(isVerificationWorkerActive('PAN-2597')).toBe(true));
    const worker = readVerificationWorkerState('PAN-2597')!;
    const parentExited = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
    parent.kill('SIGTERM');
    await parentExited;

    expect(isVerificationWorkerActive('PAN-2597')).toBe(true);
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(worker.resultPath, 'utf8'))).toEqual({ outcome: 'passed' });
    }, { timeout: 2_000 });
  });
});

describe('PAN-3674 follow-up: expired workers', () => {
  function writeWorkerState(home: string, issueId: string, state: Record<string, unknown>): string {
    const dir = join(home, 'verification-workers', issueId.toLowerCase());
    mkdirSync(dir, { recursive: true });
    const resultPath = join(dir, 'result-seeded.json');
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      runId: 'run-seeded',
      issueId,
      workspacePath: '/tmp/workspace',
      resultPath,
      phase: 'running',
      ...state,
    }));
    return resultPath;
  }

  it('never joins a worker past its deadline — kills it and starts fresh', async () => {
    const home = useFixture(100);
    // Stand-in for a live-but-expired worker: a detached sleeper with its own
    // process group, exactly like the real detached worker.
    const zombie = spawn('sleep', ['60'], { detached: true });
    zombie.unref();
    const zombiePid = zombie.pid!;
    writeWorkerState(home, 'PAN-3674', {
      pid: zombiePid,
      startedAt: new Date(Date.now() - 70 * 60_000).toISOString(),
      admittedAt: new Date(Date.now() - 66 * 60_000).toISOString(), // past the 65min budget
    });

    const outcome = await runSupervisedVerification('PAN-3674', '/tmp/workspace', { isRemote: false }, 'test');

    if (outcome.outcome !== 'passed') throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
    expect(outcome.outcome).toBe('passed');
    // The expired worker was killed rather than joined.
    expect(() => process.kill(zombiePid, 0)).toThrow();
    // A fresh worker took over the registration.
    const current = readVerificationWorkerState('PAN-3674');
    expect(current).not.toBeNull();
    expect(current!.pid).not.toBe(zombiePid);
  });

  it('kills the worker when the execution deadline fires mid-run', async () => {
    const home = useFixture(5_000); // slow fixture: outlives the deadline trip
    const pending = runSupervisedVerification('PAN-3675', '/tmp/workspace', { isRemote: false }, 'test');

    // Wait for the worker to register, then age its admission past the budget.
    const stateFile = join(home, 'verification-workers', 'pan-3675', 'state.json');
    let pid = -1;
    for (let i = 0; i < 100; i++) {
      const s = readVerificationWorkerState('PAN-3675');
      if (s) { pid = s.pid; break; }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(pid).toBeGreaterThan(0);
    const seeded = JSON.parse(readFileSync(stateFile, 'utf8'));
    seeded.admittedAt = new Date(Date.now() - 66 * 60_000).toISOString();
    writeFileSync(stateFile, JSON.stringify(seeded));

    const outcome = await pending;
    expect(outcome.outcome).toBe('error');
    expect(outcome.outcome === 'error' ? outcome.message : '').toContain('exceeded');
    // The kill ladder (TERM → 1s → KILL) is fire-and-forget behind the verdict —
    // poll for death instead of racing it.
    let dead = false;
    for (let i = 0; i < 120 && !dead; i++) {
      try { process.kill(pid, 0); } catch { dead = true; }
      if (!dead) await new Promise((r) => setTimeout(r, 25));
    }
    expect(dead).toBe(true);
  });
});
