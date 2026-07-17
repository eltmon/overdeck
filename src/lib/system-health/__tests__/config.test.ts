import { describe, expect, it, vi } from 'vitest';

import {
  SYSTEM_HEALTH_DEFAULTS,
  normalizeSystemHealthThresholds,
  resolveSystemHealthConfig,
} from '../config.js';

const GIB = 1024 ** 3;

function validInput() {
  return {
    pollSeconds: 15,
    memoryWarnGb: 4,
    memoryBlockGb: 2,
    agentWarnCount: 8,
    agentBlockCount: 10,
    swapUsedWarningPercent: 20,
    swapUsedCriticalPercent: 50,
    cpuLoadWarningPerCore: 1,
    cpuLoadCriticalPerCore: 1.5,
    overcommitWarningPercent: 150,
    overcommitCriticalPercent: 200,
  };
}

describe('normalizeSystemHealthThresholds', () => {
  it('falls back to ordered finite named defaults and warns once for invalid values', () => {
    const warn = vi.fn();

    const result = normalizeSystemHealthThresholds({
      ...validInput(),
      pollSeconds: Number.NaN,
      memoryWarnGb: Number.POSITIVE_INFINITY,
      agentWarnCount: 12,
      agentBlockCount: 6,
      swapUsedWarningPercent: 70,
      swapUsedCriticalPercent: 50,
      cpuLoadWarningPerCore: -1,
      overcommitCriticalPercent: Number.NEGATIVE_INFINITY,
    }, warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(result.pollSeconds).toBe(SYSTEM_HEALTH_DEFAULTS.pollSeconds);
    expect(result.resources).toEqual({
      memoryWarnGb: SYSTEM_HEALTH_DEFAULTS.memoryWarnGb,
      memoryBlockGb: SYSTEM_HEALTH_DEFAULTS.memoryBlockGb,
      agentWarnCount: SYSTEM_HEALTH_DEFAULTS.agentWarnCount,
      agentBlockCount: SYSTEM_HEALTH_DEFAULTS.agentBlockCount,
    });
    expect(result.thresholds).toEqual({
      memoryAvailableWarningBytes: SYSTEM_HEALTH_DEFAULTS.memoryWarnGb * GIB,
      memoryAvailableCriticalBytes: SYSTEM_HEALTH_DEFAULTS.memoryBlockGb * GIB,
      swapUsedWarningPercent: SYSTEM_HEALTH_DEFAULTS.swapUsedWarningPercent,
      swapUsedCriticalPercent: SYSTEM_HEALTH_DEFAULTS.swapUsedCriticalPercent,
      cpuLoadWarningPerCore: SYSTEM_HEALTH_DEFAULTS.cpuLoadWarningPerCore,
      cpuLoadCriticalPerCore: SYSTEM_HEALTH_DEFAULTS.cpuLoadCriticalPerCore,
      overcommitWarningPercent: SYSTEM_HEALTH_DEFAULTS.overcommitWarningPercent,
      overcommitCriticalPercent: SYSTEM_HEALTH_DEFAULTS.overcommitCriticalPercent,
    });
    expect(result.resources.memoryWarnGb).toBeGreaterThanOrEqual(result.resources.memoryBlockGb);
    expect(result.resources.agentWarnCount).toBeLessThanOrEqual(result.resources.agentBlockCount);
    expect(result.thresholds.swapUsedWarningPercent).toBeLessThanOrEqual(result.thresholds.swapUsedCriticalPercent);
  });

  it('preserves valid operator resource values in the effective thresholds', () => {
    const warn = vi.fn();

    const result = resolveSystemHealthConfig({
      resources: {
        memoryWarnGb: 6.5,
        memoryBlockGb: 3.25,
        agentWarnCount: 12,
        agentBlockCount: 16,
      },
      env: {},
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(result.resources.memoryWarnGb).toBe(6.5);
    expect(result.resources.memoryBlockGb).toBe(3.25);
    expect(result.thresholds.memoryAvailableWarningBytes).toBe(6.5 * GIB);
    expect(result.thresholds.memoryAvailableCriticalBytes).toBe(3.25 * GIB);
  });

  it('passes environment overrides through the same validator', () => {
    const warn = vi.fn();

    const result = resolveSystemHealthConfig({
      resources: {
        memoryWarnGb: 6,
        memoryBlockGb: 3,
        agentWarnCount: 10,
        agentBlockCount: 14,
      },
      env: {
        PAN_MEMORY_WARN_GB: 'not-a-number',
        PAN_MEMORY_BLOCK_GB: '2',
        PAN_HEALTH_LOAD_WARN_PER_CORE: '2.25',
        PAN_HEALTH_LOAD_CRITICAL_PER_CORE: '3.5',
      },
      warn,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(result.resources.memoryWarnGb).toBe(SYSTEM_HEALTH_DEFAULTS.memoryWarnGb);
    expect(result.resources.memoryBlockGb).toBe(SYSTEM_HEALTH_DEFAULTS.memoryBlockGb);
    expect(result.thresholds.cpuLoadWarningPerCore).toBe(2.25);
    expect(result.thresholds.cpuLoadCriticalPerCore).toBe(3.5);
  });
});
