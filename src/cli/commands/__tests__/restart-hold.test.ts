/**
 * PAN-5007: `pan restart hold` / `pan restart release`, and the refusal that
 * `pan restart` (including `--now`) and `pan restart approve` run while a hold
 * is active. The hold file is real (a temp OVERDECK_HOME); the restart gate,
 * restart lock and dashboard lifecycle are mocked.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approveRestartGate: vi.fn(),
  claimRestartGate: vi.fn(),
  registerRestartGateRequest: vi.fn(),
  waitForRestartApproval: vi.fn(),
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  writeRestartStatus: vi.fn(),
  readPlatformConfig: vi.fn(),
  restartDashboard: vi.fn(),
  readDevSupervisorMarker: vi.fn(),
}));

vi.mock('../../../lib/restart-gate-client.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/restart-gate-client.js')>()),
  approveRestartGate: mocks.approveRestartGate,
  claimRestartGate: mocks.claimRestartGate,
  registerRestartGateRequest: mocks.registerRestartGateRequest,
  waitForRestartApproval: mocks.waitForRestartApproval,
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/restart-status.js', () => ({ writeRestartStatus: mocks.writeRestartStatus }));

vi.mock('../../../lib/platform-lifecycle.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/platform-lifecycle.js')>()),
  readPlatformConfig: mocks.readPlatformConfig,
  restartDashboard: mocks.restartDashboard,
}));

vi.mock('../../../lib/dev-supervisor.js', () => ({
  readDevSupervisorMarker: mocks.readDevSupervisorMarker,
  devSupervisorRefusalLines: () => [],
}));

import { restartApproveCommand, restartCommand } from '../restart.js';
import { restartHoldCommand, restartReleaseCommand } from '../restart-hold.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
const originalInitiator = process.env.OVERDECK_RESTART_INITIATOR;
const originalAgentId = process.env.OVERDECK_AGENT_ID;
let testHome: string;

function holdPath(): string {
  return join(testHome, 'restart-hold.json');
}

function output(stream: 'log' | 'error'): string {
  return vi.mocked(console[stream]).mock.calls.map((args) => args.map(String).join(' ')).join('\n');
}

describe('operator restart hold (PAN-5007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    testHome = join(tmpdir(), `overdeck-restart-hold-cli-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    delete process.env.OVERDECK_RESTART_INITIATOR;
    delete process.env.OVERDECK_AGENT_ID;
    vi.spyOn(process, 'cwd').mockReturnValue(testHome);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.approveRestartGate.mockResolvedValue({ approved: true, pendingCount: 1 });
    mocks.readRestartLockHolder.mockResolvedValue(null);
    mocks.acquireRestartLock.mockResolvedValue(null);
    mocks.writeRestartStatus.mockResolvedValue(undefined);
    mocks.readPlatformConfig.mockReturnValue({ dashboardPort: 3010, dashboardApiPort: 3011, traefikEnabled: false });
    mocks.readDevSupervisorMarker.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    if (originalInitiator === undefined) delete process.env.OVERDECK_RESTART_INITIATOR;
    else process.env.OVERDECK_RESTART_INITIATOR = originalInitiator;
    if (originalAgentId === undefined) delete process.env.OVERDECK_AGENT_ID;
    else process.env.OVERDECK_AGENT_ID = originalAgentId;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('hold writes the reason, setter and expiry; --status reports it; release removes it', async () => {
    process.env.OVERDECK_AGENT_ID = 'conv-flywheel';
    await restartHoldCommand({ reason: 'live three-machine check', until: '2h' });

    const stored = JSON.parse(readFileSync(holdPath(), 'utf8'));
    expect(stored).toMatchObject({ reason: 'live three-machine check', who: 'conv-flywheel' });
    expect(Date.parse(stored.until) - Date.parse(stored.setAt)).toBeGreaterThan(7_190_000);

    await restartHoldCommand({ status: true });
    expect(output('log')).toContain('Restart hold active');

    await restartReleaseCommand();
    expect(existsSync(holdPath())).toBe(false);
    expect(output('log')).toContain('Released the restart hold');
  });

  it('hold without --reason is a usage error and writes nothing', async () => {
    await restartHoldCommand({});

    expect(process.exitCode).toBe(2);
    expect(existsSync(holdPath())).toBe(false);
  });

  it('hold rejects a bad --until and writes nothing', async () => {
    await restartHoldCommand({ reason: 'x', until: 'later' });

    expect(process.exitCode).toBe(2);
    expect(existsSync(holdPath())).toBe(false);
  });

  it('pan restart approve refuses while held and approves after release', async () => {
    await restartHoldCommand({ reason: 'live check' });

    await restartApproveCommand();
    expect(process.exitCode).toBe(1);
    expect(mocks.approveRestartGate).not.toHaveBeenCalled();
    expect(output('error')).toContain('pan restart release');

    process.exitCode = undefined;
    await restartReleaseCommand();
    await restartApproveCommand();
    expect(mocks.approveRestartGate).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [{}, 'pan restart'],
    [{ now: true }, 'pan restart --now'],
    [{ full: true, now: true }, 'pan restart --full --now'],
  ])('%o (%s) refuses before touching the gate or the lock', async (options) => {
    await restartHoldCommand({ reason: 'live check' });

    await restartCommand(options);

    expect(process.exitCode).toBe(1);
    expect(output('error')).toContain('"live check"');
    expect(mocks.registerRestartGateRequest).not.toHaveBeenCalled();
    expect(mocks.approveRestartGate).not.toHaveBeenCalled();
    expect(mocks.waitForRestartApproval).not.toHaveBeenCalled();
    expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
  });

  it('an expired hold does not block a restart', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse('2026-11-04T10:00:00.000Z'));
      await restartHoldCommand({ reason: 'short check', until: '30m' });
      vi.setSystemTime(Date.parse('2026-11-04T10:31:00.000Z'));

      await restartApproveCommand();
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.approveRestartGate).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('the supervisor watchdog restart is exempt: it reaches the restart lock', async () => {
    await restartHoldCommand({ reason: 'live check' });
    process.env.OVERDECK_RESTART_INITIATOR = 'supervisor-watchdog';

    await restartCommand({ dashboard: true });

    expect(output('error')).not.toContain('restart hold is active');
    // The mocked lock is held, so the restart stops at the lock instead.
    expect(mocks.acquireRestartLock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2);
  });
});
