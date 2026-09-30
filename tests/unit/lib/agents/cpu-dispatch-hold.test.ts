import { describe, expect, it, vi } from 'vitest';

import type { CpuPressureVerdict } from '../../../../src/lib/cloister/cpu-pressure.js';
import {
  assertSpawnAdmittedForCpu,
  CpuPressureHoldError,
  shouldHoldSpawnForCpu,
} from '../../../../src/lib/agents/cpu-dispatch-hold.js';

const SATURATED: CpuPressureVerdict = {
  saturated: true,
  signal: 'psi-some-avg60',
  reading: 55,
  threshold: 50,
  psiSomeAvg10: 60,
};

function deps(holdDispatch: boolean, verdict: CpuPressureVerdict = SATURATED) {
  return { holdDispatch: () => holdDispatch, assess: vi.fn(async () => verdict) };
}

describe('Flywheel spawn CPU hold (PAN-4311 FR-15)', () => {
  it('refuses a Flywheel spawn while CPU is saturated and the hold is on', async () => {
    const d = deps(true);
    const error = await assertSpawnAdmittedForCpu('flywheel:conv-flywheel', d).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CpuPressureHoldError);
    expect((error as CpuPressureHoldError).code).toBe('cpu-pressure-hold');
    expect((error as Error).message).toContain('psi-some-avg60 55 is at or above 50');
    expect((error as Error).message).toContain('resources.governor_cpu_hold_dispatch: false');
  });

  it('never refuses an operator spawn', async () => {
    const d = deps(true);
    await expect(assertSpawnAdmittedForCpu('operator:cli', d)).resolves.toBeUndefined();
    expect(d.assess).not.toHaveBeenCalled();
  });

  it('never reads CPU pressure while the hold is off (the default)', async () => {
    const d = deps(false);
    await expect(assertSpawnAdmittedForCpu('flywheel:conv-flywheel', d)).resolves.toBeUndefined();
    expect(d.assess).not.toHaveBeenCalled();
  });

  it('admits a Flywheel spawn when CPU is not saturated', async () => {
    const d = deps(true, { ...SATURATED, saturated: false, reading: 20 });
    await expect(assertSpawnAdmittedForCpu('flywheel:conv-flywheel', d)).resolves.toBeUndefined();
  });

  it('is off by default in config', async () => {
    const { loadConfigSync } = await import('../../../../src/lib/config-yaml/load.js');
    expect(loadConfigSync().config.resources.governorCpuHoldDispatch).toBe(false);
  });

  it('holds only for a Flywheel start with the flag on and CPU saturated', () => {
    expect(shouldHoldSpawnForCpu('flywheel:conv-flywheel', true, SATURATED)).toBe(true);
    expect(shouldHoldSpawnForCpu('flywheel:conv-flywheel', false, SATURATED)).toBe(false);
    expect(shouldHoldSpawnForCpu('operator:cli', true, SATURATED)).toBe(false);
    expect(shouldHoldSpawnForCpu('flywheel:conv-flywheel', true, { ...SATURATED, saturated: false })).toBe(false);
  });
});
