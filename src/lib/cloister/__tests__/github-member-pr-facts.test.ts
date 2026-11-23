/**
 * `readGitHubMemberPrFacts` reads one GitHub member PR by URL under the same
 * marker trust rules `pr-facts` applies everywhere else (PAN-5638).
 */
import { describe, it, expect, vi } from 'vitest';

// PAN-5153: an uncovered repository (not injected), so a marker counts from
// any trusted author without a real installation lookup.
vi.mock('../../github-app-installations.js', () => ({
  appCoversRepo: async () => false,
}));

import { readGitHubMemberPrFacts, readGitHubMemberReadyFacts } from '../github-member-pr-facts.js';
import type { PrFacts } from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'a7b64f7c0000000000000000000000000000abcd';
const HEAD_AT = '2026-11-23T10:00:00Z';
const URL = 'https://github.com/mindyournow/myn-skills/pull/4';

function prFixture(overrides: Partial<IssuePullRequestData> = {}): IssuePullRequestData {
  return {
    number: 4,
    title: 'MIN-1142',
    url: URL,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/min-1142',
    headRefOid: HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-11-23T09:00:00Z',
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

describe('readGitHubMemberPrFacts', () => {
  it('reads the PR by owner, repo and number from its URL', async () => {
    const fetchPr = vi.fn(async () => ({ issueId: 'MIN-1142', pr: prFixture() }));
    await readGitHubMemberPrFacts('MIN-1142', URL, { fetchPr });
    expect(fetchPr).toHaveBeenCalledWith('MIN-1142', 'mindyournow/myn-skills', 4);
  });

  it('counts a trusted APPROVED marker posted after the head commit', async () => {
    const fetchPr = async () => ({
      issueId: 'MIN-1142',
      pr: prFixture({
        comments: [{
          authorAssociation: 'OWNER',
          body: '<!-- overdeck-verdict: APPROVED -->\n\nok',
          createdAt: '2026-11-23T10:05:00Z',
        }],
      }),
    });
    const facts = await readGitHubMemberPrFacts('MIN-1142', URL, { fetchPr, isAppConfigured: () => false });
    expect(facts.forge).toBe('github');
    expect(facts.approved).toBe(true);
  });

  it('ignores an APPROVED marker from an untrusted commenter', async () => {
    const fetchPr = async () => ({
      issueId: 'MIN-1142',
      pr: prFixture({
        comments: [{
          author: { login: 'drive-by' },
          authorAssociation: 'NONE',
          body: '<!-- overdeck-verdict: APPROVED -->\n\nlgtm',
          createdAt: '2026-11-23T10:05:00Z',
        }],
      }),
    });
    const facts = await readGitHubMemberPrFacts('MIN-1142', URL, { fetchPr });
    expect(facts.approved).toBe(false);
  });

  it('drops an APPROVED marker older than the head commit', async () => {
    const fetchPr = async () => ({
      issueId: 'MIN-1142',
      pr: prFixture({
        comments: [{
          authorAssociation: 'OWNER',
          body: '<!-- overdeck-verdict: APPROVED -->\n\nstale',
          createdAt: '2026-11-23T09:30:00Z',
        }],
      }),
    });
    const facts = await readGitHubMemberPrFacts('MIN-1142', URL, { fetchPr });
    expect(facts.approved).toBe(false);
  });

  it('returns error facts for an unparseable URL or a failed read, and never throws', async () => {
    const unparseable = await readGitHubMemberPrFacts('MIN-1142', 'https://example.com/not-a-pr');
    expect(unparseable.error).toBeTruthy();
    expect(unparseable.exists).toBe(false);

    const rejected = await readGitHubMemberPrFacts('MIN-1142', URL, {
      fetchPr: async () => { throw new Error('gh: timeout'); },
    });
    expect(rejected.error).toBeTruthy();
    expect(rejected.exists).toBe(false);

    const prNull = await readGitHubMemberPrFacts('MIN-1142', URL, {
      fetchPr: async () => ({ issueId: 'MIN-1142', pr: null, error: 'gh pr view failed' }),
    });
    expect(prNull.error).toBeTruthy();
    expect(prNull.exists).toBe(false);
  });
});

describe('readGitHubMemberReadyFacts', () => {
  function unapprovedFetchPr() {
    return async () => ({ issueId: 'MIN-1142', pr: prFixture() });
  }

  it('folds a standing review at head into approved when standingApproval resolves true', async () => {
    const standingApproval = vi.fn(async (_facts: PrFacts) => true);
    const facts = await readGitHubMemberReadyFacts('MIN-1142', URL, { fetchPr: unapprovedFetchPr(), standingApproval });
    expect(facts.approved).toBe(true);
    expect(standingApproval).toHaveBeenCalledTimes(1);
  });

  it('leaves approved false when standingApproval resolves undefined', async () => {
    const standingApproval = vi.fn(async (_facts: PrFacts) => undefined);
    const facts = await readGitHubMemberReadyFacts('MIN-1142', URL, { fetchPr: unapprovedFetchPr(), standingApproval });
    expect(facts.approved).toBe(false);
  });

  it('does not call standingApproval when a marker already approves', async () => {
    const standingApproval = vi.fn(async (_facts: PrFacts) => true);
    const fetchPr = async () => ({
      issueId: 'MIN-1142',
      pr: prFixture({
        comments: [{
          authorAssociation: 'OWNER',
          body: '<!-- overdeck-verdict: APPROVED -->\n\nok',
          createdAt: '2026-11-23T10:05:00Z',
        }],
      }),
    });
    const facts = await readGitHubMemberReadyFacts('MIN-1142', URL, { fetchPr, standingApproval });
    expect(facts.approved).toBe(true);
    expect(standingApproval).not.toHaveBeenCalled();
  });
});
