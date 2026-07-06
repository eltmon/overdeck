import { describe, it, expect } from 'vitest';
import {
  listSubstrateBugWeights,
  type WeightedSubstrateBug,
} from '../substrate-bug-weights-service.js';
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
    sampleSize: status === 'insufficient_data' ? 0 : 10,
    dataSufficient: status !== 'insufficient_data',
  };
}

function makeStats(partial: Partial<FlywheelStats['criteria']>): FlywheelStats {
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

function bug(issueId: string, overrides: Partial<Omit<WeightedSubstrateBug, 'affectedCriteria' | 'weight' | 'weightReason'>> = {}): {
  issueId: string;
  filedAt: string;
  runId: string | null;
  filedBy: 'agent' | 'operator';
  discoveredInIssueId: string | null;
  severity: string;
  status: 'open' | 'fixed';
  fixMergedAt: string | null;
  fixCommitSha: string | null;
  updatedAt: string;
} {
  return {
    issueId,
    filedAt: new Date().toISOString(),
    runId: null,
    filedBy: 'agent',
    discoveredInIssueId: null,
    severity: 'P1',
    status: 'open',
    fixMergedAt: null,
    fixCommitSha: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('listSubstrateBugWeights', () => {
  it('returns weighted rows sorted by weight descending', async () => {
    const stats = makeStats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
      c3_passRate: criterion('Pipeline pass success rate', 0.985, 0.995, 'yellow'),
    });
    const bodies: Record<string, { body: string; labels: string[] }> = {
      'PAN-100': { body: 'Flywheel-Affects-Criterion: 1', labels: [] },
      'PAN-101': { body: 'Flywheel-Affects-Criterion: 3', labels: [] },
    };

    const result = await listSubstrateBugWeights('30d', {
      now: () => new Date('2026-07-06T00:00:00Z'),
      computeStats: async () => stats,
      listBugs: () => [bug('PAN-100'), bug('PAN-101')],
      fetchBodyAndLabels: async (id) => bodies[id] ?? { body: null, labels: [] },
    });

    expect(result).toHaveLength(2);
    expect(result[0].issueId).toBe('PAN-100');
    expect(result[0].weight).toBe(4.8);
    expect(result[1].issueId).toBe('PAN-101');
    expect(result[1].weight).toBeGreaterThan(0);
    expect(result[1].weight).toBeLessThan(result[0].weight);
  });

  it('exposes the required WeightedSubstrateBug fields', async () => {
    const stats = makeStats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
    });

    const result = await listSubstrateBugWeights('30d', {
      now: () => new Date('2026-07-06T00:00:00Z'),
      computeStats: async () => stats,
      listBugs: () => [bug('PAN-100', { severity: 'P0', filedBy: 'operator' })],
      fetchBodyAndLabels: async () => ({ body: 'Flywheel-Affects-Criterion: 1', labels: ['affects-criterion-2'] }),
    });

    expect(result[0]).toEqual({
      issueId: 'PAN-100',
      severity: 'P0',
      filedBy: 'operator',
      affectedCriteria: [1, 2],
      weight: expect.any(Number),
      weightReason: expect.any(String),
    });
  });

  it('returns weight 0 and insufficient-telemetry reason when stats lack telemetry', async () => {
    const stats = makeStats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0, 0.02, 'insufficient_data'),
      c2_p0Bugs: criterion('Critical/P0 substrate bugs', 0, 0, 'insufficient_data'),
      c3_passRate: criterion('Pipeline pass success rate', 0, 0.995, 'insufficient_data'),
      c4_mttr: criterion('MTTR for filed substrate bugs', { medianMs: 0, p95Ms: 0 }, { medianMs: 86400000, p95Ms: 604800000 }, 'insufficient_data'),
      c5_intervention: criterion('Operator intervention rate', 0, 0.05, 'insufficient_data'),
      c6_timeConsistency: criterion('Time-in-pipeline consistency', { simple: { medianMs: 0, p95Ms: 0, ratio: 1 }, medium: { medianMs: 0, p95Ms: 0, ratio: 1 }, complex: { medianMs: 0, p95Ms: 0, ratio: 1 } }, { maxRatio: 2 }, 'insufficient_data'),
      c7_flake: criterion('Flake rate', 0, 0.05, 'insufficient_data'),
    });

    const result = await listSubstrateBugWeights('30d', {
      now: () => new Date('2026-07-06T00:00:00Z'),
      computeStats: async () => stats,
      listBugs: () => [bug('PAN-100'), bug('PAN-101')],
      fetchBodyAndLabels: async () => ({ body: 'Flywheel-Affects-Criterion: 1', labels: [] }),
    });

    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(row.weight).toBe(0);
      expect(row.weightReason).toContain('insufficient telemetry');
    }
  });

  it('sorts ties by issueId ascending', async () => {
    const stats = makeStats({
      c1_bugRate: criterion('Substrate-bug discovery rate', 0.032, 0.02, 'red'),
    });

    const result = await listSubstrateBugWeights('30d', {
      now: () => new Date('2026-07-06T00:00:00Z'),
      computeStats: async () => stats,
      listBugs: () => [bug('PAN-B'), bug('PAN-A')],
      fetchBodyAndLabels: async () => ({ body: 'Flywheel-Affects-Criterion: 1', labels: [] }),
    });

    expect(result[0].issueId).toBe('PAN-A');
    expect(result[1].issueId).toBe('PAN-B');
  });
});
