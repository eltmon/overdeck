import type { FlywheelStats, FlywheelStatsCriterion } from '@panctl/contracts';
import type { PipelineRunMetrics } from './pipeline-run-metrics.js';

export interface FlywheelStatsOptions {
  generatedAt?: Date;
  completedPipelineRuns?: number;
}

export interface Criterion5PipelineRun {
  metrics: PipelineRunMetrics;
  uatActionCount?: number;
}

export type Criterion6ComplexityBucket = 'simple' | 'medium' | 'complex';

export interface Criterion6PipelineRun {
  metrics: PipelineRunMetrics;
  beadsCount?: number;
  planItemsCount?: number;
}

export interface Criterion7VerificationAttempt {
  issueId: string;
  stage: 'review' | 'test';
  passed: boolean;
  headSha?: string;
  substrateAttributable?: boolean;
}

export interface ParsedFlywheelStatsWindow {
  input: string;
  ms: number;
}

const durationUnitsMs: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseFlywheelStatsWindow(window: string): ParsedFlywheelStatsWindow {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(window.trim());
  if (!match) throw new Error(`Invalid Flywheel stats window: ${window}`);

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Invalid Flywheel stats window: ${window}`);

  return {
    input: `${amount}${match[2]}`,
    ms: amount * durationUnitsMs[match[2]]!,
  };
}

function placeholderCriterion(
  label: string,
  value: FlywheelStatsCriterion['value'],
  target: FlywheelStatsCriterion['target'],
  completedPipelineRuns: number,
): FlywheelStatsCriterion {
  return {
    label,
    value,
    target,
    status: 'insufficient_data',
    sampleSize: completedPipelineRuns,
    dataSufficient: false,
  };
}

export function computeBugRateCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'Substrate-bug discovery rate',
    0,
    0.02,
    completedPipelineRuns,
  );
}

export function computeP0BugsCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'Critical/P0 substrate bugs',
    0,
    0,
    completedPipelineRuns,
  );
}

export function computePassRateCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'Pipeline pass success rate',
    0,
    0.99,
    completedPipelineRuns,
  );
}

export function computeMttrCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'MTTR for filed substrate bugs',
    { medianMs: 0, p95Ms: 0 },
    { medianMs: 24 * 60 * 60 * 1000, p95Ms: 7 * 24 * 60 * 60 * 1000 },
    completedPipelineRuns,
  );
}

function interventionStatus(rate: number): FlywheelStatsCriterion['status'] {
  if (rate < 0.05) return 'green';
  if (rate <= 0.20) return 'yellow';
  return 'red';
}

export function computeCriterion5(runs: readonly Criterion5PipelineRun[]): FlywheelStatsCriterion {
  const completedRuns = runs.filter((run) => run.metrics.outcome !== 'in_flight');
  const interventionCount = completedRuns.reduce((sum, run) => sum + run.metrics.interventionCount, 0);
  const rate = completedRuns.length === 0 ? 0 : interventionCount / completedRuns.length;

  return {
    label: 'Operator intervention rate',
    value: rate,
    target: 0.05,
    status: completedRuns.length === 0 ? 'insufficient_data' : interventionStatus(rate),
    sampleSize: completedRuns.length,
    dataSufficient: completedRuns.length > 0,
  };
}

export function computeInterventionCriterion(completedPipelineRuns: number, runs: readonly Criterion5PipelineRun[] = []): FlywheelStatsCriterion {
  if (completedPipelineRuns < 3) {
    return placeholderCriterion(
      'Operator intervention rate',
      0,
      0.05,
      completedPipelineRuns,
    );
  }

  return computeCriterion5(runs);
}

const complexityBuckets = ['simple', 'medium', 'complex'] as const satisfies readonly Criterion6ComplexityBucket[];

function criterion6Status(ratio: number): FlywheelStatsCriterion['status'] {
  if (ratio <= 2) return 'green';
  if (ratio <= 3) return 'yellow';
  return 'red';
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function complexityBucketForItemCount(itemCount: number): Criterion6ComplexityBucket | null {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) return null;
  if (itemCount <= 3) return 'simple';
  if (itemCount <= 8) return 'medium';
  return 'complex';
}

function bucketForRun(run: Criterion6PipelineRun): Criterion6ComplexityBucket | null {
  return complexityBucketForItemCount(run.beadsCount ?? run.planItemsCount ?? 0);
}

function totalPipelineMs(metrics: PipelineRunMetrics): number | null {
  if (metrics.outcome === 'in_flight') return null;
  if (metrics.mergeMs !== null) return metrics.mergeMs;

  const durations = [metrics.plan, metrics.work, metrics.review, metrics.test, metrics.ship]
    .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration));
  if (durations.length === 0) return null;
  return durations.reduce((sum, duration) => sum + duration, 0);
}

function computeCriterion6Bucket(values: readonly number[]) {
  if (values.length < 3) {
    return {
      medianMs: median(values),
      p95Ms: percentile(values, 95),
      ratio: 0,
      status: 'insufficient_data' as const,
      sampleSize: values.length,
      dataSufficient: false,
    };
  }

  const medianMs = median(values);
  const p95Ms = percentile(values, 95);
  const ratio = medianMs === 0
    ? p95Ms === 0 ? 0 : Number.MAX_SAFE_INTEGER
    : p95Ms / medianMs;

  return {
    medianMs,
    p95Ms,
    ratio,
    status: criterion6Status(ratio),
    sampleSize: values.length,
    dataSufficient: true,
  };
}

function worstCriterion6Status(statuses: readonly FlywheelStatsCriterion['status'][]): FlywheelStatsCriterion['status'] {
  if (statuses.length === 0) return 'insufficient_data';
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

export function computeCriterion6(runs: readonly Criterion6PipelineRun[]): FlywheelStatsCriterion {
  const bucketedRuns: Record<Criterion6ComplexityBucket, number[]> = {
    simple: [],
    medium: [],
    complex: [],
  };

  for (const run of runs) {
    const bucket = bucketForRun(run);
    const totalMs = totalPipelineMs(run.metrics);
    if (!bucket || totalMs === null) continue;
    bucketedRuns[bucket].push(totalMs);
  }

  const value = Object.fromEntries(
    complexityBuckets.map((bucket) => [bucket, computeCriterion6Bucket(bucketedRuns[bucket])]),
  ) as Record<Criterion6ComplexityBucket, ReturnType<typeof computeCriterion6Bucket>>;
  const sufficientStatuses = complexityBuckets
    .map((bucket) => value[bucket])
    .filter((bucket) => bucket.dataSufficient)
    .map((bucket) => bucket.status);

  return {
    label: 'Time-in-pipeline consistency',
    value,
    target: { maxRatio: 2 },
    status: worstCriterion6Status(sufficientStatuses),
    sampleSize: complexityBuckets.reduce((sum, bucket) => sum + value[bucket].sampleSize, 0),
    dataSufficient: sufficientStatuses.length > 0,
  };
}

export function computeTimeConsistencyCriterion(completedPipelineRuns: number, runs: readonly Criterion6PipelineRun[] = []): FlywheelStatsCriterion {
  if (completedPipelineRuns < 3) {
    return placeholderCriterion(
      'Time-in-pipeline consistency',
      { simple: 0, medium: 0, complex: 0 },
      { maxRatio: 2 },
      completedPipelineRuns,
    );
  }

  return computeCriterion6(runs);
}

function flakeStatus(rate: number): FlywheelStatsCriterion['status'] {
  if (rate < 0.05) return 'green';
  if (rate <= 0.10) return 'yellow';
  return 'red';
}

export function computeCriterion7(attempts: readonly Criterion7VerificationAttempt[]): FlywheelStatsCriterion {
  const lastAttemptByStage = new Map<string, Criterion7VerificationAttempt>();
  let flakeCount = 0;
  let substrateFailureCount = 0;

  for (const attempt of attempts) {
    const key = `${attempt.issueId}:${attempt.stage}`;
    const previous = lastAttemptByStage.get(key);

    if (!attempt.passed && attempt.substrateAttributable === true) {
      substrateFailureCount += 1;
      if (attempt.headSha && previous?.passed === true && previous.headSha === attempt.headSha) {
        flakeCount += 1;
      }
    }

    lastAttemptByStage.set(key, attempt);
  }

  const rate = substrateFailureCount === 0 ? 0 : flakeCount / substrateFailureCount;
  return {
    label: 'Substrate-attributable flake rate',
    value: rate,
    target: 0.05,
    status: flakeStatus(rate),
    sampleSize: substrateFailureCount,
    dataSufficient: substrateFailureCount > 0,
  };
}

export function computeFlakeCriterion(completedPipelineRuns: number, attempts: readonly Criterion7VerificationAttempt[] = []): FlywheelStatsCriterion {
  if (completedPipelineRuns < 3) {
    return placeholderCriterion(
      'Substrate-attributable flake rate',
      0,
      0.05,
      completedPipelineRuns,
    );
  }

  return computeCriterion7(attempts);
}

export async function computeFlywheelStats(
  window: string,
  options: FlywheelStatsOptions = {},
): Promise<FlywheelStats> {
  const parsedWindow = parseFlywheelStatsWindow(window);
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const completedPipelineRuns = options.completedPipelineRuns ?? 0;

  return {
    window: parsedWindow.input,
    generatedAt,
    criteria: {
      c1_bugRate: computeBugRateCriterion(completedPipelineRuns),
      c2_p0Bugs: computeP0BugsCriterion(completedPipelineRuns),
      c3_passRate: computePassRateCriterion(completedPipelineRuns),
      c4_mttr: computeMttrCriterion(completedPipelineRuns),
      c5_intervention: computeInterventionCriterion(completedPipelineRuns),
      c6_timeConsistency: computeTimeConsistencyCriterion(completedPipelineRuns),
      c7_flake: computeFlakeCriterion(completedPipelineRuns),
    },
  };
}
