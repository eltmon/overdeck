import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
const KB = 1024;

export const LINUX_MEMORY_PRESSURE_DEFAULTS = Object.freeze({
  someWarningAvg10: 5,
  fullCriticalAvg10: 1,
  swapActivityWarningBytesPerMinute: 64 * 1024 ** 2,
  swapActivityCriticalBytesPerMinute: 256 * 1024 ** 2,
});

export interface LinuxCollectorAdapters {
  readFile(path: string): Promise<string>;
  readPageSizeBytes(): Promise<number>;
  now(): number;
}

export interface ParsedMemInfo {
  memTotalBytes?: number;
  memAvailableBytes?: number;
  swapTotalBytes?: number;
  swapFreeBytes?: number;
  committedMemoryBytes?: number;
  commitLimitBytes?: number;
}

export interface ParsedProcStat {
  cpu: CpuCounters;
  coreCount: number;
}

export interface ParsedMemoryPressure {
  someAvg10?: number;
  fullAvg10?: number;
}

export function parseMemInfo(content: string): ParsedMemInfo {
  const values = new Map<string, number>();
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) values.set(match[1]!, value * KB);
  }

  return {
    memTotalBytes: values.get('MemTotal'),
    memAvailableBytes: values.get('MemAvailable'),
    swapTotalBytes: values.get('SwapTotal'),
    swapFreeBytes: values.get('SwapFree'),
    committedMemoryBytes: values.get('Committed_AS'),
    commitLimitBytes: values.get('CommitLimit'),
  };
}

export function parseProcStat(content: string): ParsedProcStat | null {
  const lines = content.split('\n');
  const cpuLine = lines.find((line) => line.startsWith('cpu '));
  if (!cpuLine) return null;

  const values = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return null;

  const idle = values[3]! + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const coreCount = lines.filter((line) => /^cpu\d+\s/.test(line)).length;
  if (total < 0 || idle < 0) return null;

  return {
    cpu: { idle, total },
    coreCount: Math.max(coreCount, 1),
  };
}

export function parseMemoryPressure(content: string): ParsedMemoryPressure {
  const result: ParsedMemoryPressure = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(some|full)\s+.*\bavg10=([^\s]+)/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0) continue;
    if (match[1] === 'some') result.someAvg10 = value;
    if (match[1] === 'full') result.fullAvg10 = value;
  }
  return result;
}

