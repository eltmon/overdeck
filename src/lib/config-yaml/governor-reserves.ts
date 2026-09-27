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

const RESERVE_YAML_KEYS: Record<keyof GovernorReservesGb, string> = {
  hard: 'governor_hard_reserve_gb',
  soft: 'governor_soft_reserve_gb',
  watch: 'governor_watch_reserve_gb',
  recovery: 'governor_recovery_reserve_gb',
};

const CANONICAL_KEY_ORDER: (keyof GovernorReservesGb)[] = ['hard', 'recovery', 'watch', 'soft'];

function formatGb(n: number): string {
  return n.toFixed(1);
}

/**
 * PAN-4267: normalize a user-supplied set of governor reserves so ordering
 * invariants (hard < soft < watch, soft < recovery) hold and no reserve sits
 * at or above the host's total RAM (which would keep the governor shedding
 * forever). Applies in order on a copy, then re-checks against totalGb.
 */
export function normalizeGovernorReserves(
  input: GovernorReservesGb,
  totalGb: number,
  warn: (message: string) => void = console.warn,
): GovernorReservesGb {
  const result: GovernorReservesGb = { ...input };
  const corrected = new Set<keyof GovernorReservesGb>();

  if (result.hard >= result.soft) {
    result.hard = result.soft * 0.5;
    corrected.add('hard');
  }
  if (result.recovery <= result.soft) {
    result.recovery = result.soft + 1;
    corrected.add('recovery');
  }
  if (result.watch <= result.soft) {
    result.watch = result.soft + 1;
    corrected.add('watch');
  }

  const overTotal = CANONICAL_KEY_ORDER.filter((key) => result[key] >= totalGb);
  if (overTotal.length > 0) {
    const defaults = computeGovernorReserveDefaultsGb(totalGb);
    result.hard = defaults.hard;
    result.soft = defaults.soft;
    result.watch = defaults.watch;
    result.recovery = defaults.recovery;

    const keys = overTotal.map((key) => RESERVE_YAML_KEYS[key]).join(', ');
    warn(
      `[config] resources governor reserves (${keys}) are at or above this host's `
      + `${formatGb(totalGb)} GB RAM; using scaled defaults (hard ${formatGb(defaults.hard)}, `
      + `soft ${formatGb(defaults.soft)}, watch ${formatGb(defaults.watch)}, `
      + `recovery ${formatGb(defaults.recovery)} GB).`,
    );
    return result;
  }

  if (corrected.size > 0) {
    const keys = CANONICAL_KEY_ORDER.filter((key) => corrected.has(key))
      .map((key) => RESERVE_YAML_KEYS[key])
      .join(', ');
    warn(
      `[config] resources governor reserves (${keys}) were invalid relative to `
      + `governor_soft_reserve_gb; corrected to hard ${formatGb(result.hard)}, `
      + `soft ${formatGb(result.soft)}, watch ${formatGb(result.watch)}, `
      + `recovery ${formatGb(result.recovery)} GB.`,
    );
  }

  return result;
}
