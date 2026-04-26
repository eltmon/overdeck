import { describe, it, expect } from 'vitest';
import {
  getReviewerSessionName,
  parseReviewerSessionName,
  REVIEWER_ROLES,
  type ReviewerRole,
} from '../specialists.js';

describe('getReviewerSessionName (PAN-830)', () => {
  it('produces canonical name for correctness reviewer', () => {
    expect(getReviewerSessionName('correctness', 'panopticon', '540')).toBe(
      'specialist-panopticon-540-review-correctness',
    );
  });

  it('produces canonical names for all five reviewer roles', () => {
    for (const role of REVIEWER_ROLES) {
      expect(getReviewerSessionName(role, 'panopticon', '830')).toBe(
        `specialist-panopticon-830-review-${role}`,
      );
    }
  });

  it('handles project keys and issue ids with hyphens', () => {
    expect(getReviewerSessionName('security', 'my-proj', 'pan-830')).toBe(
      'specialist-my-proj-pan-830-review-security',
    );
  });
});

describe('parseReviewerSessionName (PAN-830)', () => {
  it('round-trips a canonical name back to its components', () => {
    const name = getReviewerSessionName('synthesis', 'panopticon', '540');
    expect(parseReviewerSessionName(name)).toEqual({
      role: 'synthesis',
      projectKey: 'panopticon',
      issueId: '540',
    });
  });

  it('round-trips for every reviewer role', () => {
    const project = 'panopticon';
    const issue = 'pan-830';
    for (const role of REVIEWER_ROLES) {
      const name = getReviewerSessionName(role as ReviewerRole, project, issue);
      const parsed = parseReviewerSessionName(name);
      expect(parsed?.role).toBe(role);
      expect(parsed?.projectKey).toBe(project);
      expect(parsed?.issueId).toBe(issue);
    }
  });

  it('returns null for non-reviewer specialist names (e.g. work-agent)', () => {
    expect(parseReviewerSessionName('specialist-panopticon-540-work-agent')).toBeNull();
  });

  it('returns null for legacy timestamp-based reviewer names', () => {
    expect(
      parseReviewerSessionName('review-540-1714000000-correctness'),
    ).toBeNull();
  });

  it('returns null for unknown reviewer roles', () => {
    expect(
      parseReviewerSessionName('specialist-panopticon-540-review-bogus'),
    ).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseReviewerSessionName('')).toBeNull();
  });
});
