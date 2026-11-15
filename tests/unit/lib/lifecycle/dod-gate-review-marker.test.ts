/**
 * Row 1 (`review`) accepts the same comment-posted approval the merge gate
 * accepts: a trusted `overdeck-verdict: APPROVED` comment naming the PR head,
 * read through `getPrFacts` (PAN-5401).
 */
import { describe, expect, it, vi } from 'vitest';

// PAN-5153: no installation lookup runs for these fixtures; none of them need it.
vi.mock('../../../../src/lib/github-app-installations.js', () => ({
  appCoversRepo: async () => false,
}));

import { emptyPrFacts, getPrFacts, type PrFacts } from '../../../../src/lib/cloister/pr-facts.js';
import type { IssuePullRequestData } from '../../../../src/lib/overdeck/pull-requests.js';
import {
  checkReviewRow,
  type DodStatusRowDeps,
  type TerminalVerdictSettlement,
} from '../../../../src/lib/lifecycle/dod-gate.js';

const issueId = 'OKF-11';
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** The real merge-gate reader, with the trust lookups injected (NFR-4). */
function readReviewFactsFromPr(id: string, pr: IssuePullRequestData): Promise<PrFacts> {
  return getPrFacts(id, {
    fetchGitHubPr: async () => ({ issueId: id, pr }),
    isAppConfigured: () => false,
  });
}

function pr(overrides: Partial<IssuePullRequestData> = {}): IssuePullRequestData {
  return {
    number: 12,
    title: 'OKF-11',
    url: 'https://github.com/eltmon/okf/pull/12',
    state: 'MERGED',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/okf-11',
    headRefOid: HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-11-15T20:00:00Z',
    updatedAt: '2026-11-15T20:39:17Z',
    reviewDecision: '',
    reviewRequests: [],
    statusCheckRollup: [],
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    labels: [],
    mergeable: 'MERGEABLE',
    body: '',
    commits: [{ oid: HEAD, committedDate: '2026-11-15T20:37:06Z' }],
    ...overrides,
  } as IssuePullRequestData;
}

function approvedComment(sha: string, createdAt = '2026-11-15T20:39:17Z') {
  return {
    authorAssociation: 'OWNER',
    author: { login: 'eltmon' },
    createdAt,
    body: `<!-- overdeck-verdict: APPROVED sha=${sha} -->\n\nreview verdict: passed`,
  };
}

function changesRequestedComment(sha: string, createdAt = '2026-11-15T20:39:17Z') {
  return {
    authorAssociation: 'OWNER',
    author: { login: 'eltmon' },
    createdAt,
    body: `<!-- overdeck-verdict: CHANGES_REQUESTED sha=${sha} -->`,
  };
}

const SETTLEMENT: TerminalVerdictSettlement = { trackerClosed: true, landedWork: true, mainVerifyStatus: 'pass' };

