/**
 * Opt-in hold of Flywheel-started work agents under CPU pressure (PAN-4311 FR-15, D3).
 *
 * Off by default (`resources.governor_cpu_hold_dispatch: false`) until the CPU
 * PSI calibration log shows a threshold that does not wedge the pipeline. Only
 * a spawn whose `startedBy` is `flywheel:*` is ever held; operator starts,
 * dashboard Start and conversations never read this.
 */

import { assessCpuPressure, type CpuPressureVerdict } from '../cloister/cpu-pressure.js';
import { loadConfigSync } from '../config-yaml/load.js';
import { isFlywheelStartedBy } from './provenance.js';

export class CpuPressureHoldError extends Error {
  readonly code = 'cpu-pressure-hold' as const;

  constructor(readonly verdict: CpuPressureVerdict) {
    super(
      `Flywheel spawn held: the host is CPU-saturated (${verdict.signal} ${verdict.reading} is at or above ${verdict.threshold}). `
      + 'It will be retried; set resources.governor_cpu_hold_dispatch: false to disable this hold.',
    );
    this.name = 'CpuPressureHoldError';
  }
}

export function shouldHoldSpawnForCpu(startedBy: string, holdDispatch: boolean, cpu: CpuPressureVerdict): boolean {
  return holdDispatch && isFlywheelStartedBy(startedBy) && cpu.saturated;
}

export interface CpuDispatchHoldDeps {
  holdDispatch: () => boolean;
  assess: () => Promise<CpuPressureVerdict>;
}

const defaultDeps: CpuDispatchHoldDeps = {
  holdDispatch: () => loadConfigSync().config.resources.governorCpuHoldDispatch,
  assess: assessCpuPressure,
};

/** Throw `CpuPressureHoldError` for a Flywheel spawn while CPU is saturated and the hold is on. */
export async function assertSpawnAdmittedForCpu(
  startedBy: string,
  deps: CpuDispatchHoldDeps = defaultDeps,
): Promise<void> {
  if (!deps.holdDispatch() || !isFlywheelStartedBy(startedBy)) return;
  const cpu = await deps.assess();
  if (shouldHoldSpawnForCpu(startedBy, true, cpu)) throw new CpuPressureHoldError(cpu);
}
