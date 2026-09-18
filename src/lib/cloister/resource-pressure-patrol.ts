import { patrolDiskPressure } from './disk-pressure-patrol.js';
import { patrolMemoryPressure } from './memory-pressure-patrol.js';

interface ResourcePressurePatrolDeps {
  patrolMemory: () => Promise<string[]>;
  patrolDisk: () => Promise<string[]>;
}

export async function patrolResourcePressure(
  deps: Partial<ResourcePressurePatrolDeps> = {},
): Promise<string[]> {
  const results = await Promise.allSettled([
    (deps.patrolMemory ?? patrolMemoryPressure)(),
    (deps.patrolDisk ?? patrolDiskPressure)(),
  ]);
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const source = index === 0 ? 'memory-pressure-patrol' : 'disk-pressure-patrol';
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return [`${source}: error: ${reason}`];
  });
}