describe('Row 1 — comment-posted verdict evidence (PAN-5401)', () => {
  it('T1: passes when reviewDecision is empty and a trusted APPROVED comment names the head', async () => {
    const source: DodStatusRowDeps = {
      readPullRequest: () => pr({ comments: [approvedComment(HEAD)] }),
      readVerification: () => null,
      readReviewFacts: readReviewFactsFromPr,
    };
    const row = await checkReviewRow(issueId, source);
    expect(row).toMatchObject({
      status: 'pass',
      observed: `PR #12 reviewDecision: none; Overdeck verdict comment approved head ${HEAD.slice(0, 12)}`,
    });
  });

  it('T2: misses when the APPROVED comment names another commit', async () => {
    const source: DodStatusRowDeps = {
      readPullRequest: () => pr({ comments: [approvedComment(OTHER)] }),
      readVerification: () => null,
      readReviewFacts: readReviewFactsFromPr,
    };
    const row = await checkReviewRow(issueId, source);
    expect(row).toMatchObject({ status: 'miss', observed: 'PR #12 reviewDecision: none' });
  });

  it('T3: never reads PR facts when no comment carries a verdict marker', async () => {
    const readReviewFacts = vi.fn();
    for (const comments of [[], [{ body: 'looks good' }]]) {
      const row = await checkReviewRow(issueId, {
        readPullRequest: () => pr({ comments }),
        readVerification: () => null,
        readReviewFacts,
      });
      expect(row).toMatchObject({ status: 'miss' });
    }
    expect(readReviewFacts).not.toHaveBeenCalled();
  });

  it('T4: a forge decision never triggers the comment read', async () => {
    const readReviewFacts = vi.fn();
    const approvedRow = await checkReviewRow(issueId, {
      readPullRequest: () => pr({ reviewDecision: 'APPROVED' }),
      readVerification: () => null,
      readReviewFacts,
    });
    expect(approvedRow).toMatchObject({ status: 'pass', observed: 'PR #12 reviewDecision: APPROVED' });

    const rejectedRow = await checkReviewRow(issueId, {
      readPullRequest: () => pr({ reviewDecision: 'CHANGES_REQUESTED', comments: [approvedComment(HEAD)] }),
      readVerification: () => null,
      readReviewFacts,
    });
    expect(rejectedRow).toMatchObject({ status: 'miss', observed: 'PR #12 reviewDecision: CHANGES_REQUESTED' });

    expect(readReviewFacts).not.toHaveBeenCalled();
  });

  it('T5: a failed verdict read reports the error and falls through', async () => {
    const prWithMarker = pr({ comments: [approvedComment(HEAD)] });

    const emptyFactsRow = await checkReviewRow(issueId, {
      readPullRequest: () => prWithMarker,
      readVerification: () => null,
      readReviewFacts: async id => emptyPrFacts(id, 'boom'),
    });
    expect(emptyFactsRow).toMatchObject({
      status: 'miss',
      observed: 'PR #12 reviewDecision: none; review verdict comment unreadable: boom',
    });

    const throwingRow = await checkReviewRow(issueId, {
      readPullRequest: () => prWithMarker,
      readVerification: () => null,
      readReviewFacts: async () => { throw new Error('gh down'); },
    });
    expect(throwingRow).toMatchObject({
      status: 'miss',
      observed: 'PR #12 reviewDecision: none; review verdict comment unreadable: gh down',
    });

    const strikeRow = await checkReviewRow(
      issueId,
      {
        readPullRequest: () => prWithMarker,
        readVerification: () => null,
        readReviewFacts: async () => { throw new Error('gh down'); },
      },
      undefined,
      { strikeLanded: true },
    );
    expect(strikeRow).toMatchObject({ status: 'skip' });
  });

  it('T6: a trusted CHANGES_REQUESTED-only verdict comment misses row 1 even when settlement applies', async () => {
    const row = await checkReviewRow(
      issueId,
      {
        readPullRequest: () => pr({ comments: [changesRequestedComment(HEAD)] }),
        readVerification: () => null,
        readReviewFacts: readReviewFactsFromPr,
      },
      SETTLEMENT,
    );
    expect(row).toMatchObject({
      status: 'miss',
      observed: 'PR #12 reviewDecision: none; Overdeck verdict comment requested changes',
    });
  });

  it('T7: a CHANGES_REQUESTED comment posted after an APPROVED comment misses row 1', async () => {
    const row = await checkReviewRow(
      issueId,
      {
        readPullRequest: () => pr({
          comments: [
            approvedComment(HEAD, '2026-11-15T20:39:17Z'),
            changesRequestedComment(HEAD, '2026-11-15T20:45:00Z'),
          ],
        }),
        readVerification: () => null,
        readReviewFacts: readReviewFactsFromPr,
      },
      SETTLEMENT,
    );
    expect(row).toMatchObject({
      status: 'miss',
      observed: 'PR #12 reviewDecision: none; Overdeck verdict comment requested changes',
    });
  });

  it('T8: the strike path does not skip a CHANGES_REQUESTED verdict comment', async () => {
    const row = await checkReviewRow(
      issueId,
      {
        readPullRequest: () => pr({ comments: [changesRequestedComment(HEAD)] }),
        readVerification: () => null,
        readReviewFacts: readReviewFactsFromPr,
      },
      undefined,
      { strikeLanded: true },
    );
    expect(row).toMatchObject({ status: 'miss' });
  });

  it('T9: an APPROVED comment after an older CHANGES_REQUESTED comment still passes (the real OKF-11 order)', async () => {
    const row = await checkReviewRow(issueId, {
      readPullRequest: () => pr({
        comments: [
          changesRequestedComment(OTHER, '2026-11-15T20:34:07Z'),
          approvedComment(HEAD, '2026-11-15T20:39:17Z'),
        ],
      }),
      readVerification: () => null,
      readReviewFacts: readReviewFactsFromPr,
    });
    expect(row).toMatchObject({ status: 'pass' });
  });
});
