import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isVerificationWorkerActive,
  readVerificationWorkerState,
  runSupervisedVerification,
} from '../../../../src/lib/cloister/verification-worker-supervisor.js';

const originalHome = process.env.OVERDECK_HOME;
const originalWorkerPath = process.env.OVERDECK_VERIFICATION_WORKER_PATH;
const originalDelay = process.env.VERIFICATION_FIXTURE_DELAY_MS;
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
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('verification worker supervisor', () => {
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
    expect(JSON.parse(readFileSync(state!.resultPath, 'utf8'))).toEqual({ outcome: 'passed' });
    expect(state!.resultPath).toContain(join(home, 'verification-workers', 'pan-2597'));
  });

  it('joins one live worker instead of starting duplicate verification', async () => {
    useFixture(500);

    const first = runSupervisedVerification('PAN-2597', '/tmp/workspace', { isRemote: false }, 'test');
    await vi.waitFor(() => expect(isVerificationWorkerActive('PAN-2597')).toBe(true));
    const firstPid = readVerificationWorkerState('PAN-2597')!.pid;
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
