import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../../../src/lib/config-yaml.js';
import { defaultGovernorReserveConfig, normalizeGovernorReserveConfig } from '../../../../src/lib/resource-governor.js';

const GIB = 1024 ** 3;

describe('resource governor config', () => {
  it('uses the documented fraction-of-totalmem defaults', () => {
    expect(defaultGovernorReserveConfig(100 * GIB)).toEqual({
      governorSoftReserveGb: 15,
      governorHardReserveGb: 8,
      governorRecoveryReserveGb: 25,
    });
  });

  it('normalizes recovery above soft when the YAML value is not strictly greater', () => {
    expect(normalizeGovernorReserveConfig({
      governorSoftReserveGb: 10,
      governorHardReserveGb: 5,
      governorRecoveryReserveGb: 9,
    })).toEqual({
      governorSoftReserveGb: 10,
      governorHardReserveGb: 5,
      governorRecoveryReserveGb: 11,
    });
  });

  it('round-trips the config-yaml resources block into normalized governor thresholds', () => {
    const { config } = mergeConfigs({
      resources: {
        governor_soft_reserve_gb: 10,
        governor_hard_reserve_gb: 5,
        governor_recovery_reserve_gb: 9,
      },
    });

    expect(config.resources.governorSoftReserveGb).toBe(10);
    expect(config.resources.governorHardReserveGb).toBe(5);
    expect(config.resources.governorRecoveryReserveGb).toBe(11);
  });
});
