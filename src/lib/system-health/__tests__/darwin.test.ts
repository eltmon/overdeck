import type { CpuInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  createDarwinHostHealthCollector,
  parseDarwinMemoryPressure,
  parseDarwinSwapUsage,
  parseDarwinVmStat,
  type DarwinCollectorAdapters,
} from '../darwin.js';

const GIB = 1024 ** 3;
const PRESSURE_COLON = [
  'The system has 17179869184 (1048576 pages with a page size of 16384).',
  'System-wide memory free percentage: 50%',
].join('\n');
const PRESSURE_EQUALS = 'System-wide memory free percentage = 50%';
const VM_STAT_FIRST = [
  'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
  'Pages free:                               100.',
  'Pages inactive:                           200.',
  'Pages speculative:                         50.',
  'Swapins:                                  100.',
  'Swapouts:                                 200.',
].join('\n');
const SWAP_USAGE = 'total = 4096.00M  used = 2048.00M  free = 2048.00M  (encrypted)';

function cpuInfo(idle: number, user: number, sys: number): CpuInfo[] {
  return [0, 1].map(() => ({
    model: 'fixture',
    speed: 3000,
    times: { idle, user, sys, nice: 0, irq: 100 },
  }));
}

interface AdapterOptions {
  pressure?: Array<string | Error>;
  vmStat?: Array<string | Error>;
  swap?: Array<string | Error>;
  cpu?: CpuInfo[][];
  loadAverage1m?: number;
}

function adapters(options: AdapterOptions = {}): DarwinCollectorAdapters {
  const outputs: Record<string, Array<string | Error>> = {
    memory_pressure: options.pressure ?? [PRESSURE_COLON, PRESSURE_EQUALS],
    vm_stat: options.vmStat ?? [VM_STAT_FIRST, VM_STAT_FIRST],
    sysctl: options.swap ?? [SWAP_USAGE, SWAP_USAGE],
  };
  const commandReads = new Map<string, number>();
  const cpuSnapshots = options.cpu ?? [cpuInfo(700, 100, 100), cpuInfo(800, 150, 150)];
  let cpuRead = 0;
  let now = 0;

  return {
    async execFile(command, _args, timeoutMs) {
      expect(timeoutMs).toBe(5000);
      const index = commandReads.get(command) ?? 0;
      commandReads.set(command, index + 1);
      const output = outputs[command]?.[index];
      if (output instanceof Error) throw output;
      if (output == null) throw new Error(`No ${command} fixture at ${index}`);
      return output;
    },
    cpus() {
      const value = cpuSnapshots[cpuRead++];
      if (!value) throw new Error('No CPU fixture');
      return value;
    },
    loadAverage1m() {
      return options.loadAverage1m ?? 12;
    },
    totalMemoryBytes() {
      return 16 * GIB;
    },
    now() {
      const value = now;
      now += 60_000;
      return value;
    },
  };
}

function expectAvailable(signal: { status: string; value?: number }, value: number): void {
  expect(signal).toEqual({ status: 'available', value });
}

describe('macOS host health collector', () => {
  it('keeps swap occupancy diagnostic when current memory pressure is healthy', async () => {
    const collector = createDarwinHostHealthCollector(adapters());
    const first = await collector.sample();
    const second = await collector.sample(first);

    expectAvailable(first.memoryPressureFreePercent, 50);
    expectAvailable(second.memoryPressureFreePercent, 50);
    expectAvailable(second.swapUsedPercent, 50);
    expectAvailable(second.swapActivityBytesPerMinute, 0);
    expectAvailable(second.cpuPercent, 50);
    expectAvailable(second.loadAverage1m, 12);
    expect(second.cpuPercent).not.toEqual(second.loadAverage1m);
  });

  it.each([
    ['warning', 10],
    ['critical', 5],
  ])('exposes the %s pressure-band observation', async (_band, freePercent) => {
    const collector = createDarwinHostHealthCollector(adapters({
      pressure: [`System-wide memory free percentage: ${freePercent}%`],
      vmStat: [VM_STAT_FIRST],
      swap: [SWAP_USAGE],
      cpu: [cpuInfo(700, 100, 100)],
    }));

    expectAvailable((await collector.sample()).memoryPressureFreePercent, freePercent);
  });

  it('fails closed for malformed pressure, vm_stat, and swap output', async () => {
    expect(parseDarwinMemoryPressure('memory information unavailable')).toBeNull();
    expect(parseDarwinVmStat('Pages free: 100.')).toBeNull();
    expect(parseDarwinSwapUsage('total = unknown')).toBeNull();

    const collector = createDarwinHostHealthCollector(adapters({
      pressure: ['memory information unavailable'],
      vmStat: ['Pages free: 100.'],
      swap: ['total = unknown'],
      cpu: [cpuInfo(700, 100, 100)],
    }));
    const sample = await collector.sample();

    expect(sample.memoryPressureFreePercent.status).toBe('unavailable');
    expect(sample.availableMemoryBytes.status).toBe('unavailable');
    expect(sample.swapActivityBytesPerMinute.status).toBe('unavailable');
    expect(sample.swapUsedPercent.status).toBe('unavailable');
  });

  it('falls back to vm_stat memory totals when memory_pressure is unavailable', async () => {
    const collector = createDarwinHostHealthCollector(adapters({
      pressure: [new Error('command unavailable')],
      vmStat: [VM_STAT_FIRST],
      swap: [SWAP_USAGE],
      cpu: [cpuInfo(700, 100, 100)],
    }));
    const sample = await collector.sample();

    expect(sample.memoryPressureFreePercent.status).toBe('unavailable');
    expectAvailable(sample.availableMemoryBytes, 350 * 4096);
  });

  it('requires consecutive CPU time snapshots instead of substituting load average', async () => {
    const collector = createDarwinHostHealthCollector(adapters({ loadAverage1m: 12 }));
    const first = await collector.sample();
    const second = await collector.sample(first);

    expect(first.cpuPercent.status).toBe('unavailable');
    expectAvailable(second.cpuPercent, 50);
    expectAvailable(second.loadPerCore1m, 6);
  });
});
