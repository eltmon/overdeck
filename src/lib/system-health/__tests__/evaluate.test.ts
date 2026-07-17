import { describe, expect, it } from 'vitest';

import type { SystemHealthThresholds } from '../config.js';
import { evaluateHostPressure } from '../evaluate.js';
import { available, unavailable, type HostMetricSample } from '../types.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const thresholds: SystemHealthThresholds = {
  memoryAvailableWarningBytes: 4 * GIB,
  memoryAvailableCriticalBytes: 2 * GIB,
  swapUsedWarningPercent: 20,
  swapUsedCriticalPercent: 50,
  cpuLoadWarningPerCore: 1,
  cpuLoadCriticalPerCore: 1.5,
  overcommitWarningPercent: 150,
  overcommitCriticalPercent: 200,
};

function sample(
  overrides: Partial<HostMetricSample> = {},
): HostMetricSample {
  return {
    platform: 'linux',
    sampledAtMs: 1,
    cpuPercent: available(25),
    loadAverage1m: available(2),
    loadPerCore1m: available(0.5),
    totalMemoryBytes: available(16 * GIB),
    usedMemoryBytes: available(8 * GIB),
    availableMemoryBytes: available(8 * GIB),
    memoryUsedPercent: available(50),
    memoryPressureSomeAvg10: available(0),
    memoryPressureFullAvg10: available(0),
    memoryPressureFreePercent: unavailable('not a macOS sample'),
    swapTotalBytes: available(4 * GIB),
    swapUsedBytes: available(2 * GIB),
    swapUsedPercent: available(50),
    swapActivityBytesPerMinute: available(0),
    committedMemoryBytes: available(20 * GIB),
    commitLimitBytes: available(16 * GIB),
    virtualCommitmentPercent: available(125),
    counters: { cpu: null, swap: null },
    ...overrides,
  };
}

function findReason(
  result: ReturnType<typeof evaluateHostPressure>,
  code: string,
) {
  return result.reasons.find((entry) => entry.code === code);
}

describe('evaluateHostPressure', () => {
  it('keeps historical swap occupancy and commitment diagnostic on a healthy host', () => {
    const result = evaluateHostPressure(sample(), thresholds);

    expect(result.state).toBe('healthy');
    expect(result.admission.state).toBe('open');
    expect(result.reasons.filter((entry) => entry.severity !== 'info')).toEqual([]);
    expect(findReason(result, 'host.diagnostic.swap_occupancy')).toMatchObject({
      severity: 'info',
      observed: 50,
      threshold: 20,
    });
    expect(findReason(result, 'host.diagnostic.virtual_commitment')).toMatchObject({
      severity: 'info',
      observed: 125,
      threshold: 150,
    });
  });

  it.each([
    {
      label: 'Linux some PSI warning',
      input: sample({
        availableMemoryBytes: available(4 * GIB),
        memoryPressureSomeAvg10: available(5),
      }),
      state: 'warning',
      code: 'host.linux.psi_some.warning',
      observed: 5,
      threshold: 5,
    },
    {
      label: 'Linux full PSI critical',
      input: sample({
        availableMemoryBytes: available(2 * GIB),
        memoryPressureFullAvg10: available(1),
      }),
      state: 'critical',
      code: 'host.linux.psi_full.critical',
      observed: 1,
      threshold: 1,
    },
    {
      label: 'Linux swap activity warning',
      input: sample({
        availableMemoryBytes: available(4 * GIB),
        swapActivityBytesPerMinute: available(64 * MIB),
      }),
      state: 'warning',
      code: 'host.linux.swap_activity.warning',
      observed: 64 * MIB,
      threshold: 64 * MIB,
    },
    {
      label: 'Linux swap activity critical',
      input: sample({
        availableMemoryBytes: available(2 * GIB),
        swapActivityBytesPerMinute: available(256 * MIB),
      }),
      state: 'critical',
      code: 'host.linux.swap_activity.critical',
      observed: 256 * MIB,
      threshold: 256 * MIB,
    },
    {
      label: 'macOS warning',
      input: sample({
        platform: 'darwin',
        memoryPressureSomeAvg10: unavailable('not Linux'),
        memoryPressureFullAvg10: unavailable('not Linux'),
        swapActivityBytesPerMinute: unavailable('not available'),
        memoryPressureFreePercent: available(10),
      }),
      state: 'warning',
      code: 'host.darwin.memory_pressure.warning',
      observed: 10,
      threshold: 10,
    },
    {
      label: 'macOS critical',
      input: sample({
        platform: 'darwin',
        memoryPressureSomeAvg10: unavailable('not Linux'),
        memoryPressureFullAvg10: unavailable('not Linux'),
        swapActivityBytesPerMinute: unavailable('not available'),
        memoryPressureFreePercent: available(5),
      }),
      state: 'critical',
      code: 'host.darwin.memory_pressure.critical',
      observed: 5,
      threshold: 5,
    },
  ])('classifies the $label boundary with stable evidence', ({
    input,
    state,
    code,
    observed,
    threshold,
  }) => {
    const result = evaluateHostPressure(input, thresholds);

    expect(result.state).toBe(state);
    expect(findReason(result, code)).toMatchObject({ observed, threshold });
    if (code === 'host.linux.swap_activity.critical') {
      expect(findReason(result, 'host.linux.swap_activity.warning')).toBeUndefined();
    }
  });

  it('reports a reserve crossing in admission without elevating quiet host pressure', () => {
    const result = evaluateHostPressure(sample({
      availableMemoryBytes: available(1 * GIB),
      memoryPressureSomeAvg10: available(0),
      memoryPressureFullAvg10: available(0),
      swapActivityBytesPerMinute: available(0),
    }), thresholds);

    expect(result.state).toBe('healthy');
    expect(result.admission.state).toBe('blocked');
    expect(result.admission.reasons[0]).toMatchObject({
      code: 'admission.memory_available.blocked',
      observed: 1 * GIB,
      threshold: 2 * GIB,
    });
  });

  it('marks host pressure unavailable while preserving an honest admission result', () => {
    const result = evaluateHostPressure(sample({
      availableMemoryBytes: available(1 * GIB),
      memoryPressureSomeAvg10: unavailable('missing PSI'),
      memoryPressureFullAvg10: unavailable('missing PSI'),
      swapActivityBytesPerMinute: unavailable('missing vmstat'),
    }), thresholds);

    expect(result.state).toBe('unavailable');
    expect(result.admission.state).toBe('blocked');
    expect(findReason(result, 'host.current_pressure.unavailable')).toMatchObject({
      severity: 'info',
    });
  });
});
