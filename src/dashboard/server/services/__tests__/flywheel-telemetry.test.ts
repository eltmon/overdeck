import { describe, expect, it } from 'vitest';
import { decodeFlywheelStats } from '@panctl/contracts';
import {
  computeBugRateCriterion,
  computeCriterion2,
  computeCriterion3,
  computeCriterion4,
  computeCriterion5,
  computeCriterion6,
  computeCriterion7,
  computeFlakeCriterion,
  computeFlywheelStats,
  computeInterventionCriterion,
  computeMttrCriterion,
  computeP0BugsCriterion,
  computePassRateCriterion,
  computeTimeConsistencyCriterion,
  parseFlywheelStatsWindow,
} from '../flywheel-telemetry.js';

const generatedAt = new Date('2026-05-25T10:00:00.000Z');

type Criterion6BucketValue = {
  medianMs: number;
  p95Ms: number;
  ratio: number;
  status: string;
  sampleSize: number;
  dataSufficient: boolean;
};

function metrics(overrides: { mergeMs?: number; interventionCount?: number; outcome?: 'merged' | 'parked' | 'cancelled' | 'in_flight' } = {}) {
  return {
    plan: null,
    work: null,
    review: 0,
    test: 0,
    ship: null,
    mergeMs: overrides.mergeMs ?? 100,
    outcome: overrides.outcome ?? 'merged',
    interventionCount: overrides.interventionCount ?? 0,
    passCount: 0,
  };
}

function criterion5Run(interventionCount: number, options: { outcome?: 'merged' | 'parked' | 'cancelled' | 'in_flight'; uatActionCount?: number } = {}) {
  return {
    metrics: metrics({ interventionCount, ...(options.outcome ? { outcome: options.outcome } : {}) }),
    ...(options.uatActionCount === undefined ? {} : { uatActionCount: options.uatActionCount }),
  };
}

function criterion6Run(totalMs: number, counts: { beadsCount?: number; planItemsCount?: number }) {
  return {
    ...counts,
    metrics: metrics({ mergeMs: totalMs }),
  };
}

function criterion6Value(criterion: ReturnType<typeof computeCriterion6>) {
  return criterion.value as Record<'simple' | 'medium' | 'complex', Criterion6BucketValue>;
}

function criterion4Bug(
  issueId: string,
  filedAt: string,
  fixMergedAt: string | null,
  status: 'open' | 'fixed' = 'fixed',
  severity = 'P2',
) {
  return {
    issueId,
    filedAt,
    runId: null,
    filedBy: 'agent' as const,
    discoveredInIssueId: null,
    severity,
    status,
    fixMergedAt,
    fixCommitSha: fixMergedAt ? 'abc123' : null,
    updatedAt: fixMergedAt ?? filedAt,
  };
}

