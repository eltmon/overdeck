import { readFile } from 'node:fs/promises';
import { freemem } from 'node:os';

import { loadConfigSync } from '../config-yaml.js';

const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';

export interface MemoryPressureAssessment {
  band: MemoryPressureBand;
  availMB: number;
  availBytes: number;
  warningBytes: number;
  criticalBytes: number;
}

export function classifyMemoryPressure(
  availBytes: number,
  warningBytes: number,
  criticalBytes: number,
): MemoryPressureBand {
  if (availBytes < criticalBytes) return 'hard';
  if (availBytes < warningBytes) return 'soft';
  return 'ok';
}

async function readAvailableMemoryBytes(): Promise<number> {
  if (process.platform !== 'linux') return freemem();

  try {
    const content = await readFile('/proc/meminfo', 'utf-8');
    const memAvailable = content.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    const memFree = content.match(/^MemFree:\s+(\d+)\s+kB$/m);
    const kb = Number(memAvailable?.[1] ?? memFree?.[1]);
    if (Number.isFinite(kb) && kb > 0) return kb * KB;
  } catch {
    // Fall back to os.freemem() on non-standard Linux environments.
  }

  return freemem();
}

export async function assessMemoryPressure(): Promise<MemoryPressureAssessment> {
  const availBytes = await readAvailableMemoryBytes();
  const resources = loadConfigSync().config.resources;
  const warningBytes = resources.memoryWarnGb * GB;
  const criticalBytes = resources.memoryBlockGb * GB;

  return {
    band: classifyMemoryPressure(availBytes, warningBytes, criticalBytes),
    availMB: Math.round(availBytes / MB),
    availBytes,
    warningBytes,
    criticalBytes,
  };
}
