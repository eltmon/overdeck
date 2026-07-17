import type {
  FlywheelStats,
  FlywheelStatsCriteria,
  FlywheelStatsCriterion,
  FlywheelStatsCriterionStatus,
  FlywheelStatsCriterionValue,
} from '@overdeck/contracts';

type CriterionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Direction = 'lower' | 'higher' | 'zero';

interface CriterionMeta {
  key: keyof FlywheelStatsCriteria;
  direction: Direction;
  valueField?: string;
}

export const CRITERION_META = {
  1: { key: 'c1_bugRate', direction: 'lower' },
  2: { key: 'c2_p0Bugs', direction: 'zero' },
  3: { key: 'c3_passRate', direction: 'higher' },
  4: { key: 'c4_mttr', direction: 'lower', valueField: 'medianMs' },
  5: { key: 'c5_intervention', direction: 'lower' },
  6: { key: 'c6_timeConsistency', direction: 'lower', valueField: 'ratio' },
  7: { key: 'c7_flake', direction: 'lower' },
} as const satisfies Record<CriterionNumber, CriterionMeta>;

const STATUS_MULT = {
  red: 3,
  yellow: 2,
  green: 1,
  insufficient_data: 0,
} as const satisfies Record<FlywheelStatsCriterionStatus, number>;

const STATUS_FLOOR = {
  red: 1,
  yellow: 0.5,
  green: 0,
  insufficient_data: 0,
} as const satisfies Record<FlywheelStatsCriterionStatus, number>;

interface CriterionContribution {
  criterion: CriterionNumber;
  stat: FlywheelStatsCriterion;
  meta: CriterionMeta;
  value: number | undefined;
  target: number | undefined;
  contribution: number;
}

export interface SubstrateBugWeight {
  weight: number;
  reason: string;
}

function isCriterionNumber(value: number): value is CriterionNumber {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

function numericSubfield(value: FlywheelStatsCriterionValue, field: string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!field || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const fieldValue = value[field];
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined;
}

function maxBucketRatio(value: FlywheelStatsCriterionValue): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;

  let max: number | undefined;
  for (const bucket of ['simple', 'medium', 'complex']) {
    const bucketValue = (value as Record<string, unknown>)[bucket];
    if (bucketValue && typeof bucketValue === 'object' && !Array.isArray(bucketValue)) {
      const ratio = (bucketValue as Record<string, unknown>).ratio;
      if (typeof ratio === 'number' && Number.isFinite(ratio) && (max === undefined || ratio > max)) {
        max = ratio;
      }
    }
  }
  return max;
}

function normalizedDistance(
  direction: Direction,
  value: number | undefined,
  target: number | undefined,
): number {
  if (value === undefined) return 0;

  if (direction === 'zero') return Math.max(0, value);
  if (target === undefined || target <= 0) return 0;

  if (direction === 'lower') return Math.max(0, (value - target) / target);
  return Math.max(0, (target - value) / target);
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMetricValue(value: number | undefined): string {
  return value === undefined ? 'unavailable' : `${value}`;
}

function formatReason(contribution: CriterionContribution): string {
  const label = contribution.stat.label.toLowerCase();
  const value = formatMetricValue(contribution.value);
  const target = formatMetricValue(contribution.target);
  const comparator = contribution.meta.direction === 'higher'
    ? '>'
    : contribution.meta.direction === 'zero' ? '=' : '<';

  return `criterion ${contribution.criterion} (${label}) ${contribution.stat.status} at ${value} vs target ${comparator}${target}`;
}

export function computeSubstrateBugWeight(criteria: number[], stats: FlywheelStats): SubstrateBugWeight {
  if (criteria.length === 0) {
    return { weight: 0, reason: 'no affected criteria declared' };
  }

  const contributions: CriterionContribution[] = [];

  for (const criterion of criteria) {
    if (!isCriterionNumber(criterion)) continue;

    const meta: CriterionMeta = CRITERION_META[criterion];
    const stat = stats.criteria[meta.key];
    const value = criterion === 6 ? maxBucketRatio(stat.value) : numericSubfield(stat.value, meta.valueField);
    const target = criterion === 6 ? numericSubfield(stat.target, 'maxRatio') : numericSubfield(stat.target, meta.valueField);
    const distance = normalizedDistance(meta.direction, value, target);
    const contribution = STATUS_MULT[stat.status] * (STATUS_FLOOR[stat.status] + distance);

    contributions.push({
      criterion,
      stat,
      meta,
      value,
      target,
      contribution,
    });
  }

  if (contributions.length === 0) {
    return { weight: 0, reason: 'no affected criteria declared' };
  }

  const weight = roundWeight(contributions.reduce((sum, item) => sum + item.contribution, 0));
  const highest = contributions.reduce((best, item) => (
    item.contribution > best.contribution ? item : best
  ));

  if (weight === 0 && contributions.every((item) => item.stat.status === 'insufficient_data')) {
    return { weight: 0, reason: 'insufficient telemetry for affected criteria' };
  }

  return {
    weight,
    reason: formatReason(highest),
  };
}
