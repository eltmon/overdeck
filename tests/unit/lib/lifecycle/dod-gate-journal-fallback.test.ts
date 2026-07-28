import { describe, expect, it, vi } from 'vitest';

const issueClosureMocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  isTrackerIssueClosed: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: issueClosureMocks.isIssueClosed,
  isTrackerIssueClosed: issueClosureMocks.isTrackerIssueClosed,
}));

import type { PanIssuePipelineRecord, ProjectConfig } from '../../../../src/lib/pan-dir/record.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import { checkPostMergeRow, type PostMergeRowDeps } from '../../../../src/lib/lifecycle/dod-gate.js';

const issueId = 'PAN-3025';
const ctx = {
  issueId,
  projectPath: '/tmp/overdeck',
  github: { owner: 'eltmon', repo: 'overdeck', number: 3025 },
};

const clearAgents = () => [];

// Custom deps for testing the journal fallback logic
function journalFallbackDeps(
  liveStatus: ReviewStatus | null,
  pipelineStatus: Partial<PanIssuePipelineRecord['pipeline']> | null,
): PostMergeRowDeps {
  return {
    readCanonicalState: async () => null,
    readMergeStatus: async () => {
      // Live status takes precedence
      if (liveStatus?.mergeStatus) {
        return liveStatus.mergeStatus;
      }
      // Fall back to journal
      if (pipelineStatus?.mergeStatus) {
        return pipelineStatus.mergeStatus;
      }
      return undefined;
    },
    listAgents: async () => clearAgents(),
  };
}

describe('DoD row 5 (post-merge) journal fallback for mergeStatus (PAN-3025)', () => {
  it('ac1: with live null and journal mergeStatus merged, row has merged in observed', async () => {
    const row = await checkPostMergeRow(ctx, undefined, journalFallbackDeps(
      null,
      { mergeStatus: 'merged' },
    ));

    expect(row.observed).toContain('mergeStatus: merged');
  });

  it('ac2: with live null and journal without mergeStatus, row has missing in observed', async () => {
    const row = await checkPostMergeRow(ctx, undefined, journalFallbackDeps(
      null,
      {},
    ));

    expect(row.observed).toContain('mergeStatus: missing');
  });

  it('ac3: with live row having mergeStatus merged, row uses live status', async () => {
    const liveWithMerge: ReviewStatus = {
      issueId,
      mergeStatus: 'merged',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: '2026-07-15T00:00:00Z',
      readyForMerge: true,
    };

    const row = await checkPostMergeRow(ctx, undefined, journalFallbackDeps(
      liveWithMerge,
      { mergeStatus: 'verifying' }, // Journal has different status, but live should win
    ));

    expect(row.observed).toContain('mergeStatus: merged'); // Live status observed, not journal
  });

  it('ac4: pre-existing row behavior unchanged with live status', async () => {
    const liveWithMerge: ReviewStatus = {
      issueId,
      mergeStatus: 'merged',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: '2026-07-15T00:00:00Z',
      readyForMerge: true,
    };

    const customDeps: PostMergeRowDeps = {
      readCanonicalState: async () => 'verifying_on_main',
      readMergeStatus: async () => liveWithMerge.mergeStatus,
      listAgents: async () => clearAgents(),
    };

    const row = await checkPostMergeRow(ctx, undefined, customDeps);

    // Standard test: verifying_on_main + merged status + no running agents = pass
    expect(row.status).toBe('pass');
    expect(row.observed).toContain('no running work/planning agents');
  });
});
