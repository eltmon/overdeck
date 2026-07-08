import { readProcMemory } from '../../dashboard/server/services/system-health-service.js';
import { getResourceConfig } from '../../dashboard/server/services/system-health-service.js';

const GIB = 1024 ** 3;

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';

export interface MemoryPressureThresholds {
  warningBytes: number;
  criticalBytes: number;
}

export interface MemoryVerdict {
  band: MemoryPressureBand;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
}

/**
 * Shared memory-pressure predicate — the single source of truth for both the
 * HTTP spawn path (evaluateSpawnGuardrails) and the deacon's autonomous
 * resume/dispatch path (PAN-2500). Never fork this comparison.
 */
export function classifyMemoryPressure(
  availableBytes: number,
  thresholds: MemoryPressureThresholds,
): MemoryPressureBand {
  if (availableBytes < thresholds.criticalBytes) return 'hard';
  if (availableBytes < thresholds.warningBytes) return 'soft';
  return 'ok';
}

/**
 * Read live MemAvailable via the existing async /proc parser and classify it.
 * `ok` maps to the resume/dispatch gates' pre-PAN-2500 count+load-only behavior;
 * `soft`/`hard` gate admission (wire-deacon-gate) and drive eviction
 * (tiered-eviction).
 */
export async function assessMemoryPressure(): Promise<MemoryVerdict> {
  const resources = getResourceConfig();
  const thresholds: MemoryPressureThresholds = {
    warningBytes: resources.memoryWarnGb * GIB,
    criticalBytes: resources.memoryBlockGb * GIB,
  };
  const snapshot = await readProcMemory();
  return {
    band: classifyMemoryPressure(snapshot.memAvailable, thresholds),
    availableBytes: snapshot.memAvailable,
    thresholds,
  };
}
