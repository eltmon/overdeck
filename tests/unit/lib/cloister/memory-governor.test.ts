import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assessMemoryPressure, classifyMemoryPressure, resetMemoryGovernorState } from '../../../../src/lib/cloister/memory-governor.js';
import {
  getResourceConfig,
  readGlobalResourceConfig,
  readProcMemory,
} from '../../../../src/dashboard/server/services/system-health-service.js';

vi.mock('../../../../src/dashboard/server/services/system-health-service.js', () => ({
  getResourceConfig: vi.fn(),
  readGlobalResourceConfig: vi.fn(),
  readProcMemory: vi.fn(),
}));

const GIB = 1024 ** 3;

const mockedGetResourceConfig = vi.mocked(getResourceConfig);
const mockedReadGlobalResourceConfig = vi.mocked(readGlobalResourceConfig);
const mockedReadProcMemory = vi.mocked(readProcMemory);

describe('classifyMemoryPressure', () => {
  const thresholds = {
    softReserveBytes: 4 * GIB,
    hardReserveBytes: 2 * GIB,
    recoveryReserveBytes: 6 * GIB,
  };

  it('classifies hard pressure below the hard threshold', () => {
    expect(classifyMemoryPressure(2 * GIB - 1, thresholds)).toBe('hard');
  });

  it('classifies soft pressure below the soft threshold', () => {
    expect(classifyMemoryPressure(4 * GIB - 1, thresholds)).toBe('soft');
  });

  it('classifies ok pressure at and above the soft threshold', () => {
    expect(classifyMemoryPressure(2 * GIB, thresholds)).toBe('soft');
    expect(classifyMemoryPressure(4 * GIB, thresholds)).toBe('ok');
    expect(classifyMemoryPressure(8 * GIB, thresholds)).toBe('ok');
  });
});

describe('assessMemoryPressure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryGovernorState();
    mockedReadGlobalResourceConfig.mockResolvedValue(undefined);
    mockedGetResourceConfig.mockReturnValue({
      memoryWarnGb: 4,
      memoryBlockGb: 2,
      governorSoftReserveGb: 4,
      governorHardReserveGb: 2,
      governorRecoveryReserveGb: 6,
      agentWarnCount: 8,
      agentBlockCount: 10,
    });
  });

  it('holds until MemAvailable exceeds recovery after a soft crossing', async () => {
    mockedReadProcMemory
      .mockResolvedValueOnce({
        memTotal: 64 * GIB,
        memAvailable: 8 * GIB,
        memFree: 8 * GIB,
        swapTotal: 0,
        swapFree: 0,
        committedAs: 0,
        commitLimit: 0,
      })
      .mockResolvedValueOnce({
        memTotal: 64 * GIB,
        memAvailable: 3 * GIB,
        memFree: 3 * GIB,
        swapTotal: 0,
        swapFree: 0,
        committedAs: 0,
        commitLimit: 0,
      })
      .mockResolvedValueOnce({
        memTotal: 64 * GIB,
        memAvailable: 5 * GIB,
        memFree: 5 * GIB,
        swapTotal: 0,
        swapFree: 0,
        committedAs: 0,
        commitLimit: 0,
      })
      .mockResolvedValueOnce({
        memTotal: 64 * GIB,
        memAvailable: 7 * GIB,
        memFree: 7 * GIB,
        swapTotal: 0,
        swapFree: 0,
        committedAs: 0,
        commitLimit: 0,
      });

    await expect(assessMemoryPressure()).resolves.toMatchObject({ band: 'ok', mode: 'admitting', availableBytes: 8 * GIB });
    await expect(assessMemoryPressure()).resolves.toMatchObject({ band: 'soft', mode: 'holding', availableBytes: 3 * GIB });
    await expect(assessMemoryPressure()).resolves.toMatchObject({ band: 'ok', mode: 'holding', availableBytes: 5 * GIB });
    await expect(assessMemoryPressure()).resolves.toMatchObject({ band: 'ok', mode: 'admitting', availableBytes: 7 * GIB });
  });
});
