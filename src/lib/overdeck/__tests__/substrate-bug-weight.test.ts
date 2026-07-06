import { describe, it, expect } from 'vitest';
import { computeSubstrateBugWeight, CRITERION_META } from '../substrate-bug-weight.js';
import type { FlywheelStats, FlywheelStatsCriterion } from '@overdeck/contracts';

function criterion(
  label: string,
  value: unknown,
  target: unknown,
  status: FlywheelStatsCriterion['status'],
): FlywheelStatsCriterion {
  return {
    label,
    value: value as FlywheelStatsCriterion['value'],
    target: target as FlywheelStatsCriterion['target'],
    status,
    sampleSize: 10,
    dataSufficient: status !== 'insufficient_data',
  };
}

function stats(partial: Partial<FlywheelStats['criteria']>): FlywheelStats {
  return {
    window: '30d',
    generatedAt: new Date().toISOString(),
    criteria: {
      c1_bugRate: criterion('Substrate-bug discovery rate', 0, 0.02, 'green'),
      c2_p0Bugs: criterion('Critical/P0 substrate bugs', 0, 0, 'green'),
      c3_passRate: criterion('Pipeline pass success rate', 1, 0.995, 'green'),
      c4_mttr: criterion('MTTR for filed substrate bugs', { medianMs: 0, p95Ms: 0 }, { medianMs: 86400000, p95Ms: 604800000 }, 'green'),
      c5_intervention: criterion('Operator intervention rate', 0, 0.05, 'green'),
      c6_timeConsistency: criterion('Time-in-pipeline consistency', { simple: { medianMs: 0, p95Ms: 0, ratio: 1 }, medium: { medianMs: 0, p95Ms: 0, ratio: 1 }, complex: { medianMs: 0, p95Ms: 0, ratio: 1 } }, { maxRatio: 2 }, 'green'),
      c7_flake: criterion('Flake rate', 0, 0.05, 'green'),
      ...partial,
    },
  };
}

describe('CRITERION_META', () => {
  it('covers all seven criteria', () => {
    expect(Object.keys(CRITERION_META).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });
});

describe('computeSubstrateBugWeight', () => {
  it('returns weight 4.8 for a red c1 with value 0.032 vs target 0.02', () => {
    const s = stats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
    });
    const result = computeSubstrateBugWeight([1], s);
    expect(result.weight).toBe(4.8);
    expect(result.reason).toContain('criterion 1');
    expect(result.reason).toContain('Substrate-bug discovery rate');
    expect(result.reason).toContain('red');
  });

  it('weights a single red criterion higher than a green criterion with larger raw drift', () => {
    const redStats = stats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
    });
    const greenStats = stats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.1, 0.02, 'green'),
    });
    const redWeight = computeSubstrateBugWeight([1], redStats).weight;
    const greenWeight = computeSubstrateBugWeight([1], greenStats).weight;
    expect(redWeight).toBeGreaterThan(greenWeight);
  });

  it('returns a finite weight for c4 with compound value by reading medianMs', () => {
    const s = stats({
      c4_mttr: criterion('MTTR for filed substrate bugs', { medianMs: 172800000, p95Ms: 432000000 }, { medianMs: 86400000, p95Ms: 604800000 }, 'red'),
    });
    const result = computeSubstrateBugWeight([4], s);
    expect(Number.isFinite(result.weight)).toBe(true);
    expect(result.weight).toBeGreaterThan(0);
  });

  it('uses status floor when configured valueField is absent', () => {
    // c6 value is a record of buckets; valueField 'ratio' is absent at the top level,
    // so normalizedDistance is 0 and contribution should equal the red floor (3 * 1 = 3).
    const s = stats({
      c6_timeConsistency: criterion('Time-in-pipeline consistency', { simple: { medianMs: 0, p95Ms: 0, ratio: 1 } }, { maxRatio: 2 }, 'red'),
    });
    const result = computeSubstrateBugWeight([6], s);
    expect(Number.isFinite(result.weight)).toBe(true);
    expect(result.weight).toBe(3);
  });

  it('returns weight 0 and insufficient-telemetry reason for only insufficient_data criteria', () => {
    const s = stats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0, 0.02, 'insufficient_data'),
    });
    const result = computeSubstrateBugWeight([1], s);
    expect(result.weight).toBe(0);
    expect(result.reason).toContain('insufficient telemetry');
  });

  it('reason names the highest-contributing criterion by label, status, and value-vs-target', () => {
    const s = stats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
      c3_passRate: criterion('Pipeline pass success rate', 0.985, 0.995, 'yellow'),
    });
    const result = computeSubstrateBugWeight([1, 3], s);
    expect(result.reason).toContain('criterion 1');
    expect(result.reason).toContain('Substrate-bug discovery rate');
    expect(result.reason).toContain('red');
    expect(result.reason).toContain('3.2%');
    expect(result.reason).toContain('<2.0%');
  });

  it('handles empty criteria', () => {
    const result = computeSubstrateBugWeight([], stats({}));
    expect(result).toEqual({ weight: 0, reason: 'no affected criteria declared' });
  });

  it('handles c2 absolute-count path', () => {
    const s = stats({
      c2_p0Bugs: criterion('Critical/P0 substrate bugs', 3, 0, 'red'),
    });
    const result = computeSubstrateBugWeight([2], s);
    // distance = value = 3; contribution = 3 * (1 + 3) = 12
    expect(result.weight).toBe(12);
  });

  it('handles c3 higher-is-better direction', () => {
    const s = stats({
      c3_passRate: criterion('Pipeline pass success rate', 0.985, 0.995, 'yellow'),
    });
    const result = computeSubstrateBugWeight([3], s);
    // distance = (0.995 - 0.985) / 0.995 ≈ 0.01005; contribution = 2 * (0.5 + 0.01005) ≈ 1.02
    expect(result.weight).toBeCloseTo(1.02, 2);
  });
});
