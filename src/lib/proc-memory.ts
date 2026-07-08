import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { freemem, platform, totalmem } from 'node:os';
import { promisify } from 'node:util';

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
}

async function readProcMemoryLinux(): Promise<ProcMemorySnapshot> {
  const content = await readFile('/proc/meminfo', 'utf-8');
  const values = new Map<string, number>();

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1] ?? '', Number(match[2] ?? '0') * KB);
  }

  return {
    memTotal: values.get('MemTotal') ?? 0,
    memAvailable: values.get('MemAvailable') ?? values.get('MemFree') ?? 0,
    memFree: values.get('MemFree') ?? 0,
    swapTotal: values.get('SwapTotal') ?? 0,
    swapFree: values.get('SwapFree') ?? 0,
    committedAs: values.get('Committed_AS') ?? 0,
    commitLimit: values.get('CommitLimit') ?? 0,
  };
}

async function readProcMemoryDarwin(): Promise<ProcMemorySnapshot> {
  const memTotal = totalmem();
  let memAvailable = freemem();
  let memFree = freemem();

  try {
    const { stdout } = await execAsync('vm_stat', { encoding: 'utf-8', timeout: 5_000 });
    const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;

    const pages = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(.+?):\s+(\d+)\./);
      if (m) pages.set(m[1]!.trim(), Number(m[2]));
    }

    const free = (pages.get('Pages free') ?? 0) * pageSize;
    const inactive = (pages.get('Pages inactive') ?? 0) * pageSize;
    const speculative = (pages.get('Pages speculative') ?? 0) * pageSize;
    memFree = free;
    memAvailable = free + inactive + speculative;
  } catch { /* fall back to os.freemem() values set above */ }

  let swapTotal = 0;
  let swapFree = 0;
  try {
    const { stdout } = await execAsync('sysctl -n vm.swapusage', { encoding: 'utf-8', timeout: 5_000 });
    const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/);
    const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/);
    if (totalMatch) swapTotal = parseFloat(totalMatch[1] ?? '0') * 1024 * KB;
    if (totalMatch && usedMatch) swapFree = swapTotal - parseFloat(usedMatch[1] ?? '0') * 1024 * KB;
  } catch { /* swap stats unavailable */ }

  return {
    memTotal,
    memAvailable,
    memFree,
    swapTotal,
    swapFree,
    committedAs: 0,
    commitLimit: 0,
  };
}

export async function readProcMemory(): Promise<ProcMemorySnapshot> {
  return platform() === 'darwin' ? readProcMemoryDarwin() : readProcMemoryLinux();
}