describe('flywheel telemetry', () => {
  it.each([
    ['30d', 30 * 24 * 60 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
    ['24h', 24 * 60 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
  ])('parses stats window %s', (window, ms) => {
    expect(parseFlywheelStatsWindow(window)).toEqual({ input: window, ms });
  });

  it('rejects invalid stats windows', () => {
    expect(() => parseFlywheelStatsWindow('0h')).toThrow('Invalid Flywheel stats window');
    expect(() => parseFlywheelStatsWindow('30days')).toThrow('Invalid Flywheel stats window');
    expect(() => parseFlywheelStatsWindow('soon')).toThrow('Invalid Flywheel stats window');
  });

  it('returns a complete placeholder FlywheelStats response', async () => {
    const stats = await computeFlywheelStats('30d', { generatedAt, completedPipelineRuns: 2 });

    expect(decodeFlywheelStats(stats)).toEqual(stats);
    expect(stats).toMatchInlineSnapshot(`
      {
        "criteria": {
          "c1_bugRate": {
            "dataSufficient": false,
            "label": "Substrate-bug discovery rate",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": 0.02,
            "value": 0,
          },
          "c2_p0Bugs": {
            "dataSufficient": false,
            "label": "Critical/P0 substrate bugs",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": 0,
            "value": 0,
          },
          "c3_passRate": {
            "dataSufficient": false,
            "label": "Pipeline pass success rate",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": 0.99,
            "value": 0,
          },
          "c4_mttr": {
            "dataSufficient": false,
            "label": "MTTR for filed substrate bugs",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": {
              "medianMs": 86400000,
              "p95Ms": 604800000,
            },
            "value": {
              "medianMs": 0,
              "p95Ms": 0,
            },
          },
          "c5_intervention": {
            "dataSufficient": false,
            "label": "Operator intervention rate",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": 0.05,
            "value": 0,
          },
          "c6_timeConsistency": {
            "dataSufficient": false,
            "label": "Time-in-pipeline consistency",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": {
              "maxRatio": 2,
            },
            "value": {
              "complex": 0,
              "medium": 0,
              "simple": 0,
            },
          },
          "c7_flake": {
            "dataSufficient": false,
            "label": "Substrate-attributable flake rate",
            "sampleSize": 2,
            "status": "insufficient_data",
            "target": 0.05,
            "value": 0,
          },
        },
        "generatedAt": "2026-05-25T10:00:00.000Z",
        "window": "30d",
      }
    `);
  });

  it('exports one helper per readiness criterion', () => {
    const helpers = [
      computeBugRateCriterion,
      computeP0BugsCriterion,
      computePassRateCriterion,
      computeMttrCriterion,
      computeInterventionCriterion,
      computeTimeConsistencyCriterion,
      computeFlakeCriterion,
    ];

    for (const helper of helpers) {
      expect(helper(2)).toMatchObject({
        status: 'insufficient_data',
        sampleSize: 2,
        dataSufficient: false,
      });
    }
  });

  it('marks every criterion as insufficient when fewer than three runs exist', async () => {
    const stats = await computeFlywheelStats('7d', { generatedAt, completedPipelineRuns: 2 });

    expect(Object.values(stats.criteria).every((criterion) => criterion.dataSufficient === false)).toBe(true);
    expect(Object.values(stats.criteria).every((criterion) => criterion.status === 'insufficient_data')).toBe(true);
  });

  it('computes criterion 2 as P0 substrate bugs filed in the window', () => {
    const criterion = computeCriterion2([
      criterion4Bug('PAN-1', '2026-05-01T00:00:00.000Z', null, 'open', 'P0'),
      criterion4Bug('PAN-2', '2026-05-02T00:00:00.000Z', null, 'open', 'P1'),
      criterion4Bug('PAN-3', '2026-04-30T23:59:59.999Z', null, 'open', 'P0'),
    ], '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(criterion.value).toBe(1);
    expect(criterion.target).toBe(0);
    expect(criterion.status).toBe('red');
    expect(criterion.sampleSize).toBe(2);
    expect(criterion.dataSufficient).toBe(true);
  });

  it('marks criterion 2 green when no P0 substrate bugs were filed in the window', () => {
    const criterion = computeCriterion2([
      criterion4Bug('PAN-1', '2026-05-01T00:00:00.000Z', null, 'open', 'P1'),
      criterion4Bug('PAN-2', '2026-05-02T00:00:00.000Z', null, 'open', 'P2'),
    ], '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(criterion.value).toBe(0);
    expect(criterion.target).toBe(0);
    expect(criterion.status).toBe('green');
  });

  it('computes criterion 3 from substrate-attributable failures over all verification attempts', () => {
    const attempts = [
      { issueId: 'PAN-1', stage: 'review' as const, passed: false, substrateAttributable: true },
      ...Array.from({ length: 99 }, (_, index) => ({ issueId: `PAN-${index + 2}`, stage: 'test' as const, passed: true })),
    ];

    const criterion = computeCriterion3(attempts);

    expect(criterion.value).toBe(0.99);
    expect(criterion.target).toBe(0.99);
    expect(criterion.status).toBe('green');
    expect(criterion.sampleSize).toBe(100);
    expect(criterion.dataSufficient).toBe(true);
  });

  it('excludes legitimate code-defect failures from criterion 3 numerator but not denominator', () => {
    const criterion = computeCriterion3([
      { issueId: 'PAN-1', stage: 'review', passed: false, substrateAttributable: false },
      { issueId: 'PAN-2', stage: 'test', passed: false },
      { issueId: 'PAN-3', stage: 'review', passed: true },
      { issueId: 'PAN-4', stage: 'test', passed: false, substrateAttributable: true },
    ]);

    expect(criterion.value).toBe(0.75);
    expect(criterion.sampleSize).toBe(4);
    expect(criterion.status).toBe('red');
  });

  it.each([
    [0, 100, 'green'],
    [1, 100, 'green'],
    [2, 100, 'yellow'],
    [5, 100, 'yellow'],
    [6, 100, 'red'],
  ] as const)('maps criterion 3 thresholds for %d substrate failures over %d attempts', (failures, attempts, status) => {
    const verificationAttempts = Array.from({ length: attempts }, (_, index) => ({
      issueId: `PAN-${index}`,
      stage: index % 2 === 0 ? 'review' as const : 'test' as const,
      passed: index >= failures,
      substrateAttributable: index < failures,
    }));

    const criterion = computeCriterion3(verificationAttempts);

    expect(criterion.value).toBe(1 - (failures / attempts));
    expect(criterion.status).toBe(status);
  });

  it('computes criterion 4 median and p95 MTTR from fixed bugs in the merge window', () => {
    const criterion = computeCriterion4([
      criterion4Bug('PAN-1', '2026-05-01T00:00:00.000Z', '2026-05-01T01:00:00.000Z'),
      criterion4Bug('PAN-2', '2026-05-02T00:00:00.000Z', '2026-05-02T02:00:00.000Z'),
      criterion4Bug('PAN-3', '2026-05-03T00:00:00.000Z', '2026-05-03T06:00:00.000Z'),
      criterion4Bug('PAN-4', '2026-05-04T00:00:00.000Z', '2026-05-04T12:00:00.000Z'),
      criterion4Bug('PAN-5', '2026-05-05T00:00:00.000Z', '2026-05-11T00:00:00.000Z'),
      criterion4Bug('PAN-6', '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z'),
      criterion4Bug('PAN-7', '2026-05-01T00:00:00.000Z', null, 'open'),
    ], '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(criterion.value).toEqual({ medianMs: 6 * 60 * 60 * 1000, p95Ms: 6 * 24 * 60 * 60 * 1000 });
    expect(criterion.target).toEqual({ medianMs: 86_400_000, p95Ms: 604_800_000 });
    expect(criterion.status).toBe('green');
    expect(criterion.sampleSize).toBe(5);
    expect(criterion.dataSufficient).toBe(true);
  });

  it.each([
    [[1, 2, 6], 'green'],
    [[1, 2, 10 * 24], 'yellow'],
    [[1, 2, 15 * 24], 'red'],
    [[25, 26, 27], 'red'],
  ] as const)('maps criterion 4 status for hour durations %j', (durationsHours, status) => {
    const criterion = computeCriterion4(durationsHours.map((hours, index) => criterion4Bug(
      `PAN-${index}`,
      '2026-05-01T00:00:00.000Z',
      new Date(Date.parse('2026-05-01T00:00:00.000Z') + hours * 60 * 60 * 1000).toISOString(),
    )), '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(criterion.status).toBe(status);
    expect(criterion.dataSufficient).toBe(true);
  });

  it('marks criterion 4 insufficient with fewer than three fixed bugs in the window', () => {
    const criterion = computeCriterion4([
      criterion4Bug('PAN-1', '2026-05-01T00:00:00.000Z', '2026-05-01T01:00:00.000Z'),
      criterion4Bug('PAN-2', '2026-05-02T00:00:00.000Z', '2026-05-02T02:00:00.000Z'),
    ], '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(criterion.value).toEqual({ medianMs: 5_400_000, p95Ms: 7_200_000 });
    expect(criterion.status).toBe('insufficient_data');
    expect(criterion.sampleSize).toBe(2);
    expect(criterion.dataSufficient).toBe(false);
  });

  it('computes criterion 5 as operator interventions per completed run', () => {
    const criterion = computeCriterion5([
      criterion5Run(1),
      ...Array.from({ length: 9 }, () => criterion5Run(0)),
    ]);

    expect(criterion.value).toBe(0.1);
    expect(criterion.target).toBe(0.05);
    expect(criterion.status).toBe('yellow');
    expect(criterion.sampleSize).toBe(10);
    expect(criterion.dataSufficient).toBe(true);
  });

  it.each([
    [0, 20, 'green'],
    [1, 20, 'yellow'],
    [4, 20, 'yellow'],
    [5, 20, 'red'],
  ] as const)('maps criterion 5 thresholds for %d interventions over %d runs', (interventions, runs, status) => {
    const criterion = computeCriterion5([
      criterion5Run(interventions),
      ...Array.from({ length: runs - 1 }, () => criterion5Run(0)),
    ]);

    expect(criterion.value).toBe(interventions / runs);
    expect(criterion.status).toBe(status);
  });

  it('ignores in-flight runs and UAT-shaped actions for criterion 5', () => {
    const criterion = computeCriterion5([
      criterion5Run(0, { uatActionCount: 5 }),
      criterion5Run(1, { outcome: 'in_flight' }),
      criterion5Run(0),
      criterion5Run(0),
      criterion5Run(0),
    ]);

    expect(criterion.value).toBe(0);
    expect(criterion.sampleSize).toBe(4);
    expect(criterion.status).toBe('green');
  });

  it('computes criterion 6 medians, p95 values, and ratios per complexity bucket', () => {
    const criterion = computeCriterion6([
      criterion6Run(100, { planItemsCount: 2 }),
      criterion6Run(200, { planItemsCount: 2 }),
      criterion6Run(300, { planItemsCount: 2 }),
      criterion6Run(100, { beadsCount: 6 }),
      criterion6Run(250, { beadsCount: 6 }),
      criterion6Run(800, { beadsCount: 6 }),
    ]);
    const value = criterion6Value(criterion);

    expect(value.simple).toMatchObject({ medianMs: 200, p95Ms: 300, ratio: 1.5, status: 'green', sampleSize: 3, dataSufficient: true });
    expect(value.medium).toMatchObject({ medianMs: 250, p95Ms: 800, ratio: 3.2, status: 'red', sampleSize: 3, dataSufficient: true });
    expect(value.complex).toMatchObject({ medianMs: 0, p95Ms: 0, ratio: 0, status: 'insufficient_data', sampleSize: 0, dataSufficient: false });
    expect(criterion.status).toBe('red');
    expect(criterion.sampleSize).toBe(6);
    expect(criterion.dataSufficient).toBe(true);
  });

  it('uses beads count before falling back to vBRIEF plan item count for criterion 6 buckets', () => {
    const criterion = computeCriterion6([
      criterion6Run(100, { beadsCount: 9, planItemsCount: 2 }),
      criterion6Run(110, { beadsCount: 9, planItemsCount: 2 }),
      criterion6Run(120, { beadsCount: 9, planItemsCount: 2 }),
      criterion6Run(200, { planItemsCount: 2 }),
      criterion6Run(220, { planItemsCount: 2 }),
      criterion6Run(240, { planItemsCount: 2 }),
    ]);
    const value = criterion6Value(criterion);

    expect(value.simple.sampleSize).toBe(3);
    expect(value.medium.sampleSize).toBe(0);
    expect(value.complex.sampleSize).toBe(3);
  });

  it('does not mark undersampled criterion 6 buckets red', () => {
    const criterion = computeCriterion6([
      criterion6Run(100, { beadsCount: 9 }),
      criterion6Run(1_000, { beadsCount: 9 }),
    ]);
    const value = criterion6Value(criterion);

    expect(value.complex).toMatchObject({ status: 'insufficient_data', sampleSize: 2, dataSufficient: false });
    expect(criterion.status).toBe('insufficient_data');
    expect(criterion.dataSufficient).toBe(false);
  });

  it.each([
    [[100, 110, 120], 'green'],
    [[100, 100, 250], 'yellow'],
    [[100, 100, 400], 'red'],
  ] as const)('maps criterion 6 headline status for totals %j', (totals, status) => {
    const criterion = computeCriterion6(totals.map((totalMs) => criterion6Run(totalMs, { beadsCount: 2 })));

    expect(criterion.status).toBe(status);
  });

  it('detects same-issue same-head pass-then-fail verification flakes', () => {
    const criterion = computeCriterion7([
      { issueId: 'PAN-1', stage: 'review', passed: true, headSha: 'abc123' },
      { issueId: 'PAN-1', stage: 'review', passed: false, headSha: 'abc123', substrateAttributable: true },
    ]);

    expect(criterion.value).toBe(1);
    expect(criterion.sampleSize).toBe(1);
    expect(criterion.status).toBe('red');
  });

  it('excludes failures where the head commit changed between cycles', () => {
    const criterion = computeCriterion7([
      { issueId: 'PAN-2', stage: 'test', passed: true, headSha: 'abc123' },
      { issueId: 'PAN-2', stage: 'test', passed: true, headSha: 'def456' },
      { issueId: 'PAN-2', stage: 'test', passed: false, headSha: 'ghi789', substrateAttributable: true },
    ]);

    expect(criterion.value).toBe(0);
    expect(criterion.sampleSize).toBe(1);
    expect(criterion.status).toBe('green');
  });

  it.each([
    [0, 20, 'green'],
    [1, 20, 'yellow'],
    [2, 20, 'yellow'],
    [3, 20, 'red'],
  ] as const)('maps criterion 7 rate thresholds for %d flakes out of %d failures', (flakes, failures, status) => {
    const attempts = Array.from({ length: failures }, (_, index) => {
      const issueId = `PAN-${index}`;
      const headSha = `sha-${index}`;
      return index < flakes
        ? [
            { issueId, stage: 'review' as const, passed: true, headSha },
            { issueId, stage: 'review' as const, passed: false, headSha, substrateAttributable: true },
          ]
        : [
            { issueId, stage: 'review' as const, passed: true, headSha },
            { issueId, stage: 'review' as const, passed: false, headSha: `${headSha}-next`, substrateAttributable: true },
          ];
    }).flat();

    const criterion = computeCriterion7(attempts);

    expect(criterion.target).toBe(0.05);
    expect(criterion.value).toBe(flakes / failures);
    expect(criterion.status).toBe(status);
  });
});
