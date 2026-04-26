import { describe, it, expect } from 'vitest';
import { extractReviewerRole } from '../../../../../src/dashboard/server/routes/mission-control.ts';

describe('extractReviewerRole', () => {
  it('extracts role from standard review session name', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-correctness', 'PAN-821');
    expect(result).toBe('correctness');
  });

  it('extracts role for security reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-security', 'PAN-821');
    expect(result).toBe('security');
  });

  it('extracts role for performance reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-performance', 'PAN-821');
    expect(result).toBe('performance');
  });

  it('extracts role for requirements reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-requirements', 'PAN-821');
    expect(result).toBe('requirements');
  });

  it('extracts role for synthesis reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-synthesis', 'PAN-821');
    expect(result).toBe('synthesis');
  });

  it('returns null for session without role suffix', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890', 'PAN-821');
    expect(result).toBeNull();
  });

  it('returns null for non-review session name', () => {
    const result = extractReviewerRole('agent-pan-821', 'PAN-821');
    expect(result).toBeNull();
  });

  it('returns null for coordinator session', () => {
    const result = extractReviewerRole('review-coordinator-PAN-821-1745567890', 'PAN-821');
    expect(result).toBeNull();
  });

  it('is case-insensitive for issueId matching', () => {
    const result = extractReviewerRole('review-pan-821-1745567890-correctness', 'PAN-821');
    expect(result).toBe('correctness');
  });

  it('returns null for empty role after timestamp', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-', 'PAN-821');
    expect(result).toBeNull();
  });
});
