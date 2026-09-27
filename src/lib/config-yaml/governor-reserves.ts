/**
 * PAN-4267: governor reserve and spawn-guardrail defaults as a share of RAM,
 * capped so a small host (e.g. an 8-16 GB Mac) never gets a recovery reserve
 * at or above its total memory. Kept import-free of defaults.ts/merge.ts so
 * it can be unit-tested in isolation and reused by config normalization.
 */

export interface GovernorReservesGb {
  hard: number;
  soft: number;
  watch: number;
  recovery: number;
}

interface ReserveRule {
  pct: number;
  floor: number;
  cap: number;
}

const RESERVE_RULES: Record<keyof GovernorReservesGb, ReserveRule> = {
  hard: { pct: 0.08, floor: 4, cap: 0.10 },
  soft: { pct: 0.15, floor: 8, cap: 0.20 },
  watch: { pct: 0.20, floor: 10, cap: 0.25 },
  recovery: { pct: 0.25, floor: 12, cap: 0.35 },
};

export function computeGovernorReserveDefaultsGb(totalGb: number): GovernorReservesGb {
  const result = {} as GovernorReservesGb;
  for (const key of Object.keys(RESERVE_RULES) as (keyof GovernorReservesGb)[]) {
    const rule = RESERVE_RULES[key];
    result[key] = Math.min(Math.max(rule.pct * totalGb, rule.floor), rule.cap * totalGb);
  }
  return result;
}

export interface SpawnMemoryThresholdDefaultsGb {
  warnGb: number;
  blockGb: number;
}

export function computeSpawnMemoryThresholdDefaultsGb(totalGb: number): SpawnMemoryThresholdDefaultsGb {
  return {
    warnGb: Math.min(4, totalGb / 8),
    blockGb: Math.min(2, totalGb / 16),
  };
}
