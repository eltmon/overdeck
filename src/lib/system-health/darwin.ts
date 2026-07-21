import { execFile } from 'node:child_process';
import { cpus, loadavg, totalmem, type CpuInfo } from 'node:os';
import { promisify } from 'node:util';

import {
  available,
  unavailable,
  type CpuCounters,
  type HostHealthCollector,
  type HostMetricSample,
  type HostMetricSignal,
  type SwapCounters,
} from './types.js';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;
const MIB = 1024 ** 2;

export const DARWIN_MEMORY_PRESSURE_DEFAULTS = Object.freeze({
  warningFreePercent: 10,
  criticalFreePercent: 5,
  swapActivityWarningBytesPerMinute: 64 * MIB,
  swapActivityCriticalBytesPerMinute: 256 * MIB,
});

export interface DarwinCollectorAdapters {
  execFile(command: string, args: readonly string[], timeoutMs: number): Promise<string>;
  cpus(): CpuInfo[];
  loadAverage1m(): number;
  totalMemoryBytes(): number;
  now(): number;
}

export interface ParsedDarwinVmStat {
  pageSizeBytes: number;
  availableMemoryBytes?: number;
  swap?: SwapCounters;
}

export interface ParsedDarwinSwapUsage {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export function parseDarwinMemoryPressure(content: string): number | null {
  const patterns = [
    /System-wide memory free percentage:\s*([\d.]+)\s*%/i,
    /System-wide memory free percentage\s*=\s*([\d.]+)\s*%?/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  }
  return null;
}

export function parseDarwinVmStat(content: string): ParsedDarwinVmStat | null {
  const pageSizeMatch = content.match(/page size of\s+(\d+)\s+bytes/i);
  if (!pageSizeMatch) return null;
  const pageSizeBytes = Number(pageSizeMatch[1]);
  if (!Number.isFinite(pageSizeBytes) || pageSizeBytes <= 0) return null;

  const pages = new Map<string, number>();
  for (const line of content.split('\n')) {
    const match = line.match(/^([^:]+):\s+(\d+)\.?$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) pages.set(match[1]!.trim(), value);
  }

  const availablePageNames = ['Pages free', 'Pages inactive', 'Pages speculative'];
  const availablePages = availablePageNames.every((name) => pages.has(name))
    ? availablePageNames.reduce((sum, name) => sum + pages.get(name)!, 0)
    : undefined;
  const swapIn = pages.get('Swapins');
  const swapOut = pages.get('Swapouts');

  return {
    pageSizeBytes,
    availableMemoryBytes: availablePages == null ? undefined : availablePages * pageSizeBytes,
    swap: swapIn == null || swapOut == null ? undefined : { pagesIn: swapIn, pagesOut: swapOut },
  };
}

function unitBytes(value: string, unit: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const multiplier = unit.toUpperCase() === 'G'
    ? 1024 ** 3
    : unit.toUpperCase() === 'K'
      ? 1024
      : MIB;
  return Math.round(parsed * multiplier);
}

export function parseDarwinSwapUsage(content: string): ParsedDarwinSwapUsage | null {
  const total = content.match(/total\s*=\s*([\d.]+)([KMG])/i);
  const used = content.match(/used\s*=\s*([\d.]+)([KMG])/i);
  const free = content.match(/free\s*=\s*([\d.]+)([KMG])/i);
  if (!total || !used || !free) return null;

  const totalBytes = unitBytes(total[1]!, total[2]!);
  const usedBytes = unitBytes(used[1]!, used[2]!);
  const freeBytes = unitBytes(free[1]!, free[2]!);
  return totalBytes == null || usedBytes == null || freeBytes == null
    ? null
    : { totalBytes, usedBytes, freeBytes };
}

export function aggregateDarwinCpuCounters(cpuInfo: readonly CpuInfo[]): CpuCounters | null {
  if (cpuInfo.length === 0) return null;
  let idle = 0;
  let total = 0;
  for (const cpu of cpuInfo) {
    const values = Object.values(cpu.times);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    idle += cpu.times.idle;
    total += values.reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}

function computeCpuPercent(
  current: CpuCounters,
  previous: CpuCounters | null | undefined,
): HostMetricSignal<number> {
  if (!previous) return unavailable('A previous CPU time sample is required.');
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) {
    return unavailable('CPU times did not advance monotonically.');
  }
  return available(Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10);
}

function computeSwapActivity(
  current: SwapCounters,
  previous: SwapCounters | null | undefined,
  elapsedMs: number,
  pageSizeBytes: number,
): HostMetricSignal<number> {
  if (!previous) return unavailable('A previous swap counter sample is required.');
  const pages = current.pagesIn - previous.pagesIn + current.pagesOut - previous.pagesOut;
  if (pages < 0 || elapsedMs <= 0) return unavailable('Swap counters or sample timing were invalid.');
  return available(Math.round(pages * pageSizeBytes * 60_000 / elapsedMs));
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

const defaultAdapters: DarwinCollectorAdapters = {
  execFile: async (command, args, timeoutMs) => {
    const { stdout } = await execFileAsync(command, [...args], {
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
    return stdout;
  },
  cpus,
  loadAverage1m: () => loadavg()[0] ?? 0,
  totalMemoryBytes: totalmem,
  now: () => Date.now(),
};

async function command(
  adapters: DarwinCollectorAdapters,
  executable: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    return await adapters.execFile(executable, args, COMMAND_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export function createDarwinHostHealthCollector(
  adapters: DarwinCollectorAdapters = defaultAdapters,
): HostHealthCollector {
  return {
    platform: 'darwin',
    async sample(previous?: HostMetricSample): Promise<HostMetricSample> {
      const sampledAtMs = adapters.now();
      const [pressureOutput, vmStatOutput, swapOutput] = await Promise.all([
        command(adapters, 'memory_pressure', ['-Q']),
        command(adapters, 'vm_stat', []),
        command(adapters, 'sysctl', ['-n', 'vm.swapusage']),
      ]);
      const pressureFreePercent = pressureOutput == null
        ? null
        : parseDarwinMemoryPressure(pressureOutput);
      const vmStat = vmStatOutput == null ? null : parseDarwinVmStat(vmStatOutput);
      const swapUsage = swapOutput == null ? null : parseDarwinSwapUsage(swapOutput);
      const cpuInfo = adapters.cpus();
      const cpuCounters = aggregateDarwinCpuCounters(cpuInfo);
      const totalMemoryBytes = adapters.totalMemoryBytes();
      const availableMemoryBytes = pressureFreePercent != null
        ? Math.round(totalMemoryBytes * pressureFreePercent / 100)
        : vmStat?.availableMemoryBytes ?? null;
      const usedMemoryBytes = Number.isFinite(totalMemoryBytes) && availableMemoryBytes != null
        ? Math.max(totalMemoryBytes - availableMemoryBytes, 0)
        : null;
      const loadAverage1m = adapters.loadAverage1m();
      const elapsedMs = previous ? sampledAtMs - previous.sampledAtMs : 0;

      return {
        platform: 'darwin',
        sampledAtMs,
        cpuPercent: cpuCounters
          ? computeCpuPercent(cpuCounters, previous?.counters.cpu)
          : unavailable('macOS CPU times are unavailable.'),
        loadAverage1m: Number.isFinite(loadAverage1m) && loadAverage1m >= 0
          ? available(loadAverage1m)
          : unavailable('The one-minute load average is unavailable.'),
        loadPerCore1m: Number.isFinite(loadAverage1m) && loadAverage1m >= 0
          && cpuInfo.length > 0
          ? available(Math.round((loadAverage1m / cpuInfo.length) * 100) / 100)
          : unavailable('Load average or CPU core count is unavailable.'),
        totalMemoryBytes: Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0
          ? available(totalMemoryBytes)
          : unavailable('Total memory is unavailable.'),
        usedMemoryBytes: usedMemoryBytes == null
          ? unavailable('Used memory cannot be derived.')
          : available(usedMemoryBytes),
        availableMemoryBytes: availableMemoryBytes == null
          ? unavailable('Available memory is unavailable.')
          : available(availableMemoryBytes),
        memoryUsedPercent: usedMemoryBytes == null
          ? unavailable('Memory utilization cannot be derived.')
          : available(percent(usedMemoryBytes, totalMemoryBytes)),
        memoryPressureSomeAvg10: unavailable('macOS does not expose Linux memory PSI.'),
        memoryPressureFullAvg10: unavailable('macOS does not expose Linux memory PSI.'),
        memoryPressureFreePercent: pressureFreePercent == null
          ? unavailable('memory_pressure did not report a recognized free percentage.')
          : available(pressureFreePercent),
        swapTotalBytes: swapUsage
          ? available(swapUsage.totalBytes)
          : unavailable('vm.swapusage is unavailable.'),
        swapUsedBytes: swapUsage
          ? available(swapUsage.usedBytes)
          : unavailable('vm.swapusage is unavailable.'),
        swapUsedPercent: swapUsage
          ? available(percent(swapUsage.usedBytes, swapUsage.totalBytes))
          : unavailable('vm.swapusage is unavailable.'),
        swapActivityBytesPerMinute: vmStat?.swap
          ? computeSwapActivity(
              vmStat.swap,
              previous?.counters.swap,
              elapsedMs,
              vmStat.pageSizeBytes,
            )
          : unavailable('vm_stat swap activity counters are unavailable.'),
        committedMemoryBytes: unavailable('macOS does not expose Linux Committed_AS.'),
        commitLimitBytes: unavailable('macOS does not expose Linux CommitLimit.'),
        virtualCommitmentPercent: unavailable('macOS virtual commitment is unavailable.'),
        counters: {
          cpu: cpuCounters,
          swap: vmStat?.swap ?? null,
        },
      };
    },
  };
}
