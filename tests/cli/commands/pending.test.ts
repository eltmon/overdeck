import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingCommand } from '../../../src/cli/commands/pending.js';
import { getAllReviewStatusesFromDb } from '../../../src/lib/overdeck/review-status-sync.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

vi.mock('../../../src/lib/overdeck/review-status-sync.js', () => ({
  getAllReviewStatusesFromDb: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgentsSync: vi.fn(() => []),
}));

const getStatuses = vi.mocked(getAllReviewStatusesFromDb);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists pending reviews by default', async () => {
    getStatuses.mockReturnValue({
      'PAN-1': status('PAN-1'),
      'PAN-2': status('PAN-2', { reviewStatus: 'passed' }),
    });

    await pendingCommand();

    expect(output(logSpy)).toContain('Pending Reviews');
    expect(output(logSpy)).toContain('PAN-1');
    expect(output(logSpy)).not.toContain('PAN-2');
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
});
