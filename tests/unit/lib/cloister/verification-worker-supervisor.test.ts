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
