import { describe, expect, it } from 'vitest';

import {
  buildProcessTreeIndex,
  collectDescendantPids,
  createHostHealthCollector,
} from '../collector.js';
import {
  createLinuxHostHealthCollector,
  parseMemoryPressure,
  type LinuxCollectorAdapters,
} from '../linux.js';

const MEMINFO = [
  'MemTotal:       16777216 kB',
  'MemAvailable:    8388608 kB',
  'SwapTotal:       4194304 kB',
  'SwapFree:        2097152 kB',
  'Committed_AS:   12582912 kB',
  'CommitLimit:    16777216 kB',
].join('\n');

const QUIET_PRESSURE = [
  'some avg10=0.00 avg60=0.01 avg300=0.02 total=1000',
  'full avg10=0.00 avg60=0.00 avg300=0.00 total=10',
].join('\n');

const FIRST_CPU = [
  'cpu  100 0 100 700 100 0 0 0 0 0',
  'cpu0 50 0 50 350 50 0 0 0 0 0',
  'cpu1 50 0 50 350 50 0 0 0 0 0',
].join('\n');

const SECOND_CPU = [
  'cpu  150 0 150 800 100 0 0 0 0 0',
  'cpu0 75 0 75 400 50 0 0 0 0 0',
  'cpu1 75 0 75 400 50 0 0 0 0 0',
].join('\n');

function adapters(
  overrides: Partial<Record<string, string[]>> = {},
): LinuxCollectorAdapters {
  const fixtures: Record<string, string[]> = {
    '/proc/meminfo': [MEMINFO, MEMINFO],
    '/proc/stat': [FIRST_CPU, SECOND_CPU],
    '/proc/pressure/memory': [QUIET_PRESSURE, QUIET_PRESSURE],
    '/proc/vmstat': ['pswpin 100\npswpout 200', 'pswpin 100\npswpout 200'],
    '/proc/loadavg': ['4.00 3.00 2.00 1/100 1', '4.00 3.00 2.00 1/100 1'],
    ...overrides,
  };
  const reads = new Map<string, number>();
  let now = 0;

  return {
    async readFile(path) {
      const index = reads.get(path) ?? 0;
      reads.set(path, index + 1);
      const value = fixtures[path]?.[index];
      if (value == null) throw new Error(`No fixture for ${path} read ${index}`);
      return value;
    },
    async readPageSizeBytes() {
      return 4096;
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

describe('Linux host health collector', () => {
  it('keeps historical swap occupancy diagnostic when current pressure is quiet', async () => {
    const collector = createLinuxHostHealthCollector(adapters());
    const first = await collector.sample();
    const second = await collector.sample(first);

    expectAvailable(second.swapUsedPercent, 50);
    expectAvailable(second.memoryPressureSomeAvg10, 0);
    expectAvailable(second.memoryPressureFullAvg10, 0);
    expectAvailable(second.swapActivityBytesPerMinute, 0);
    expectAvailable(second.cpuPercent, 50);
    expectAvailable(second.loadAverage1m, 4);
    expectAvailable(second.loadPerCore1m, 2);
  });

  it('exposes elevated PSI and sustained swap-counter deltas as current pressure', async () => {
    const collector = createLinuxHostHealthCollector(adapters({
      '/proc/pressure/memory': [
        QUIET_PRESSURE,
        'some avg10=2.50 avg60=1.00 avg300=0.50 total=2000\n'
          + 'full avg10=0.25 avg60=0.10 avg300=0.05 total=100',
      ],
      '/proc/vmstat': ['pswpin 100\npswpout 200', 'pswpin 300\npswpout 400'],
    }));
    const first = await collector.sample();
    const second = await collector.sample(first);

    expectAvailable(second.memoryPressureSomeAvg10, 2.5);
    expectAvailable(second.memoryPressureFullAvg10, 0.25);
    expectAvailable(second.swapActivityBytesPerMinute, 1_638_400);
  });

  it('marks missing or malformed PSI unavailable instead of reporting zero', async () => {
    const missing = createLinuxHostHealthCollector(adapters({
      '/proc/pressure/memory': [],
    }));
    const missingSample = await missing.sample();
    expect(missingSample.memoryPressureSomeAvg10.status).toBe('unavailable');
    expect(missingSample.memoryPressureFullAvg10.status).toBe('unavailable');

    expect(parseMemoryPressure('some avg10=broken avg60=0 total=1')).toEqual({});
    const malformed = createLinuxHostHealthCollector(adapters({
      '/proc/pressure/memory': [
        'some avg10=broken avg60=0 total=1\nfull avg10=-1 avg60=0 total=1',
      ],
    }));
    const malformedSample = await malformed.sample();
    expect(malformedSample.memoryPressureSomeAvg10.status).toBe('unavailable');
    expect(malformedSample.memoryPressureFullAvg10.status).toBe('unavailable');
  });

  it('handles a host with no configured swap without inventing activity', async () => {
    const noSwapMemInfo = MEMINFO
      .replace('SwapTotal:       4194304 kB', 'SwapTotal:             0 kB')
      .replace('SwapFree:        2097152 kB', 'SwapFree:              0 kB');
    const collector = createLinuxHostHealthCollector(adapters({
      '/proc/meminfo': [noSwapMemInfo, noSwapMemInfo],
    }));
    const first = await collector.sample();
    const second = await collector.sample(first);

    expectAvailable(second.swapTotalBytes, 0);
    expectAvailable(second.swapUsedBytes, 0);
    expectAvailable(second.swapUsedPercent, 0);
    expectAvailable(second.swapActivityBytesPerMinute, 0);
  });

  it('selects Linux and unsupported collectors by platform', async () => {
    const linux = createLinuxHostHealthCollector(adapters());
    expect(createHostHealthCollector({ platform: 'linux', linux })).toBe(linux);

    const unsupported = createHostHealthCollector({ platform: 'freebsd' });
    expect(unsupported.platform).toBe('unsupported');
    expect((await unsupported.sample()).cpuPercent.status).toBe('unavailable');
  });

  it('indexes parent-child relationships once for descendant traversal', () => {
    const index = buildProcessTreeIndex([
      { pid: 10, ppid: 1 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 10 },
      { pid: 13, ppid: 11 },
      { pid: 20, ppid: 1 },
    ]);

    expect(collectDescendantPids(10, index)).toEqual(new Set([10, 11, 12, 13]));
    expect(index.childrenByParent.get(10)).toEqual([11, 12]);
  });
});
