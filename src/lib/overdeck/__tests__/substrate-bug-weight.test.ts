import type { FlywheelStats, FlywheelStatsCriterion } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';
import { computeSubstrateBugWeight, CRITERION_META } from '../substrate-bug-weight.js';

function criterion(overrides: Partial<FlywheelStatsCriterion> = {}): FlywheelStatsCriterion {
  return {
    label: 'Default criterion',
    value: 0,
    target: 1,
    status: 'green',
    sampleSize: 10,
    dataSufficient: true,
    ...overrides,
  };
}

function stats(overrides: Partial<FlywheelStats['criteria']> = {}): FlywheelStats {
  return {
    window: '30d',
    generatedAt: '2026-07-07T00:00:00.000Z',
    criteria: {
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.01,
        target: 0.02,
      }),
      c2_p0Bugs: criterion({
        label: 'Critical/P0 substrate bugs',
        value: 0,
        target: 0,
      }),
      c3_passRate: criterion({
        label: 'Pipeline pass success rate',
        value: 0.99,
        target: 0.99,
      }),
      c4_mttr: criterion({
        label: 'MTTR for filed substrate bugs',
        value: { medianMs: 3_600_000, p95Ms: 86_400_000 },
        target: { medianMs: 86_400_000, p95Ms: 604_800_000 },
      }),
      c5_intervention: criterion({
        label: 'Operator intervention rate',
        value: 0.01,
        target: 0.05,
      }),
      c6_timeConsistency: criterion({
        label: 'Time-in-pipeline consistency',
        value: {
          simple: { medianMs: 10, p95Ms: 20, ratio: 2 },
          medium: { medianMs: 10, p95Ms: 35, ratio: 3.5 },
          complex: { medianMs: 10, p95Ms: 18, ratio: 1.8 },
        },
        target: { maxRatio: 2 },
      }),
      c7_flake: criterion({
        label: 'Verification flake rate',
        value: 0.01,
        target: 0.05,
      }),
      ...overrides,
    },
  };
}

describe('computeSubstrateBugWeight', () => {
  it('maps every v1 criterion to its stats key, direction, and compound value field', () => {
    expect(CRITERION_META).toEqual({
      1: { key: 'c1_bugRate', direction: 'lower' },
      2: { key: 'c2_p0Bugs', direction: 'zero' },
      3: { key: 'c3_passRate', direction: 'higher' },
      4: { key: 'c4_mttr', direction: 'lower', valueField: 'medianMs' },
      5: { key: 'c5_intervention', direction: 'lower' },
      6: { key: 'c6_timeConsistency', direction: 'lower', valueField: 'ratio' },
      7: { key: 'c7_flake', direction: 'lower' },
    });
  });

  it('returns weight 4.8 for a red criterion 1 at 0.032 vs target 0.02', () => {
    expect(computeSubstrateBugWeight([1], stats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.032,
        target: 0.02,
        status: 'red',
      }),
    }))).toMatchObject({
      weight: 4.8,
    });
  });

  it('weights a red criterion above a green criterion with larger raw but non-failing drift', () => {
    const red = computeSubstrateBugWeight([1], stats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.021,
        target: 0.02,
        status: 'red',
      }),
    }));
    const green = computeSubstrateBugWeight([7], stats({
      c7_flake: criterion({
        label: 'Verification flake rate',
        value: 0,
        target: 0.9,
        status: 'green',
      }),
    }));

    expect(red.weight).toBeGreaterThan(green.weight);
  });

  it('reads c4 medianMs from compound values and falls back to status floor when the value field is absent', () => {
    const compound = computeSubstrateBugWeight([4], stats({
      c4_mttr: criterion({
        label: 'MTTR for filed substrate bugs',
        value: { medianMs: 172_800_000, p95Ms: 604_800_000 },
        target: { medianMs: 86_400_000, p95Ms: 604_800_000 },
        status: 'red',
      }),
    }));
    const absentField = computeSubstrateBugWeight([4], stats({
      c4_mttr: criterion({
        label: 'MTTR for filed substrate bugs',
        value: { p95Ms: 604_800_000 },
        target: { medianMs: 86_400_000, p95Ms: 604_800_000 },
        status: 'red',
      }),
    }));

    expect(Number.isFinite(compound.weight)).toBe(true);
    expect(compound.weight).toBe(6);
    expect(absentField.weight).toBe(3);
  });

  it('normalizes criterion 6 from the highest bucket ratio vs target.maxRatio', () => {
    const red = computeSubstrateBugWeight([6], stats({
      c6_timeConsistency: criterion({
        label: 'Time-in-pipeline consistency',
        value: {
          simple: { medianMs: 10, p95Ms: 20, ratio: 2 },
          medium: { medianMs: 10, p95Ms: 35, ratio: 3.5 },
          complex: { medianMs: 10, p95Ms: 18, ratio: 1.8 },
        },
        target: { maxRatio: 2 },
        status: 'red',
      }),
    }));
    const green = computeSubstrateBugWeight([6], stats({
      c6_timeConsistency: criterion({
        label: 'Time-in-pipeline consistency',
        value: {
          simple: { medianMs: 10, p95Ms: 20, ratio: 1.5 },
          medium: { medianMs: 10, p95Ms: 15, ratio: 1.4 },
          complex: { medianMs: 10, p95Ms: 18, ratio: 1.6 },
        },
        target: { maxRatio: 2 },
        status: 'green',
      }),
    }));

    expect(red.weight).toBeGreaterThan(green.weight);
    expect(red.weight).toBe(5.25);
  });

  it('returns zero and an insufficient telemetry reason when every affected criterion has insufficient data', () => {
    const result = computeSubstrateBugWeight([1, 3], stats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0,
        target: 0.02,
        status: 'insufficient_data',
        dataSufficient: false,
      }),
      c3_passRate: criterion({
        label: 'Pipeline pass success rate',
        value: 0,
        target: 0.99,
        status: 'insufficient_data',
        dataSufficient: false,
      }),
    }));

    expect(result.weight).toBe(0);
    expect(result.reason).toContain('insufficient telemetry');
  });

  it('names the highest contributing criterion with label, status, and value-vs-target', () => {
    const result = computeSubstrateBugWeight([1, 5], stats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.032,
        target: 0.02,
        status: 'red',
      }),
      c5_intervention: criterion({
        label: 'Operator intervention rate',
        value: 0.075,
        target: 0.05,
        status: 'yellow',
      }),
    }));

    expect(result.reason).toContain('criterion 1');
    expect(result.reason).toContain('substrate-bug discovery rate');
    expect(result.reason).toContain('red');
    expect(result.reason).toContain('0.032 vs target <0.02');
  });

  it('returns zero when no criteria are declared', () => {
    expect(computeSubstrateBugWeight([], stats())).toEqual({
      weight: 0,
      reason: 'no affected criteria declared',
    });
  });
});
