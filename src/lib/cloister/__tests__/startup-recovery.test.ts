import { describe, it, expect } from 'vitest';
import { identifyOrphanedReviewingIssues, parseSpecialistAgentSession } from '../service.js';

describe('parseSpecialistAgentSession', () => {
  it('parses issue-scoped specialist sessions', () => {
    expect(parseSpecialistAgentSession('specialist-panopticon-cli-PAN-714-review-agent')).toEqual({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-714',
      specialistType: 'review-agent',
    });
  });

  it('parses legacy project-scoped specialist sessions', () => {
    expect(parseSpecialistAgentSession('specialist-panopticon-cli-review-agent')).toEqual({
      projectKey: 'panopticon-cli',
      specialistType: 'review-agent',
    });
  });

  it('returns null for non-specialist sessions', () => {
    expect(parseSpecialistAgentSession('agent-pan-714')).toBeNull();
  });
});

describe('identifyOrphanedReviewingIssues', () => {
  it('returns empty array when no statuses exist', () => {
    expect(identifyOrphanedReviewingIssues({}, new Set())).toEqual([]);
  });

  it('ignores issues not in reviewing state', () => {
    const statuses = {
      'PAN-1': { reviewStatus: 'pending' },
      'PAN-2': { reviewStatus: 'passed' },
      'PAN-3': { reviewStatus: 'failed' },
    };
    expect(identifyOrphanedReviewingIssues(statuses, new Set())).toEqual([]);
  });

  it('returns issues with reviewStatus=reviewing', () => {
    const statuses = {
      'PAN-10': { reviewStatus: 'reviewing' },
      'PAN-11': { reviewStatus: 'pending' },
    };
    expect(identifyOrphanedReviewingIssues(statuses, new Set())).toEqual(['PAN-10']);
  });

  it('excludes issues that have a passed review in history', () => {
    const statuses = {
      'PAN-20': {
        reviewStatus: 'reviewing',
        history: [{ type: 'review', status: 'passed' }],
      },
      'PAN-21': {
        reviewStatus: 'reviewing',
        history: [{ type: 'review', status: 'failed' }],
      },
    };
    // PAN-20 has a passed review — not orphaned; PAN-21 has only a failed review — orphaned
    expect(identifyOrphanedReviewingIssues(statuses, new Set())).toEqual(['PAN-21']);
  });

  it('excludes issues actively being reviewed (case-insensitive)', () => {
    const statuses = {
      'PAN-30': { reviewStatus: 'reviewing' },
      'PAN-31': { reviewStatus: 'reviewing' },
    };
    const active = new Set(['PAN-30']); // uppercase match
    expect(identifyOrphanedReviewingIssues(statuses, active)).toEqual(['PAN-31']);
  });

  it('matches active set case-insensitively (lowercase issueId)', () => {
    const statuses = {
      'pan-40': { reviewStatus: 'reviewing' },
    };
    // Active set uses uppercase; issueId is lowercase — should still be excluded
    const active = new Set(['PAN-40']);
    expect(identifyOrphanedReviewingIssues(statuses, active)).toEqual([]);
  });

  it('returns multiple orphaned issues', () => {
    const statuses = {
      'PAN-50': { reviewStatus: 'reviewing' },
      'PAN-51': { reviewStatus: 'reviewing' },
      'PAN-52': { reviewStatus: 'pending' },
    };
    const result = identifyOrphanedReviewingIssues(statuses, new Set());
    expect(result).toHaveLength(2);
    expect(result).toContain('PAN-50');
    expect(result).toContain('PAN-51');
  });

  it('ignores non-review history entries when determining passed state', () => {
    const statuses = {
      'PAN-60': {
        reviewStatus: 'reviewing',
        history: [
          { type: 'test', status: 'passed' },
          { type: 'verification', status: 'passed' },
        ],
      },
    };
    // Only review history counts — test/verification passed doesn't protect from orphan detection
    expect(identifyOrphanedReviewingIssues(statuses, new Set())).toEqual(['PAN-60']);
  });
});
