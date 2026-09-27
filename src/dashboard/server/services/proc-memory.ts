import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { freemem, platform, totalmem } from 'node:os';
import { promisify } from 'node:util';

import {
  computeDarwinAvailableMemoryBytes,
  parseDarwinPressureLevel,
  parseDarwinSwapUsage,
  parseDarwinVmStat,
  type DarwinMemoryPressureLevel,
} from '../../../lib/system-health/darwin.js';

const execAsync = promisify(exec);
const KB = 1024;

export interface ProcMemorySnapshot {
  memTotal: number;
  memAvailable: number;
  memFree: number;
  swapTotal: number;
  swapFree: number;
  committedAs: number;
  commitLimit: number;
  psiSomeAvg10: number | null;
  psiFullAvg10: number | null;
  /** PAN-4267: macOS's own kernel pressure level — the governor's macOS stall signal. */
  macPressureLevel: DarwinMemoryPressureLevel | null;
  /** PAN-4267: macOS allocates swap on demand, so a low free-swap share isn't pressure there. */
  swapGrowsOnDemand: boolean;
}

export function parseMemoryPsi(content: string): {
  someAvg10: number | null;
  fullAvg10: number | null;
} {
  let someAvg10: number | null = null;
  let fullAvg10: number | null = null;

  for (const line of content.split('\n')) {
    const match = line.match(/^(some|full)\s+.*\bavg10=([^\s]+)/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0) continue;
    if (match[1] === 'some') someAvg10 = value;
    if (match[1] === 'full') fullAvg10 = value;
  }

  return { someAvg10, fullAvg10 };
}

async function readProcMemoryLinux(): Promise<ProcMemorySnapshot> {
  const content = await readFile('/proc/meminfo', 'utf-8');
  const values = new Map<string, number>();

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1] ?? '', Number(match[2] ?? '0') * KB);
  }

  let psiSomeAvg10: number | null = null;
  let psiFullAvg10: number | null = null;
  try {
    const psi = parseMemoryPsi(await readFile('/proc/pressure/memory', 'utf-8'));
    psiSomeAvg10 = psi.someAvg10;
    psiFullAvg10 = psi.fullAvg10;
  } catch { /* PSI is unavailable on older or restricted Linux hosts */ }

  return {
    memTotal: values.get('MemTotal') ?? 0,
    memAvailable: values.get('MemAvailable') ?? values.get('MemFree') ?? 0,
    memFree: values.get('MemFree') ?? 0,
    swapTotal: values.get('SwapTotal') ?? 0,
    swapFree: values.get('SwapFree') ?? 0,
    committedAs: values.get('Committed_AS') ?? 0,
    commitLimit: values.get('CommitLimit') ?? 0,
    psiSomeAvg10,
    psiFullAvg10,
    macPressureLevel: null,
    swapGrowsOnDemand: false,
  };
}

async function readProcMemoryDarwin(): Promise<ProcMemorySnapshot> {
  const memTotal = totalmem();

  let pressureOutput: string | null = null;
  try {
    const { stdout } = await execAsync('memory_pressure -Q', { encoding: 'utf-8', timeout: 5_000 });
    pressureOutput = stdout;
  } catch { /* memory_pressure is unavailable or timed out */ }

  let vmStatOutput: string | null = null;
  try {
    const { stdout } = await execAsync('vm_stat', { encoding: 'utf-8', timeout: 5_000 });
    vmStatOutput = stdout;
  } catch { /* vm_stat is unavailable or timed out */ }

  // PAN-4267: share the one available-memory calculation with the header
  // collector (src/lib/system-health/darwin.ts) instead of a second formula.
  const vmStat = vmStatOutput == null ? null : parseDarwinVmStat(vmStatOutput, memTotal);
  const memAvailable = computeDarwinAvailableMemoryBytes({
    pressureOutput,
    vmStatOutput,
    totalMemoryBytes: memTotal,
  }) ?? freemem();
  const memFree = vmStat?.availableMemoryBytes ?? freemem();

  let swapTotal = 0;
  let swapFree = 0;
  try {
    const { stdout } = await execAsync('sysctl -n vm.swapusage', { encoding: 'utf-8', timeout: 5_000 });
    const swapUsage = parseDarwinSwapUsage(stdout);
    if (swapUsage) {
      swapTotal = swapUsage.totalBytes;
      swapFree = swapUsage.freeBytes;
    }
  } catch { /* swap stats unavailable */ }

  // PAN-4267: the kernel's own pressure level is the governor's macOS stall
  // signal — macOS swap is allocated on demand, so a low free-swap share on
  // its own is not pressure (see swapGrowsOnDemand in memory-governor.ts).
  let macPressureLevel: DarwinMemoryPressureLevel | null = null;
  try {
    const { stdout } = await execAsync('sysctl -n kern.memorystatus_vm_pressure_level', { encoding: 'utf-8', timeout: 5_000 });
    macPressureLevel = parseDarwinPressureLevel(stdout);
  } catch { /* kern.memorystatus_vm_pressure_level is unavailable or timed out */ }

  return {
    memTotal,
    memAvailable,
    memFree,
    swapTotal,
    swapFree,
    committedAs: 0,
    commitLimit: 0,
    psiSomeAvg10: null,
    psiFullAvg10: null,
    macPressureLevel,
    swapGrowsOnDemand: true,
  };
}

export async function readProcMemory(): Promise<ProcMemorySnapshot> {
  return platform() === 'darwin' ? readProcMemoryDarwin() : readProcMemoryLinux();
}
