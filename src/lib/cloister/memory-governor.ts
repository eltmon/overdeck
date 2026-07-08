import {
  getResourceConfig,
  readGlobalResourceConfig,
  readProcMemory,
} from '../../dashboard/server/services/system-health-service.js';
import { type GovernorReserveConfig } from '../resource-governor.js';

const GIB = 1024 ** 3;

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';
export type MemoryGovernorMode = 'admitting' | 'holding' | 'shedding';

export interface MemoryPressureThresholds {
  softReserveBytes?: number;
  hardReserveBytes?: number;
  recoveryReserveBytes?: number;
  memoryAvailableWarningBytes?: number;
  memoryAvailableCriticalBytes?: number;
}

export interface MemoryVerdict {
  band: MemoryPressureBand;
  mode: MemoryGovernorMode;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
}

const DEFAULT_GOVERNOR_STATE: { mode: MemoryGovernorMode } = { mode: 'admitting' };
let governorState = { ...DEFAULT_GOVERNOR_STATE };

export function resetMemoryGovernorState(): void {
  governorState = { ...DEFAULT_GOVERNOR_STATE };
}

export function classifyMemoryPressure(
  availableBytes: number,
  thresholds: MemoryPressureThresholds,
): MemoryPressureBand {
  const hardReserveBytes = thresholds.hardReserveBytes ?? thresholds.memoryAvailableCriticalBytes ?? 0;
  const softReserveBytes = thresholds.softReserveBytes ?? thresholds.memoryAvailableWarningBytes ?? hardReserveBytes;
  if (availableBytes < hardReserveBytes) return 'hard';
  if (availableBytes < softReserveBytes) return 'soft';
  return 'ok';
}

function advanceGovernorMode(
  mode: MemoryGovernorMode,
  availableBytes: number,
  thresholds: MemoryPressureThresholds,
): MemoryGovernorMode {
  const hardReserveBytes = thresholds.hardReserveBytes ?? thresholds.memoryAvailableCriticalBytes ?? 0;
  const softReserveBytes = thresholds.softReserveBytes ?? thresholds.memoryAvailableWarningBytes ?? hardReserveBytes;
  const recoveryReserveBytes = thresholds.recoveryReserveBytes ?? softReserveBytes;

  if (availableBytes < hardReserveBytes) return 'shedding';
  if (availableBytes > recoveryReserveBytes) return 'admitting';
  if (mode === 'admitting' && availableBytes < softReserveBytes) return 'holding';
  if (mode === 'admitting') return 'admitting';
  return 'holding';
}

export async function assessMemoryPressure(): Promise<MemoryVerdict> {
  await readGlobalResourceConfig();
  const resources = getResourceConfig();
  const governorReserves: GovernorReserveConfig = {
    governorSoftReserveGb: resources.governorSoftReserveGb,
    governorHardReserveGb: resources.governorHardReserveGb,
    governorRecoveryReserveGb: resources.governorRecoveryReserveGb,
  };
  const thresholds: MemoryPressureThresholds = {
    softReserveBytes: governorReserves.governorSoftReserveGb * GIB,
    hardReserveBytes: governorReserves.governorHardReserveGb * GIB,
    recoveryReserveBytes: governorReserves.governorRecoveryReserveGb * GIB,
  };
  const memory = await readProcMemory();
  const band = classifyMemoryPressure(memory.memAvailable, thresholds);
  const mode = advanceGovernorMode(governorState.mode, memory.memAvailable, thresholds);
  governorState.mode = mode;

  return {
    band,
    mode,
    availableBytes: memory.memAvailable,
    thresholds,
  };
}
