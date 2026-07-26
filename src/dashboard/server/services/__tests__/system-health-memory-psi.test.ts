import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { parseMemoryPsi, readProcMemory } from '../system-health-service.js';

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
});
