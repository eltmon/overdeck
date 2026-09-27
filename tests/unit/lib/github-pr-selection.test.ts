import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestForHead } from '../../../src/lib/github-app.js';
import { selectPullRequestForHead } from '../../../src/lib/github-pr-selection.js';

describe('selectPullRequestForHead (PAN-4263)', () => {
  const pr = (over: Partial<GitHubPullRequestForHead> & { number: number }): GitHubPullRequestForHead => ({
    state: 'open',
    merged: false,
    mergedAt: null,
    mergeCommit: null,
    updatedAt: null,
    ...over,
  });

  it('prefers an open PR over a newer closed one', () => {
    const prs = [
      pr({ number: 3670, state: 'closed', updatedAt: '2026-09-26T00:00:00Z' }),
      pr({ number: 4251, state: 'open', updatedAt: '2026-09-20T00:00:00Z' }),
    ];
    expect(selectPullRequestForHead(prs, { includeClosed: false })?.number).toBe(4251);
    expect(selectPullRequestForHead(prs, { includeClosed: true })?.number).toBe(4251);
  });

  it('picks the most recently updated of two open PRs', () => {
    const prs = [
      pr({ number: 10, updatedAt: '2026-09-01T00:00:00Z' }),
      pr({ number: 9, updatedAt: '2026-09-02T00:00:00Z' }),
    ];
    expect(selectPullRequestForHead(prs, { includeClosed: false })?.number).toBe(9);
  });

  it('returns null for a merged-only branch when closed PRs are excluded', () => {
    const prs = [pr({ number: 5, state: 'closed', merged: true, mergedAt: '2026-09-01T00:00:00Z' })];
    expect(selectPullRequestForHead(prs, { includeClosed: false })).toBeNull();
  });

  it('ranks merged above closed when closed PRs are included', () => {
    const prs = [
      pr({ number: 7, state: 'closed', updatedAt: '2026-09-10T00:00:00Z' }),
      pr({ number: 6, state: 'closed', merged: true, mergedAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(selectPullRequestForHead(prs, { includeClosed: true })?.number).toBe(6);
  });

  it('picks the most recently updated closed PR when none is open or merged', () => {
    const prs = [
      pr({ number: 7, state: 'closed', updatedAt: '2026-09-10T00:00:00Z' }),
      pr({ number: 8, state: 'closed', updatedAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(selectPullRequestForHead(prs, { includeClosed: true })?.number).toBe(7);
    expect(selectPullRequestForHead([], { includeClosed: true })).toBeNull();
  });
});
