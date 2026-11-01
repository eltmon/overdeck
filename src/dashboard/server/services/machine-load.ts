/**
 * This machine's load sample (PAN-4651 FR-6, D-4651-8).
 *
 * Every 15 s: CPU PSI `some avg10` and the governor's saturated verdict
 * (`assessCpuPressure`), available memory in bytes (`readProcMemory`), and the
 * number of live agents whose state is `working` (the fleet-update definition,
 * `countWorkingTurns`). The heartbeat reads the last sample and never waits;
 * placement takes a fresh one with `sampleMachineLoad()`.
 *
 * Smoke hook: `OVERDECK_TEST_FORCE_CPU_SATURATED=1` forces `cpuSaturated: true`
 * so `scripts/anywhere/two-machine-smoke.mjs` (WI-30) can make Auto avoid a
 * machine. It is read here and nowhere else.
 */
import type { LoadSample } from '@overdeck/contracts';

import { assessCpuPressure } from '../../../lib/cloister/cpu-pressure.js';
import { getLiveAgentDirectory } from './agent-directory.js';
import { readProcMemory } from './proc-memory.js';

export const LOAD_SAMPLE_INTERVAL_MS = 15_000;

/** Live agents whose state is `working` (also the fleet-update "turn in progress" count). */
export async function countWorkingTurns(): Promise<number> {
  return (await getLiveAgentDirectory()).entries.filter((entry) => entry.state === 'working').length;
}

export interface MachineLoadDeps {
  assessCpu: () => Promise<{ saturated: boolean; psiSomeAvg10: number | null }>;
  memAvailableBytes: () => Promise<number | null>;
  workingAgents: () => Promise<number>;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export const defaultMachineLoadDeps = (): MachineLoadDeps => ({
  assessCpu: assessCpuPressure,
  memAvailableBytes: async () => (await readProcMemory()).memAvailable || null,
  workingAgents: countWorkingTurns,
  now: () => new Date(),
  env: process.env,
});

/** One sample; a failed reader yields its unknown value, never an error. */
export async function sampleMachineLoad(deps: MachineLoadDeps = defaultMachineLoadDeps()): Promise<LoadSample> {
  const [cpu, mem, working] = await Promise.all([
    deps.assessCpu().catch(() => null),
    deps.memAvailableBytes().catch(() => null),
    deps.workingAgents().catch(() => 0),
  ]);
  return {
    cpuPsiSomeAvg10: cpu?.psiSomeAvg10 ?? null,
    cpuSaturated: deps.env['OVERDECK_TEST_FORCE_CPU_SATURATED'] === '1' || (cpu?.saturated ?? false),
    memAvailableBytes: mem,
    workingAgents: working,
    sampledAt: deps.now().toISOString(),
  };
}

let last: LoadSample | null = null;
let timer: NodeJS.Timeout | null = null;

/** The last sample; null until the first one finishes. */
export function currentMachineLoad(): LoadSample | null {
  return last;
}

/** Sample now and every 15 s; the interval is unref'd. */
export function startMachineLoadSampler(deps: MachineLoadDeps = defaultMachineLoadDeps()): void {
  if (timer) return;
  const sample = (): void => {
    void sampleMachineLoad(deps).then((next) => { last = next; });
  };
  sample();
  timer = setInterval(sample, LOAD_SAMPLE_INTERVAL_MS);
  timer.unref?.();
}

export function stopMachineLoadSampler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  last = null;
}
