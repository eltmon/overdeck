import { describe, it, expect } from 'vitest';
import {
  getReviewerSessionName,
  parseReviewerSessionName,
  REVIEWER_ROLES,
  type ReviewerRole,
} from '../specialists.js';

describe('getReviewerSessionName (PAN-1048+)', () => {
  it('produces agent-* format for correctness reviewer', () => {
    expect(getReviewerSessionName('correctness', 'panopticon', 'PAN-540')).toBe(
      'agent-pan-540-review-correctness',
    );
  });

  it('produces agent-* format for all five reviewer roles', () => {
    for (const role of REVIEWER_ROLES) {
      expect(getReviewerSessionName(role, 'panopticon', 'PAN-830')).toBe(
        `agent-pan-830-review-${role}`,
      );
    }
  });

  it('handles issue ids with hyphens', () => {
    expect(getReviewerSessionName('security', 'my-proj', 'pan-830')).toBe(
      'agent-pan-830-review-security',
    );
  });
});

describe('parseReviewerSessionName (PAN-1048+)', () => {
  it('parses current agent-* format', () => {
    expect(parseReviewerSessionName('agent-PAN-540-review-correctness')).toEqual({
      role: 'correctness',
      issueId: 'PAN-540',
    });
  });

  it('round-trips agent-* format for every reviewer role', () => {
    for (const role of REVIEWER_ROLES) {
      const name = getReviewerSessionName(role as ReviewerRole, 'panopticon', 'PAN-830');
      const parsed = parseReviewerSessionName(name);
      expect(parsed?.role).toBe(role);
      expect(parsed?.issueId).toBe('PAN-830');
    }
  });

  it('parses legacy specialist-* format for backward compatibility', () => {
    expect(parseReviewerSessionName('specialist-panopticon-PAN-540-review-correctness')).toEqual({
      role: 'correctness',
      issueId: 'PAN-540',
    });
  });

  it('returns null for non-reviewer specialist names (e.g. work-agent)', () => {
    expect(parseReviewerSessionName('specialist-panopticon-PAN-540-work-agent')).toBeNull();
  });

  it('returns null for legacy timestamp-based reviewer names', () => {
    expect(
      parseReviewerSessionName('review-PAN-540-1714000000-correctness'),
    ).toBeNull();
  });

  it('returns null for unknown reviewer roles', () => {
    expect(
      parseReviewerSessionName('specialist-panopticon-PAN-540-review-bogus'),
    ).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseReviewerSessionName('')).toBeNull();
  });
});
