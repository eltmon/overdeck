/**
 * CPU Pressure Stall Information (PAN-4311).
 *
 * `/proc/pressure/cpu` reports, per window, the share of time at least one
 * runnable task waited for a CPU (`some`). Unlike load average it does not
 * count tasks blocked on IO, so it measures CPU contention only.
 *
 * Lives in `src/lib/system-health/` so CLI paths (`pan start` → spawnAgent)
 * can import it without pulling dashboard modules into their graph.
 */

import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';

export interface CpuPsi {
  /** `some avg10`, percent; null when unavailable. */
  readonly someAvg10: number | null;
  /** `some avg60`, percent; null when unavailable. */
  readonly someAvg60: number | null;
}

const UNAVAILABLE: CpuPsi = Object.freeze({ someAvg10: null, someAvg60: null });

function field(line: string, name: string): number | null {
  const match = line.match(new RegExp(`(?:^|\\s)${name}=([^\\s]+)`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse the `some` line of `/proc/pressure/cpu`; missing or malformed fields are null. */
export function parseCpuPsi(content: string): CpuPsi {
  const some = content.split('\n').find((line) => line.startsWith('some '));
  if (!some) return UNAVAILABLE;
  return { someAvg10: field(some, 'avg10'), someAvg60: field(some, 'avg60') };
}

/** Read CPU PSI; null fields off Linux or when the kernel does not expose it. */
export async function readCpuPsi(): Promise<CpuPsi> {
  if (platform() !== 'linux') return UNAVAILABLE;
  try {
    return parseCpuPsi(await readFile('/proc/pressure/cpu', 'utf-8'));
  } catch {
    return UNAVAILABLE;
  }
}
