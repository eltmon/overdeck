/**
 * PAN-5007: the dashboard's own restart button must not approve waiting
 * restart requests past the operator restart hold.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  satisfyForDirectRestart: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../restart-gate.js', () => ({
  getRestartGate: () => ({ satisfyForDirectRestart: mocks.satisfyForDirectRestart }),
}));

import { writeRestartHold } from '../../../../lib/restart-hold.js';
import { restartDashboardDetached } from '../dashboard-restart.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

describe('restartDashboardDetached and the restart hold (PAN-5007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testHome = join(tmpdir(), `overdeck-dashboard-restart-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    mocks.satisfyForDirectRestart.mockResolvedValue(undefined);
    mocks.spawn.mockReturnValue({ pid: 4242, on: vi.fn(), unref: vi.fn() });
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('refuses before approving anything or spawning a restart while held', async () => {
    await writeRestartHold({ reason: 'live check', who: 'operator', setAt: new Date().toISOString() });

    const result = await restartDashboardDetached('dashboard-ui:1');

    expect(result).toMatchObject({ ok: false, held: true });
    expect(result.ok ? '' : result.error).toContain('pan restart release');
    expect(mocks.satisfyForDirectRestart).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('restarts as before when no hold is set', async () => {
    const result = await restartDashboardDetached('dashboard-ui:1');

    expect(result).toEqual({ ok: true, pid: 4242 });
    expect(mocks.satisfyForDirectRestart).toHaveBeenCalledWith('dashboard-ui:1');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});
