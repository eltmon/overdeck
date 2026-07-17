import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingCommand } from '../../../src/cli/commands/pending.js';
import { getAllReviewStatusesFromDb } from '../../../src/lib/overdeck/review-status-sync.js';
import { gatherProjectLensSignalsForProjects } from '../../../src/lib/pipeline-membership-gather.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

vi.mock('../../../src/lib/overdeck/review-status-sync.js', () => ({
  getAllReviewStatusesFromDb: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgentsSync: vi.fn(() => []),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjectsSync: vi.fn(() => [{
    key: 'overdeck',
    config: { name: 'overdeck', path: '/project', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' },
  }]),
}));

vi.mock('../../../src/lib/pipeline-membership-gather.js', () => ({
  gatherProjectLensSignalsForProjects: vi.fn(),
}));

const getStatuses = vi.mocked(getAllReviewStatusesFromDb);
const gatherProjects = vi.mocked(gatherProjectLensSignalsForProjects);

function signal(issueId: string, overrides: Record<string, unknown> = {}) {
  return {
    issueId,
    issueOpen: true,
    hasOpenPr: true,
    hasMergedPr: false,
    hasConventionBranch: true,
    branchUnmerged: true,
    phaseLabel: 'in-review',
    hasVbriefSpec: true,
    explicitlyReady: false,
    ...overrides,
  };
}

function status(issueId: string, overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId,
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: '2026-06-14T00:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

function output(logSpy: ReturnType<typeof vi.spyOn>): string {
  return logSpy.mock.calls.map(args => args.join(' ')).join('\n');
}

describe('pendingCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getStatuses.mockReturnValue({});
    gatherProjects.mockResolvedValue([{
      project: { name: 'overdeck', path: '/project' },
      signals: [signal('PAN-1'), signal('PAN-2'), signal('PAN-3')],
    }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists pending reviews by default', async () => {
    getStatuses.mockReturnValue({
      'PAN-1': status('PAN-1', { reviewRequestedAt: '2026-06-14T00:00:00.000Z' }),
      'PAN-2': status('PAN-2', { reviewStatus: 'passed' }),
      'PAN-3': status('PAN-3'),
    });

    await pendingCommand();

    expect(output(logSpy)).toContain('Pending Reviews');
    expect(output(logSpy)).toContain('PAN-1');
    expect(output(logSpy)).not.toContain('PAN-2');
    expect(output(logSpy)).not.toContain('PAN-3');
  });

  it('lists ready-for-merge issues from SQLite', async () => {
    getStatuses.mockReturnValue({
      'PAN-1': status('PAN-1', { reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true, prUrl: 'https://example.test/pr/1' }),
      'PAN-2': status('PAN-2', { reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true, mergeStatus: 'merged' }),
    });

    await pendingCommand({ ready: true });

    expect(output(logSpy)).toContain('Ready for Merge');
    expect(output(logSpy)).toContain('PAN-1');
    expect(output(logSpy)).toContain('https://example.test/pr/1');
    expect(output(logSpy)).not.toContain('PAN-2');
  });

  it('lists blocked issues with blocker kind from SQLite', async () => {
    getStatuses.mockReturnValue({
      'PAN-1': status('PAN-1', {
        reviewStatus: 'passed',
        testStatus: 'passed',
        blockerReasons: [{ type: 'merge_conflict', summary: 'Conflict', detectedAt: '2026-06-14T00:00:00.000Z' }],
      }),
      'PAN-2': status('PAN-2', { testStatus: 'dispatch_failed' }),
      'PAN-3': status('PAN-3', { reviewStatus: 'passed', testStatus: 'passed' }),
    });

    await pendingCommand({ blocked: true });

    expect(output(logSpy)).toContain('Blocked Reviews / Tests / Merges');
    expect(output(logSpy)).toContain('PAN-1  merge_conflict');
    expect(output(logSpy)).toContain('PAN-2  test=dispatch_failed');
    expect(output(logSpy)).not.toContain('PAN-3');
  });

  it('prints resolver membership and drift when review status is empty', async () => {
    gatherProjects.mockResolvedValue([{
      project: { name: 'overdeck', path: '/project' },
      signals: [signal('PAN-10', { hasOpenPr: false, hasMergedPr: true, hasConventionBranch: false, branchUnmerged: false, phaseLabel: null })],
    }]);

    await pendingCommand();

    expect(output(logSpy)).toContain('Pipeline Membership');
    expect(output(logSpy)).toContain('PAN-10  post_merge_limbo');
    expect(output(logSpy)).toContain('open issue with a merged PR');
    expect(output(logSpy)).toContain('No pending reviews.');
  });

  it('keeps ready and blocked filters within the resolver membership set', async () => {
    gatherProjects.mockResolvedValue([{
      project: { name: 'overdeck', path: '/project' }, signals: [signal('PAN-1')],
    }]);
    getStatuses.mockReturnValue({
      'PAN-1': status('PAN-1', { readyForMerge: true, testStatus: 'failed' }),
      'PAN-2': status('PAN-2', { readyForMerge: true, testStatus: 'failed' }),
    });

    await pendingCommand({ ready: true });
    expect(output(logSpy)).toContain('PAN-1');
    expect(output(logSpy)).not.toContain('PAN-2');

    logSpy.mockClear();
    await pendingCommand({ blocked: true });
    expect(output(logSpy)).toContain('PAN-1');
    expect(output(logSpy)).not.toContain('PAN-2');
  });
});
