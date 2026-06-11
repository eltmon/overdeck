import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStats, FlywheelStatsCriterion } from '@panctl/contracts';
import type { FlywheelSubstrateBug } from '../../../../lib/database/flywheel-substrate-bugs-db.js';

const serviceMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('node:child_process', async (importActual) => ({
  ...(await importActual<typeof import('node:child_process')>()),
  execFile: serviceMocks.execFile,
}));

vi.mock('../../../../lib/tracker-utils.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../../lib/tracker-utils.js')>()),
  resolveGitHubIssueSync: serviceMocks.resolveGitHubIssueSync,
}));

import { computeFlywheelSubstrateBugWeights, fetchGitHubIssueDetails } from '../flywheel-bug-weights.js';

const generatedAt = new Date('2026-06-06T00:00:00.000Z');

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function criterion(overrides: Partial<FlywheelStatsCriterion> = {}): FlywheelStatsCriterion {
  return {
    label: 'criterion',
    value: 0,
    target: 1,
    status: 'green',
    sampleSize: 10,
    dataSufficient: true,
    ...overrides,
  };
}

function stats(): FlywheelStats {
  return {
    window: '30d',
    generatedAt: generatedAt.toISOString(),
    criteria: {
      c1_bugRate: criterion({ label: 'Substrate-bug discovery rate', value: 0.03, target: 0.02, status: 'red' }),
      c2_p0Bugs: criterion({ label: 'Critical/P0 substrate bugs', value: 0, target: 0 }),
      c3_passRate: criterion({ label: 'Pipeline pass success rate', value: 1, target: 0.99 }),
      c4_mttr: criterion({ label: 'MTTR for filed substrate bugs', value: { medianMs: 0, p95Ms: 0 }, target: { medianMs: 86_400_000, p95Ms: 604_800_000 } }),
      c5_intervention: criterion({ label: 'Operator intervention rate', value: 0, target: 0.05 }),
      c6_timeConsistency: criterion({ label: 'Time-in-pipeline consistency', value: { simple: { ratio: 1 }, medium: { ratio: 1 }, complex: { ratio: 1 } }, target: { maxRatio: 2 } }),
      c7_flake: criterion({ label: 'Substrate-attributable flake rate', value: 0, target: 0.05 }),
    },
  };
}

function bug(issueId: string): FlywheelSubstrateBug {
  return {
    issueId,
    filedAt: '2026-06-01T00:00:00.000Z',
    runId: null,
    filedBy: 'agent',
    discoveredInIssueId: null,
    severity: 'P2',
    status: 'open',
    fixMergedAt: null,
    fixCommitSha: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchGitHubIssueDetails', () => {
  it('fetches issue details from the issue id prefix repo', async () => {
    serviceMocks.resolveGitHubIssueSync.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'krux',
      prefix: 'KRUX',
      number: 3,
    });
    serviceMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as ExecFileCallback;
      callback(null, {
        stdout: JSON.stringify({ body: 'Flywheel-Affects-Criterion: 1', labels: [{ name: 'affects-criterion-7' }] }),
        stderr: '',
      });
    });

    const result = await fetchGitHubIssueDetails('KRUX-3');

    expect(result).toEqual({ body: 'Flywheel-Affects-Criterion: 1', labels: ['affects-criterion-7'] });
    expect(serviceMocks.execFile).toHaveBeenCalledWith('gh', [
      'issue',
      'view',
      '3',
      '--repo',
      'eltmon/krux',
      '--json',
      'body,labels',
    ], expect.objectContaining({ cwd: process.cwd(), maxBuffer: 1024 * 1024 }), expect.any(Function));
  });
});

describe('computeFlywheelSubstrateBugWeights', () => {
  it('bounds concurrent issue detail fetches', async () => {
    let active = 0;
    let maxActive = 0;

    const result = await computeFlywheelSubstrateBugWeights('30d', {
      now: () => generatedAt,
      listBugs: () => Array.from({ length: 12 }, (_, index) => bug(`PAN-${index + 1}`)),
      computeStats: async () => stats(),
      fetchIssueDetails: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return { body: '', labels: ['affects-criterion-1'] };
      },
    });

    expect(result.weights).toHaveLength(12);
    expect(maxActive).toBeLessThanOrEqual(5);
  });
});
