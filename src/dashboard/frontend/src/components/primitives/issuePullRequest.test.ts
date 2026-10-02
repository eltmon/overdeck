import { describe, expect, it } from 'vitest';
import type { DerivedPrState } from '@overdeck/contracts';
import { pullRequestBadgeLabel, pullRequestBadgeTone } from './PullRequestBadge';
import { issuePullRequestBadgeLink } from './issuePullRequest';

const OPEN_PR: DerivedPrState = {
  url: 'https://github.com/eltmon/overdeck/pull/4460',
  number: 4460,
  reviewState: 'review-requested',
  checks: 'red',
  mergeable: true,
};

describe('issuePullRequestBadgeLink', () => {
  it('returns null for an undefined PR', () => {
    expect(issuePullRequestBadgeLink(undefined)).toBeNull();
  });

  it('returns null when the url is not a PR url', () => {
    const pr: DerivedPrState = { ...OPEN_PR, url: 'https://github.com/eltmon/overdeck/issues/4460' };
    expect(issuePullRequestBadgeLink(pr)).toBeNull();
  });

  it('builds an open PR badge link with warning tone and a checks/review label', () => {
    const link = issuePullRequestBadgeLink(OPEN_PR);
    expect(link).not.toBeNull();
    expect(link?.repository).toBe('eltmon/overdeck');
    expect(link?.snapshot?.state).toBe('open');
    expect(pullRequestBadgeTone(link!)).toBe('warning');
    const label = pullRequestBadgeLabel(link!);
    expect(label).toContain('checks failing');
    expect(label).toContain('review requested');
  });

  it('builds a merged PR badge link with success tone and a merged label', () => {
    const merged: DerivedPrState = { ...OPEN_PR, merged: true };
    const link = issuePullRequestBadgeLink(merged);
    expect(link).not.toBeNull();
    expect(pullRequestBadgeTone(link!)).toBe('success');
    expect(pullRequestBadgeLabel(link!)).toBe('eltmon/overdeck #4460 · merged · checks failing · review requested');
  });

  it('takes draft/title from a matching resourcePrs entry', () => {
    const link = issuePullRequestBadgeLink(OPEN_PR, [{ number: 4460, title: 'Fix the thing', isDraft: true }]);
    expect(link?.snapshot?.isDraft).toBe(true);
    expect(link?.snapshot?.title).toBe('Fix the thing');
  });

  it('ignores a resourcePrs entry whose number differs', () => {
    const link = issuePullRequestBadgeLink(OPEN_PR, [{ number: 1, title: 'Other', isDraft: true }]);
    expect(link?.snapshot?.isDraft).toBe(false);
    expect(link?.snapshot?.title).toBe('');
  });

  it('includes "checks passing" and "approved" in the label for green checks and an approved review', () => {
    const pr: DerivedPrState = { ...OPEN_PR, checks: 'green', reviewState: 'approved' };
    const link = issuePullRequestBadgeLink(pr);
    const label = pullRequestBadgeLabel(link!);
    expect(label).toContain('checks passing');
    expect(label).toContain('approved');
  });

  it('omits the review part when reviewState is none', () => {
    const pr: DerivedPrState = { ...OPEN_PR, reviewState: 'none' };
    const link = issuePullRequestBadgeLink(pr);
    const label = pullRequestBadgeLabel(link!);
    expect(label).not.toContain('review');
  });
});
