import type { FlywheelStats, FlywheelStatsCriterion } from '@panctl/contracts';

export interface FlywheelStatsOptions {
  generatedAt?: Date;
  completedPipelineRuns?: number;
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

export function computeInterventionCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'Operator intervention rate',
    0,
    0.05,
    completedPipelineRuns,
  );
}

export function computeTimeConsistencyCriterion(completedPipelineRuns: number): FlywheelStatsCriterion {
  return placeholderCriterion(
    'Time-in-pipeline consistency',
    { simple: 0, medium: 0, complex: 0 },
    { maxRatio: 2 },
    completedPipelineRuns,
  );
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
