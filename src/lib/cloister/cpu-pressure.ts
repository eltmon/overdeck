/**
 * Stateless CPU pressure check for dispatch doors (PAN-4311 D2).
 *
 * The governor's hysteresis runs only in the deacon child, and its verdict
 * cannot be read from the dashboard main process or a `pan` CLI process. The
 * lane door, the spawn guardrail and the Flywheel spawn hold therefore read
 * the kernel directly and compare against the hold threshold, with no stored
 * state: every process gets the same answer for the same moment.
 *
 * Signal: PSI `some avg60` against `resources.governor_cpu_psi_hold_avg60`;
 * load per core against `resources.governor_cpu_soft_load_per_core` only when
 * PSI is unavailable.
 */

import { cpus, loadavg } from 'node:os';

import { loadConfigSync } from '../config-yaml/load.js';
import { readCpuPsi } from '../system-health/cpu-psi.js';

export interface CpuPressureReading {
  readonly psiSomeAvg10: number | null;
  readonly psiSomeAvg60: number | null;
  readonly loadPerCore: number;
}

export interface CpuPressureVerdict {
  readonly saturated: boolean;
  readonly signal: 'psi-some-avg60' | 'load-per-core';
  readonly reading: number;
  readonly threshold: number;
  readonly psiSomeAvg10: number | null;
}

export interface CpuPressureThresholds {
  readonly psiHoldAvg60: number;
  readonly loadHoldPerCore: number;
}

/** PSI when present, else load per core; saturated at or above the threshold. */
export function classifyCpuPressure(
  reading: CpuPressureReading,
  thresholds: CpuPressureThresholds,
): CpuPressureVerdict {
  if (reading.psiSomeAvg60 != null) {
    return {
      saturated: reading.psiSomeAvg60 >= thresholds.psiHoldAvg60,
      signal: 'psi-some-avg60',
      reading: reading.psiSomeAvg60,
      threshold: thresholds.psiHoldAvg60,
      psiSomeAvg10: reading.psiSomeAvg10,
    };
  }
  return {
    saturated: reading.loadPerCore >= thresholds.loadHoldPerCore,
    signal: 'load-per-core',
    reading: reading.loadPerCore,
    threshold: thresholds.loadHoldPerCore,
    psiSomeAvg10: reading.psiSomeAvg10,
  };
}

export async function readCpuPressure(): Promise<CpuPressureReading> {
  const psi = await readCpuPsi();
  const cores = Math.max(1, cpus().length);
  return { psiSomeAvg10: psi.someAvg10, psiSomeAvg60: psi.someAvg60, loadPerCore: loadavg()[0]! / cores };
}

export async function assessCpuPressure(): Promise<CpuPressureVerdict> {
  const { resources } = loadConfigSync().config;
  return classifyCpuPressure(await readCpuPressure(), {
    psiHoldAvg60: resources.governorCpuPsiHoldAvg60,
    loadHoldPerCore: resources.governorCpuSoftLoadPerCore,
  });
}
