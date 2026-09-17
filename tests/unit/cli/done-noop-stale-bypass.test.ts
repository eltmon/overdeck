/**
 * PR #3872 finding 1 — pan done's no-op skip must bypass stale reviews: the
 * reviewStaleSince marker exists to force a re-review, so a stale row proceeds
 * to persistDoneReviewIntent (which clears the marker on durable write).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/pan-dir/record.js', () => ({
  appendSessionEntrySync: vi.fn(),
  getProjectConfigFromWorkspacePath: vi.fn(),
  readIssueRecordSync: vi.fn(),
  readRecordContinueViewSync: vi.fn(),
  resolveProjectForIssue: vi.fn(() => null),
  writeRecordDecisionsSync: vi.fn(),
  writeRecordScopeDriftSync: vi.fn(),
}));

import { shouldSkipReReviewAsNoop } from '../../../src/cli/commands/done.js';

describe('shouldSkipReReviewAsNoop (PR #3872 finding 1)', () => {
  it('a passed review with an anchor and no stale marker takes the no-op path', () => {
    expect(shouldSkipReReviewAsNoop({
      reviewStatus: 'passed',
      reviewedAtCommit: 'a'.repeat(40),
    })).toBe(true);
  });

  it('a stale passed review does NOT take the no-op path — it re-reviews', () => {
    expect(shouldSkipReReviewAsNoop({
      reviewStatus: 'passed',
      reviewedAtCommit: 'a'.repeat(40),
      reviewStaleSince: '2026-09-17T00:00:00.000Z',
    })).toBe(false);
  });

  it('non-passed or anchorless rows never take the no-op path', () => {
    expect(shouldSkipReReviewAsNoop({ reviewStatus: 'blocked', reviewedAtCommit: 'x' })).toBe(false);
    expect(shouldSkipReReviewAsNoop({ reviewStatus: 'passed' })).toBe(false);
    expect(shouldSkipReReviewAsNoop(null)).toBe(false);
  });
});
