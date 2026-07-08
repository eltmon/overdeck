import { describe, expect, it, vi, beforeEach } from 'vitest';

const readProcMemoryMock = vi.fn();
const getResourceConfigMock = vi.fn();

vi.mock('../../../../src/dashboard/server/services/system-health-service.js', () => ({
  readProcMemory: (...args: unknown[]) => readProcMemoryMock(...args),
  getResourceConfig: (...args: unknown[]) => getResourceConfigMock(...args),
}));

import { assessMemoryPressure, classifyMemoryPressure } from '../../../../src/lib/cloister/memory-governor.js';

const GIB = 1024 ** 3;

describe('classifyMemoryPressure', () => {
  const thresholds = { warningBytes: 4 * GIB, criticalBytes: 2 * GIB };

  it('returns hard below the critical threshold', () => {
    expect(classifyMemoryPressure(1 * GIB, thresholds)).toBe('hard');
  });

  it('returns soft between critical and warning thresholds', () => {
    expect(classifyMemoryPressure(3 * GIB, thresholds)).toBe('soft');
  });

  it('returns ok at or above the warning threshold', () => {
    expect(classifyMemoryPressure(5 * GIB, thresholds)).toBe('ok');
    expect(classifyMemoryPressure(4 * GIB, thresholds)).toBe('ok');
  });
});

describe('assessMemoryPressure', () => {
  beforeEach(() => {
    getResourceConfigMock.mockReturnValue({ memoryWarnGb: 4, memoryBlockGb: 2 });
  });

  it('reads MemAvailable via the async proc parser and classifies the band', async () => {
    readProcMemoryMock.mockResolvedValue({ memAvailable: 1 * GIB });
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('hard');
    expect(verdict.availableBytes).toBe(1 * GIB);
    expect(verdict.thresholds).toEqual({ warningBytes: 4 * GIB, criticalBytes: 2 * GIB });
  });

  it('returns ok when memory is plentiful', async () => {
    readProcMemoryMock.mockResolvedValue({ memAvailable: 10 * GIB });
    const verdict = await assessMemoryPressure();
    expect(verdict.band).toBe('ok');
  });
});
