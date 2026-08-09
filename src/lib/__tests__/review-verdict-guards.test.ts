import { describe, expect, it } from 'vitest';
import { rejectVerdictEvidenceHeadMismatch } from '../review-verdict-guards.js';

function status(overrides: Record<string, unknown> = {}) {
  return {
    lastVerifiedCommit: 'a'.repeat(40),
    reviewedAtCommit: 'a'.repeat(40),
    ...overrides,
  };
}

describe('rejectVerdictEvidenceHeadMismatch', () => {
  describe('REVIEW arm retired', () => {
    it('Given a terminal review update carrying a reviewedAtCommit that differs from status.lastVerifiedCommit, rejectVerdictEvidenceHeadMismatch returns false and never invokes onReject', () => {
      let called = false;
      const onReject = () => {
        called = true;
      };

      const update = {
        reviewStatus: 'passed',
        reviewedAtCommit: 'b'.repeat(40),
      };

      const result = rejectVerdictEvidenceHeadMismatch('PAN-3512', status(), update, onReject);

      expect(result).toBe(false);
      expect(called).toBe(false);
    });

    it('Given a terminal review update whose only evidence is reviewerVerdicts[*].atCommit differing from status.lastVerifiedCommit, rejectVerdictEvidenceHeadMismatch returns false and never invokes onReject', () => {
      let called = false;
      const onReject = () => {
        called = true;
      };

      const update = {
        reviewStatus: 'passed',
        reviewerVerdicts: {
          reviewer1: { atCommit: 'c'.repeat(40) },
        },
      };

      const result = rejectVerdictEvidenceHeadMismatch('PAN-3512', status(), update, onReject);

      expect(result).toBe(false);
      expect(called).toBe(false);
    });
  });

  describe('TEST arm survives', () => {
    it('Given a terminal test update whose lastVerifiedCommit differs from status.reviewedAtCommit, rejectVerdictEvidenceHeadMismatch still returns true and still invokes onReject exactly once', () => {
      let onRejectCalls = 0;
      const onReject = () => {
        onRejectCalls++;
      };

      const update = {
        testStatus: 'passed',
        lastVerifiedCommit: 'b'.repeat(40),
      };

      const result = rejectVerdictEvidenceHeadMismatch('PAN-3512', status(), update, onReject);

      expect(result).toBe(true);
      expect(onRejectCalls).toBe(1);
    });
  });
});
