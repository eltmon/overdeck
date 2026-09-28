import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDarwinHostHealthCollector } from '../../../../../src/lib/system-health/darwin.js';

const { execMock, platformMock, readFileMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  platformMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  exec: execMock,
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: readFileMock,
}));
vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  freemem: () => 8 * 1024 ** 3,
  platform: platformMock,
  totalmem: () => 16 * 1024 ** 3,
}));

import {
  parseMemoryPsi,
  readProcMemory,
} from '../../../../../src/dashboard/server/services/system-health-service.js';

const MEMINFO = [
  'MemTotal:       16384000 kB',
  'MemFree:         2048000 kB',
  'MemAvailable:    8192000 kB',
  'SwapTotal:       4194304 kB',
  'SwapFree:        1048576 kB',
  'Committed_AS:    6291456 kB',
  'CommitLimit:    10485760 kB',
  '',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  platformMock.mockReturnValue('linux');
  execMock.mockImplementation((
    _command: string,
    _options: unknown,
    callback: (error: Error) => void,
  ) => callback(new Error('unavailable')));
});

describe('parseMemoryPsi', () => {
  it('parses realistic some and full avg10 values', () => {
    expect(parseMemoryPsi(
      'some avg10=1.23 avg60=0.40 avg300=0.10 total=12345\n'
      + 'full avg10=0.05 avg60=0.01 avg300=0.00 total=678\n',
    )).toEqual({ someAvg10: 1.23, fullAvg10: 0.05 });
  });

  it('skips malformed and negative values', () => {
    expect(parseMemoryPsi(
      'some avg10=not-a-number avg60=0.00 avg300=0.00 total=1\n'
      + 'full avg10=-0.01 avg60=0.00 avg300=0.00 total=2\n',
    )).toEqual({ someAvg10: null, fullAvg10: null });
  });

  it('preserves a valid some value when the full line is missing', () => {
    expect(parseMemoryPsi(
      'some avg10=0.42 avg60=0.20 avg300=0.10 total=123\n',
    )).toEqual({ someAvg10: 0.42, fullAvg10: null });
  });

  it('returns null values for empty content', () => {
    expect(parseMemoryPsi('')).toEqual({ someAvg10: null, fullAvg10: null });
  });
});

describe('readProcMemory PSI fields', () => {
  it('keeps meminfo values when the Linux PSI file is unreadable', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path === '/proc/meminfo') return MEMINFO;
      throw new Error('permission denied');
    });

    await expect(readProcMemory()).resolves.toMatchObject({
      memTotal: 16_384_000 * 1024,
      memAvailable: 8_192_000 * 1024,
      psiSomeAvg10: null,
      psiFullAvg10: null,
    });
  });

  it('returns null PSI fields on Darwin', async () => {
    platformMock.mockReturnValue('darwin');

    await expect(readProcMemory()).resolves.toMatchObject({
      memTotal: 16 * 1024 ** 3,
      memAvailable: 8 * 1024 ** 3,
      psiSomeAvg10: null,
      psiFullAvg10: null,
    });
  });

  it('matches the header collector\'s available memory bytes for identical darwin outputs', async () => {
    platformMock.mockReturnValue('darwin');
    const totalMemoryBytes = 16 * 1024 ** 3;
    const pressureOutput = 'System-wide memory free percentage: 42%';
    const vmStatOutput = [
      'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
      'Pages free:                              100000.',
      'Pages inactive:                          150000.',
      'Pages speculative:                        12144.',
      'Anonymous pages:                        3000000.',
      'Pages wired down:                         700000.',
      'Pages purgeable:                          200000.',
      'Pages occupied by compressor:              65160.',
    ].join('\n');
    const swapOutput = 'total = 4096.00M  used = 2048.00M  free = 2048.00M  (encrypted)';

    execMock.mockImplementation((
      command: string,
      _options: unknown,
      callback: (error: Error | null, result?: { stdout: string }) => void,
    ) => {
      if (command.startsWith('memory_pressure')) return callback(null, { stdout: pressureOutput });
      if (command === 'vm_stat') return callback(null, { stdout: vmStatOutput });
      if (command.startsWith('sysctl')) return callback(null, { stdout: swapOutput });
      return callback(new Error(`unexpected command: ${command}`));
    });

    const collector = createDarwinHostHealthCollector({
      execFile: async (cmd) => {
        if (cmd === 'memory_pressure') return pressureOutput;
        if (cmd === 'vm_stat') return vmStatOutput;
        if (cmd === 'sysctl') return swapOutput;
        throw new Error(`unexpected command: ${cmd}`);
      },
      cpus: () => [],
      loadAverage1m: () => 0,
      totalMemoryBytes: () => totalMemoryBytes,
      now: () => 0,
    });
    const collectorSample = await collector.sample();
    const snapshot = await readProcMemory();

    expect(collectorSample.availableMemoryBytes.status).toBe('available');
    expect(collectorSample.availableMemoryBytes).toEqual({
      status: 'available',
      value: snapshot.memAvailable,
    });
  });
});