export function parseVmstat(content: string): SwapCounters | null {
  let pagesIn: number | null = null;
  let pagesOut: number | null = null;

  for (const line of content.split('\n')) {
    const match = line.match(/^(pswpin|pswpout)\s+(\d+)$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (match[1] === 'pswpin') pagesIn = value;
    if (match[1] === 'pswpout') pagesOut = value;
  }

  return pagesIn == null || pagesOut == null ? null : { pagesIn, pagesOut };
}

export function parseLoadAverage(content: string): number | null {
  const value = Number(content.trim().split(/\s+/)[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function computeCpuPercent(
  current: CpuCounters,
  previous: CpuCounters | null | undefined,
): HostMetricSignal<number> {
  if (!previous) return unavailable('A previous CPU counter sample is required.');
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) {
    return unavailable('CPU counters did not advance monotonically.');
  }
  return available(Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10);
}

export function computeSwapActivityBytesPerMinute(
  current: SwapCounters,
  previous: SwapCounters | null | undefined,
  elapsedMs: number,
  pageSizeBytes: number,
): HostMetricSignal<number> {
  if (!previous) return unavailable('A previous swap counter sample is required.');
  const pageDelta = current.pagesIn - previous.pagesIn + current.pagesOut - previous.pagesOut;
  if (pageDelta < 0 || elapsedMs <= 0 || !Number.isFinite(pageSizeBytes) || pageSizeBytes <= 0) {
    return unavailable('Swap counters or sample timing were invalid.');
  }
  return available(Math.round(pageDelta * pageSizeBytes * 60_000 / elapsedMs));
}

const defaultAdapters: LinuxCollectorAdapters = {
  readFile: (path) => readFile(path, 'utf-8'),
  readPageSizeBytes: async () => {
    const { stdout } = await execFileAsync('getconf', ['PAGESIZE'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const value = Number(stdout.trim());
    if (!Number.isFinite(value) || value <= 0) throw new Error('getconf returned an invalid page size');
    return value;
  },
  now: () => Date.now(),
};

async function readParsed<T>(
  adapters: LinuxCollectorAdapters,
  path: string,
  parse: (content: string) => T,
): Promise<T | null> {
  try {
    return parse(await adapters.readFile(path));
  } catch {
    return null;
  }
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function createLinuxHostHealthCollector(
  adapters: LinuxCollectorAdapters = defaultAdapters,
): HostHealthCollector {
  return {
    platform: 'linux',
    async sample(previous?: HostMetricSample): Promise<HostMetricSample> {
      const sampledAtMs = adapters.now();
      const [memInfo, procStat, pressure, vmstat, loadAverage, pageSizeBytes] = await Promise.all([
        readParsed(adapters, '/proc/meminfo', parseMemInfo),
        readParsed(adapters, '/proc/stat', parseProcStat),
        readParsed(adapters, '/proc/pressure/memory', parseMemoryPressure),
        readParsed(adapters, '/proc/vmstat', parseVmstat),
        readParsed(adapters, '/proc/loadavg', parseLoadAverage),
        adapters.readPageSizeBytes().catch(() => null),
      ]);

      const totalMemoryBytes = memInfo?.memTotalBytes;
      const availableMemoryBytes = memInfo?.memAvailableBytes;
      const usedMemoryBytes = totalMemoryBytes != null && availableMemoryBytes != null
        ? Math.max(totalMemoryBytes - availableMemoryBytes, 0)
        : null;
      const swapTotalBytes = memInfo?.swapTotalBytes;
      const swapFreeBytes = memInfo?.swapFreeBytes;
      const swapUsedBytes = swapTotalBytes != null && swapFreeBytes != null
        ? Math.max(swapTotalBytes - swapFreeBytes, 0)
        : null;
      const committedMemoryBytes = memInfo?.committedMemoryBytes;
      const commitLimitBytes = memInfo?.commitLimitBytes;
      const cpuCounters = procStat?.cpu ?? null;
      const swapCounters = vmstat ?? null;
      const elapsedMs = previous ? sampledAtMs - previous.sampledAtMs : 0;

      return {
        platform: 'linux',
        sampledAtMs,
        cpuPercent: cpuCounters
          ? computeCpuPercent(cpuCounters, previous?.counters.cpu)
          : unavailable('The aggregate CPU counters are unavailable.'),
        loadAverage1m: loadAverage == null
          ? unavailable('The one-minute load average is unavailable.')
          : available(loadAverage),
        loadPerCore1m: loadAverage == null || !procStat
          ? unavailable('Load average or CPU core count is unavailable.')
          : available(Math.round((loadAverage / procStat.coreCount) * 100) / 100),
        totalMemoryBytes: totalMemoryBytes == null
          ? unavailable('MemTotal is unavailable.')
          : available(totalMemoryBytes),
        usedMemoryBytes: usedMemoryBytes == null
          ? unavailable('Used memory cannot be derived without MemTotal and MemAvailable.')
          : available(usedMemoryBytes),
        availableMemoryBytes: availableMemoryBytes == null
          ? unavailable('MemAvailable is unavailable.')
          : available(availableMemoryBytes),
        memoryUsedPercent: usedMemoryBytes == null || totalMemoryBytes == null
          ? unavailable('Memory utilization cannot be derived.')
          : available(percent(usedMemoryBytes, totalMemoryBytes)),
        memoryPressureSomeAvg10: pressure?.someAvg10 == null
          ? unavailable('Linux memory PSI some.avg10 is unavailable.')
          : available(pressure.someAvg10),
        memoryPressureFullAvg10: pressure?.fullAvg10 == null
          ? unavailable('Linux memory PSI full.avg10 is unavailable.')
          : available(pressure.fullAvg10),
        memoryPressureFreePercent: unavailable('Linux reports memory pressure through PSI.'),
        swapTotalBytes: swapTotalBytes == null
          ? unavailable('SwapTotal is unavailable.')
          : available(swapTotalBytes),
        swapUsedBytes: swapUsedBytes == null
          ? unavailable('Swap usage cannot be derived without SwapTotal and SwapFree.')
          : available(swapUsedBytes),
        swapUsedPercent: swapUsedBytes == null || swapTotalBytes == null
          ? unavailable('Swap utilization cannot be derived.')
          : available(percent(swapUsedBytes, swapTotalBytes)),
        swapActivityBytesPerMinute: swapCounters && pageSizeBytes != null
          ? computeSwapActivityBytesPerMinute(
              swapCounters,
              previous?.counters.swap,
              elapsedMs,
              pageSizeBytes,
            )
          : unavailable('Linux swap activity counters are unavailable.'),
        committedMemoryBytes: committedMemoryBytes == null
          ? unavailable('Committed_AS is unavailable.')
          : available(committedMemoryBytes),
        commitLimitBytes: commitLimitBytes == null
          ? unavailable('CommitLimit is unavailable.')
          : available(commitLimitBytes),
        virtualCommitmentPercent: committedMemoryBytes == null || commitLimitBytes == null
          ? unavailable('Virtual commitment cannot be derived.')
          : available(percent(committedMemoryBytes, commitLimitBytes)),
        counters: {
          cpu: cpuCounters,
          swap: swapCounters,
        },
      };
    },
  };
}
