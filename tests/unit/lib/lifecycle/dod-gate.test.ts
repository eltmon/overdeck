import { describe, expect, it } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';
import {
  checkReviewRow,
  checkTestsRow,
  checkVerificationRow,
  type DodStatusRowDeps,
} from '../../../../src/lib/lifecycle/dod-gate.js';

const issueId = 'PAN-2715';

function live(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    lastVerifiedCommit: 'abc123',
    updatedAt: '2026-07-15T00:00:00Z',
    readyForMerge: true,
    ...overrides,
  };
}

function journal(overrides: Partial<PanIssuePipelineRecord> = {}): PanIssuePipelineRecord {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    readyForMerge: true,
    updatedAt: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function deps(status: ReviewStatus | null, pipeline: PanIssuePipelineRecord | null = null): DodStatusRowDeps {
  return { getReviewStatus: () => status, getJournalStatus: () => pipeline };
}

describe('Definition-of-Done status rows', () => {
  it('passes live review, test, and verified-commit verdicts', () => {
    const source = deps(live());
    expect(checkReviewRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'reviewStatus: passed' });
    expect(checkTestsRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'testStatus: passed' });
    expect(checkVerificationRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'verificationStatus: passed at abc123' });
  });

  it('treats skipped verdicts as policy-approved passes', () => {
    const source = deps(live({ reviewStatus: 'skipped', testStatus: 'skipped', verificationStatus: 'skipped' }));
    for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('skipped per issue policy');
    }
  });

  it('reports the actual non-passing verdict', () => {
    const source = deps(live({ reviewStatus: 'failed', testStatus: 'pending', verificationStatus: 'failed' }));
    expect(checkReviewRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'reviewStatus: failed' });
    expect(checkTestsRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'testStatus: pending' });
    expect(checkVerificationRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'verificationStatus: failed at abc123' });
  });

  it('requires a commit for a passed live verification verdict', () => {
    expect(checkVerificationRow(issueId, deps(live({ lastVerifiedCommit: undefined })))).toMatchObject({
      status: 'miss',
      observed: 'verificationStatus: passed',
    });
  });

  it('falls back to durable pipeline journal verdicts after live status is cleared', () => {
    const source = deps(null, journal());
    for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('from pipeline journal');
    }
  });

  it('returns misses instead of throwing when both sources are empty or a door fails', () => {
    const empty = deps(null);
    const failing: DodStatusRowDeps = {
      getReviewStatus: () => { throw new Error('database unavailable'); },
      getJournalStatus: () => { throw new Error('journal unavailable'); },
    };
    for (const source of [empty, failing]) {
      for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
        expect(row).toMatchObject({ status: 'miss', observed: 'no review status or journal record found' });
      }
    }
  });
});
