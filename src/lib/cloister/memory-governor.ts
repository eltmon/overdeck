import {
  getResourceConfig,
  readGlobalResourceConfig,
  readProcMemory,
  type SystemHealthThresholds,
} from '../../dashboard/server/services/system-health-service.js';

const GIB = 1024 ** 3;

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';

export type MemoryPressureThresholds = Pick<
  SystemHealthThresholds,
  'memoryAvailableWarningBytes' | 'memoryAvailableCriticalBytes'
>;

export interface MemoryVerdict {
  band: MemoryPressureBand;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
}

export function classifyMemoryPressure(
  availableBytes: number,
  thresholds: MemoryPressureThresholds,
): MemoryPressureBand {
  if (availableBytes < thresholds.memoryAvailableCriticalBytes) return 'hard';
  if (availableBytes < thresholds.memoryAvailableWarningBytes) return 'soft';
  return 'ok';
}

export async function assessMemoryPressure(): Promise<MemoryVerdict> {
  await readGlobalResourceConfig();
  const resources = getResourceConfig();
  const thresholds: MemoryPressureThresholds = {
    memoryAvailableWarningBytes: resources.memoryWarnGb * GIB,
    memoryAvailableCriticalBytes: resources.memoryBlockGb * GIB,
  };
  const memory = await readProcMemory();

  return {
    band: classifyMemoryPressure(memory.memAvailable, thresholds),
    availableBytes: memory.memAvailable,
    thresholds,
  };
}
