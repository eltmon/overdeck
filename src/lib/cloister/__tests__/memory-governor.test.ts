import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assessMemoryPressure, classifyMemoryPressure } from '../memory-governor.js';
import {
  getResourceConfig,
  readGlobalResourceConfig,
  readProcMemory,
} from '../../../dashboard/server/services/system-health-service.js';

vi.mock('../../../dashboard/server/services/system-health-service.js', () => ({
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
    memoryAvailableWarningBytes: 4 * GIB,
    memoryAvailableCriticalBytes: 2 * GIB,
  };

  it('classifies hard pressure below the critical threshold', () => {
    expect(classifyMemoryPressure(2 * GIB - 1, thresholds)).toBe('hard');
  });

  it('classifies soft pressure below the warning threshold', () => {
    expect(classifyMemoryPressure(4 * GIB - 1, thresholds)).toBe('soft');
  });

  it('classifies ok pressure at threshold boundaries and above', () => {
    expect(classifyMemoryPressure(2 * GIB, thresholds)).toBe('soft');
    expect(classifyMemoryPressure(4 * GIB, thresholds)).toBe('ok');
    expect(classifyMemoryPressure(8 * GIB, thresholds)).toBe('ok');
  });
});

describe('assessMemoryPressure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadGlobalResourceConfig.mockResolvedValue(undefined);
    mockedGetResourceConfig.mockReturnValue({
      memoryWarnGb: 4,
      memoryBlockGb: 2,
      agentWarnCount: 8,
      agentBlockCount: 10,
    });
  });

  it.each([
    { availableBytes: 2 * GIB - 1, band: 'hard' },
    { availableBytes: 4 * GIB - 1, band: 'soft' },
    { availableBytes: 4 * GIB, band: 'ok' },
  ] as const)('returns $band when MemAvailable is $availableBytes bytes', async ({ availableBytes, band }) => {
    mockedReadProcMemory.mockResolvedValue({
      memTotal: 64 * GIB,
      memAvailable: availableBytes,
      memFree: availableBytes,
      swapTotal: 0,
      swapFree: 0,
      committedAs: 0,
      commitLimit: 0,
    });

    await expect(assessMemoryPressure()).resolves.toEqual({
      band,
      availableBytes,
      thresholds: {
        memoryAvailableWarningBytes: 4 * GIB,
        memoryAvailableCriticalBytes: 2 * GIB,
      },
    });
    expect(mockedReadProcMemory).toHaveBeenCalledTimes(1);
  });
});
