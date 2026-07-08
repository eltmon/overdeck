import { totalmem } from 'node:os';

const GIB = 1024 ** 3;
const SOFT_RESERVE_FRACTION = 0.15;
const SOFT_RESERVE_FLOOR_GB = 8;
const HARD_RESERVE_FRACTION = 0.08;
const HARD_RESERVE_FLOOR_GB = 4;
const RECOVERY_RESERVE_FRACTION = 0.25;
const RECOVERY_RESERVE_FLOOR_GB = 12;

export interface GovernorReserveConfig {
  governorSoftReserveGb: number;
  governorHardReserveGb: number;
  governorRecoveryReserveGb: number;
}

export function defaultGovernorReserveConfig(totalBytes: number = totalmem()): GovernorReserveConfig {
  return {
    governorSoftReserveGb: Math.max((totalBytes * SOFT_RESERVE_FRACTION) / GIB, SOFT_RESERVE_FLOOR_GB),
    governorHardReserveGb: Math.max((totalBytes * HARD_RESERVE_FRACTION) / GIB, HARD_RESERVE_FLOOR_GB),
    governorRecoveryReserveGb: Math.max((totalBytes * RECOVERY_RESERVE_FRACTION) / GIB, RECOVERY_RESERVE_FLOOR_GB),
  };
}

export function normalizeGovernorReserveConfig(
  input: Partial<GovernorReserveConfig> | undefined,
  totalBytes: number = totalmem(),
): GovernorReserveConfig {
  const defaults = defaultGovernorReserveConfig(totalBytes);
  const governorSoftReserveGb = input?.governorSoftReserveGb ?? defaults.governorSoftReserveGb;
  const governorHardReserveGb = input?.governorHardReserveGb ?? defaults.governorHardReserveGb;
  const governorRecoveryReserveGb = input?.governorRecoveryReserveGb ?? defaults.governorRecoveryReserveGb;

  return {
    governorSoftReserveGb,
    governorHardReserveGb,
    governorRecoveryReserveGb: governorRecoveryReserveGb > governorSoftReserveGb ? governorRecoveryReserveGb : governorSoftReserveGb + 1,
  };
}
