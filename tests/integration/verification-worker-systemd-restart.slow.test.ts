/** @slow Real systemd cgroup replacement regression for PAN-3814. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isVerificationWorkerActive,
  readVerificationWorkerState,
  runSupervisedVerification,
} from '../../src/lib/cloister/verification-worker-supervisor.js';

const hasUserSystemd = process.platform === 'linux'
  && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status === 0;
const originalHome = process.env.OVERDECK_HOME;
const originalWorkerPath = process.env.OVERDECK_VERIFICATION_WORKER_PATH;
const originalDelay = process.env.VERIFICATION_FIXTURE_DELAY_MS;
const originalScope = process.env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE;
const homes: string[] = [];
const units: string[] = [];

function stopUnit(unit: string): void {
  try {
    execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' });
  } catch { /* already stopped and collected */ }
}

afterEach(() => {
  for (const unit of units.splice(0)) stopUnit(unit);
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (originalWorkerPath === undefined) delete process.env.OVERDECK_VERIFICATION_WORKER_PATH;
  else process.env.OVERDECK_VERIFICATION_WORKER_PATH = originalWorkerPath;
  if (originalDelay === undefined) delete process.env.VERIFICATION_FIXTURE_DELAY_MS;
  else process.env.VERIFICATION_FIXTURE_DELAY_MS = originalDelay;
  if (originalScope === undefined) delete process.env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE;
  else process.env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE = originalScope;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe.skipIf(!hasUserSystemd)('verification worker systemd restart boundary', () => {
  it('survives replacement of the dashboard scope and lets the replacement join its result', async () => {
    const home = mkdtempSync(join(tmpdir(), 'verification-systemd-restart-'));
    homes.push(home);
    process.env.OVERDECK_HOME = home;
    process.env.OVERDECK_VERIFICATION_WORKER_PATH = join(
      process.cwd(),
      'tests/fixtures/verification-worker-fixture.mjs',
    );
    process.env.VERIFICATION_FIXTURE_DELAY_MS = '1500';
    process.env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE = '1';

    const dashboardUnit = `overdeck-verification-dashboard-test-${process.pid}-${Date.now()}`;
    units.push(`${dashboardUnit}.scope`);
    const dashboard = spawn('systemd-run', [
      '--user', '--scope', '--unit', dashboardUnit, '--collect', '--quiet', '--same-dir',
      process.execPath,
      '--import', 'tsx',
      join(process.cwd(), 'tests/fixtures/verification-supervisor-parent.ts'),
    ], { detached: true, env: { ...process.env }, stdio: 'ignore' });
    dashboard.unref();

    await vi.waitFor(() => expect(isVerificationWorkerActive('PAN-2597')).toBe(true));
    const worker = readVerificationWorkerState('PAN-2597')!;
    expect(worker.systemdUnit).toMatch(/^overdeck-verification-pan-2597-/);
    units.push(`${worker.systemdUnit}.scope`);

    stopUnit(`${dashboardUnit}.scope`);
    await vi.waitFor(() => expect(() => process.kill(dashboard.pid!, 0)).toThrow());
    expect(isVerificationWorkerActive('PAN-2597')).toBe(true);

    await expect(runSupervisedVerification(
      'PAN-2597',
      '/tmp/workspace',
      { isRemote: false },
      'replacement-dashboard',
      { syncTargetBranch: false },
    )).resolves.toEqual({ outcome: 'passed' });
    expect(readVerificationWorkerState('PAN-2597')!.pid).toBe(worker.pid);
  }, 10_000);
});
