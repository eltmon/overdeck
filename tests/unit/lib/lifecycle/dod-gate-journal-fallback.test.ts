import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';

const mocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  isTrackerIssueClosed: vi.fn(),
  getReviewStatus: vi.fn(),
  readIssueRecord: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  getProjectConfigFromWorkspacePath: vi.fn(),
  listRunningAgents: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
  isTrackerIssueClosed: mocks.isTrackerIssueClosed,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatus: mocks.getReviewStatus,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>();
  return {
    ...actual,
    readIssueRecord: mocks.readIssueRecord,
    resolveProjectForIssue: mocks.resolveProjectForIssue,
    getProjectConfigFromWorkspacePath: mocks.getProjectConfigFromWorkspacePath,
  };
});

vi.mock('../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn(() => Effect.succeed([])),
}));

import { checkPostMergeRow } from '../../../../src/lib/lifecycle/dod-gate.js';

const issueId = 'PAN-3025';
const projectPath = '/tmp/test-project';
const ctx = {
  issueId,
  projectPath,
  github: { owner: 'eltmon', repo: 'overdeck', number: 3025 },
};

describe('DoD row 5 (post-merge) journal fallback for mergeStatus (PAN-3025)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectForIssue.mockReturnValue(null);
    mocks.getProjectConfigFromWorkspacePath.mockReturnValue({ name: 'test', path: projectPath });
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
  });

  it('ac1: live absent + journal merged → pass (journal fallback read)', async () => {
    // Live status absent; journal has mergeStatus: merged → row passes via journal read
    mocks.getReviewStatus.mockReturnValue(Effect.succeed(null));
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: { mergeStatus: 'merged' } as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);

    const row = await checkPostMergeRow(ctx);

    expect(row.status).toBe('pass');
    expect(row.observed).toContain('mergeStatus: merged');
    // Verify journal was read (because live was absent)
    expect(mocks.readIssueRecord).toHaveBeenCalled();
  });

  it('ac2: live merged → pass (live precedence, no journal read)', async () => {
    // Live status shows merged → row passes without reading journal
    mocks.getReviewStatus.mockReturnValue(Effect.succeed({
      mergeStatus: 'merged',
    } as ReviewStatus));
    mocks.readIssueRecord.mockResolvedValue(null); // Should not be called

    const row = await checkPostMergeRow(ctx);

    expect(row.status).toBe('pass');
    // Verify journal was NOT called because live has the answer
    expect(mocks.readIssueRecord).not.toHaveBeenCalled();
  });

  it('ac3: live absent + journal missing → miss', async () => {
    // Live status absent; journal has no mergeStatus → row misses
    mocks.getReviewStatus.mockReturnValue(Effect.succeed(null));
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: {} as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);

    const row = await checkPostMergeRow(ctx);

    expect(row.status).toBe('miss');
    expect(row.observed).toContain('missing');
  });
});
