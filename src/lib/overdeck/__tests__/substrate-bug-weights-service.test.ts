import type { FlywheelStats, FlywheelStatsCriterion } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';
import { listSubstrateBugWeights, type WeightedSubstrateBug } from '../substrate-bug-weights-service.js';

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

function makeStats(overrides: Partial<FlywheelStats['criteria']> = {}): FlywheelStats {
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

function makeBug(overrides: Partial<WeightedSubstrateBug> & { affectedCriteria?: number[] } = {}): {
  issueId: string;
  filedAt: string;
  runId: string | null;
  filedBy: 'agent' | 'operator';
  discoveredInIssueId: string | null;
  severity: string;
  status: 'open' | 'fixed';
  affectedCriteria: number[];
  fixMergedAt: string | null;
  fixCommitSha: string | null;
  updatedAt: string;
} {
  return {
    issueId: 'PAN-1',
    filedAt: '2026-07-01T00:00:00.000Z',
    runId: null,
    filedBy: 'agent',
    discoveredInIssueId: null,
    severity: 'P1',
    status: 'open',
    affectedCriteria: [],
    fixMergedAt: null,
    fixCommitSha: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('listSubstrateBugWeights', () => {
  it('returns weighted rows sorted by weight descending', async () => {
    const stats = makeStats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.032,
        target: 0.02,
        status: 'red',
      }),
      c3_passRate: criterion({
        label: 'Pipeline pass success rate',
        value: 0.95,
        target: 0.99,
        status: 'yellow',
      }),
    });

    const bugs = [
      makeBug({
        issueId: 'PAN-HEAVY',
        filedAt: '2026-07-02T00:00:00.000Z',
        affectedCriteria: [1],
      }),
      makeBug({
        issueId: 'PAN-LIGHT',
        filedAt: '2026-07-01T00:00:00.000Z',
        affectedCriteria: [3],
      }),
    ];

    const rows = await listSubstrateBugWeights('30d', {
      stats,
      completedPipelineRuns: 5,
      listBugs: () => bugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(rows.map((r) => r.issueId)).toEqual(['PAN-HEAVY', 'PAN-LIGHT']);
    expect(rows[0].weight).toBeGreaterThan(rows[1].weight);
  });

  it('keeps operator-filed bugs ahead of higher-weight agent-filed bugs', async () => {
    const stats = makeStats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.032,
        target: 0.02,
        status: 'red',
      }),
    });
    const bugs = [
      makeBug({
        issueId: 'PAN-AGENT',
        filedAt: '2026-07-01T00:00:00.000Z',
        filedBy: 'agent',
        affectedCriteria: [1],
      }),
      makeBug({
        issueId: 'PAN-OPERATOR',
        filedAt: '2026-07-03T00:00:00.000Z',
        filedBy: 'operator',
        affectedCriteria: [],
      }),
    ];

    const rows = await listSubstrateBugWeights('30d', {
      stats,
      completedPipelineRuns: 5,
      listBugs: () => bugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(rows.map((row) => row.issueId)).toEqual(['PAN-OPERATOR', 'PAN-AGENT']);
    expect(rows[0].weight).toBeLessThan(rows[1].weight);
  });

  it('exposes required fields on every row', async () => {
    const stats = makeStats();
    const bugs = [
      makeBug({
        issueId: 'PAN-1',
        severity: 'P0',
        filedBy: 'operator',
        affectedCriteria: [2, 3],
      }),
    ];

    const rows = await listSubstrateBugWeights('30d', {
      stats,
      completedPipelineRuns: 10,
      listBugs: () => bugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      issueId: 'PAN-1',
      severity: 'P0',
      filedBy: 'operator',
      affectedCriteria: [2, 3],
      weight: expect.any(Number),
      weightReason: expect.any(String),
    });
  });

  it('returns weight 0 with insufficient-telemetry reason when completed runs < 3', async () => {
    const stats = makeStats({
      c1_bugRate: criterion({
        label: 'Substrate-bug discovery rate',
        value: 0.032,
        target: 0.02,
        status: 'red',
      }),
    });

    const bugs = [
      makeBug({ issueId: 'PAN-A', body: 'Flywheel-Affects-Criterion: 1' }),
      makeBug({ issueId: 'PAN-B', body: 'Flywheel-Affects-Criterion: 1' }),
    ];

    const rows = await listSubstrateBugWeights('30d', {
      stats,
      completedPipelineRuns: 2,
      listBugs: () => bugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.weight).toBe(0);
      expect(row.weightReason).toMatch(/Insufficient telemetry/i);
    }
  });

  it('ties on weight are broken by filedAt ascending', async () => {
    const stats = makeStats();
    const bugs = [
      makeBug({ issueId: 'PAN-LATER', filedAt: '2026-07-03T00:00:00.000Z', body: 'Flywheel-Affects-Criterion: 1' }),
      makeBug({ issueId: 'PAN-EARLIER', filedAt: '2026-07-02T00:00:00.000Z', body: 'Flywheel-Affects-Criterion: 1' }),
    ];

    const rows = await listSubstrateBugWeights('30d', {
      stats,
      completedPipelineRuns: 10,
      listBugs: () => bugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(rows.map((r) => r.issueId)).toEqual(['PAN-EARLIER', 'PAN-LATER']);
  });

  it('clamps oversized windows to 365 days at the service layer', async () => {
    const stats = makeStats();
    const listBugs = vi.fn().mockReturnValue([]);

    await listSubstrateBugWeights('366d', {
      stats,
      completedPipelineRuns: 10,
      listBugs,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(listBugs).toHaveBeenCalledWith(
      new Date('2025-07-07T00:00:00.000Z').toISOString(),
      new Date('2026-07-07T00:00:00.000Z').toISOString(),
    );
  });
});
