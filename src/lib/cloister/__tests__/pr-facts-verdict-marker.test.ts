/**
 * `pr-facts` reads the verdict marker back (PAN-3917 follow-up).
 *
 * The marker is the only verdict a single-account install can record, so the
 * merge-ready set and the rework delivery both depend on these mappings.
 */
import { describe, it, expect } from 'vitest';

import { getPrFacts, parseVerdictMarker, resetPrFactsCache } from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'a7b64f7c0000000000000000000000000000abcd';
const HEAD_AT = '2026-09-19T10:00:00Z';

function prFixture(overrides: Partial<IssuePullRequestData> = {}): IssuePullRequestData {
  return {
    number: 3933,
    title: 'PAN-3705',
    url: 'https://github.com/eltmon/overdeck/pull/3933',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-3705',
    headRefOid: HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-09-19T09:00:00Z',
    updatedAt: HEAD_AT,
    reviewDecision: null,
    reviewRequests: [],
    statusCheckRollup: [],
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    labels: [],
    mergeable: 'MERGEABLE',
    body: '',
    commits: [{ oid: HEAD, committedDate: HEAD_AT }],
    ...overrides,
  };
}

async function factsFor(pr: IssuePullRequestData) {
  resetPrFactsCache();
  return getPrFacts('PAN-3705', {
    fetchGitHubPr: async () => ({ issueId: 'PAN-3705', pr }),
  });
}

describe('parseVerdictMarker', () => {
  it('reads the marker off the first line only', () => {
    expect(parseVerdictMarker('<!-- overdeck-verdict: APPROVED -->\n\nbody')).toBe('APPROVED');
    expect(parseVerdictMarker('<!-- overdeck-verdict: CHANGES_REQUESTED -->')).toBe('CHANGES_REQUESTED');
    expect(parseVerdictMarker('prose\n<!-- overdeck-verdict: APPROVED -->')).toBeNull();
    expect(parseVerdictMarker('just a comment')).toBeNull();
    expect(parseVerdictMarker(undefined)).toBeNull();
  });
});

describe('getPrFacts — verdict marker mapping', () => {
  it('maps a fresh APPROVED marker onto approved', async () => {
    const facts = await factsFor(prFixture({
      comments: [{ body: '<!-- overdeck-verdict: APPROVED -->\n\n**review verdict: passed**', createdAt: '2026-09-19T10:05:00Z' }],
    }));
    expect(facts.reviewDecision).toBe('APPROVED');
    expect(facts.approved).toBe(true);
    expect(facts.changesRequested).toBe(false);
  });

  it('maps a CHANGES_REQUESTED marker onto changesRequested', async () => {
    const facts = await factsFor(prFixture({
      comments: [{ body: '<!-- overdeck-verdict: CHANGES_REQUESTED -->\n\ntwo findings', createdAt: '2026-09-19T10:05:00Z' }],
    }));
    expect(facts.reviewDecision).toBe('CHANGES_REQUESTED');
    expect(facts.changesRequested).toBe(true);
    expect(facts.approved).toBe(false);
  });

  it('ignores an APPROVED marker older than the head commit', async () => {
    const facts = await factsFor(prFixture({
      reviewDecision: 'REVIEW_REQUIRED',
      comments: [{ body: '<!-- overdeck-verdict: APPROVED -->\n\nlgtm', createdAt: '2026-09-19T09:30:00Z' }],
    }));
    expect(facts.approved).toBe(false);
    expect(facts.reviewDecision).toBe('REVIEW_REQUIRED');
  });

  it('still honours a CHANGES_REQUESTED marker older than the head commit', async () => {
    const facts = await factsFor(prFixture({
      comments: [{ body: '<!-- overdeck-verdict: CHANGES_REQUESTED -->\n\nfix this', createdAt: '2026-09-19T09:30:00Z' }],
    }));
    expect(facts.changesRequested).toBe(true);
  });

  it('takes the newest marker comment', async () => {
    const facts = await factsFor(prFixture({
      comments: [
        { body: '<!-- overdeck-verdict: CHANGES_REQUESTED -->\n\nround 1', createdAt: '2026-09-19T10:01:00Z' },
        { body: 'unrelated chatter', createdAt: '2026-09-19T10:02:00Z' },
        { body: '<!-- overdeck-verdict: APPROVED -->\n\nround 2', createdAt: '2026-09-19T10:03:00Z' },
      ],
    }));
    expect(facts.approved).toBe(true);
  });

  it('lets a real forge review decision win over the marker', async () => {
    const facts = await factsFor(prFixture({
      reviewDecision: 'CHANGES_REQUESTED',
      comments: [{ body: '<!-- overdeck-verdict: APPROVED -->', createdAt: '2026-09-19T10:05:00Z' }],
    }));
    expect(facts.reviewDecision).toBe('CHANGES_REQUESTED');
    expect(facts.approved).toBe(false);
  });

  it('is unchanged when the PR carries no comments at all', async () => {
    const facts = await factsFor(prFixture({ reviewDecision: 'REVIEW_REQUIRED' }));
    expect(facts.reviewDecision).toBe('REVIEW_REQUIRED');
    expect(facts.approved).toBe(false);
    expect(facts.changesRequested).toBe(false);
  });
});
