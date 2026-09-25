/**
 * The one merge gate (#4016, #4021, #4036): forge facts judged against the
 * project's test mode and the issue's UAT requirement, read at call time.
 */
import { describe, expect, it, vi } from 'vitest';

import { defaultUatRequired, evaluateIssueMergeGate } from '../merge-gate.js';
import { getMergeReadyIssues } from '../merge-ready-set.js';
import { emptyPrFacts, getPrFacts, resetPrFactsCache, type GitHubReviewsAtHead, type PrFacts } from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'dddd444400000000000000000000000000000000';

function readyFacts(issueId: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts(issueId),
    forge: 'github',
    exists: true,
    open: true,
    headSha: HEAD,
    headBranch: `feature/${issueId.toLowerCase()}`,
    reviewDecision: 'APPROVED',
    approved: true,
    approvedAtHead: true,
    mergeable: true,
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
    ...overrides,
  };
}

describe('evaluateIssueMergeGate', () => {
  it('requires the CI test job only for a verification.tests: ci project (#4021)', async () => {
    const facts = readyFacts('PAN-1', { testChecks: 'none', testJobSucceeded: false });

    const ciMode = await evaluateIssueMergeGate('PAN-1', {
      getFacts: async () => facts,
      ciTestsRequired: () => true,
    });
    expect(ciMode.ready).toBe(false);
    expect(ciMode.reason).toContain('no CI test job reported');

    const localMode = await evaluateIssueMergeGate('PAN-1', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
    });
    expect(localMode.ready).toBe(true);
  });

  it('blocks a failed UAT at the head only when UAT is required (#4036)', async () => {
    const facts = readyFacts('PAN-2', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } });

    const held = await evaluateIssueMergeGate('PAN-2', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
      uatRequired: async () => true,
    });
    expect(held).toEqual(expect.objectContaining({ ready: false, reason: `browser UAT failed on PR HEAD ${HEAD}` }));

    const released = await evaluateIssueMergeGate('PAN-2', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
      uatRequired: async () => false,
    });
    expect(released.ready).toBe(true);
  });

  it('reads the UAT requirement only when a failed verdict applies to the head', async () => {
    const uatRequired = vi.fn(async () => true);
    const result = await evaluateIssueMergeGate('PAN-3', {
      getFacts: async () => readyFacts('PAN-3', { uatVerdict: { status: 'passed', sha: HEAD, postedAt: null } }),
      ciTestsRequired: () => false,
      uatRequired,
    });
    expect(result.ready).toBe(true);
    expect(uatRequired).not.toHaveBeenCalled();
  });

  it('holds a failed UAT when the requirement cannot be read', async () => {
    const result = await evaluateIssueMergeGate('PAN-4', {
      getFacts: async () => readyFacts('PAN-4', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } }),
      ciTestsRequired: () => false,
      uatRequired: async () => { throw new Error('tracker unreachable'); },
    });
    expect(result.ready).toBe(false);
  });

  it('holds a failed UAT when the issue labels cannot be read, through the default requirement (#4040 review)', async () => {
    const failedAtHead = readyFacts('PAN-6', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } });
    const unreadable = async (): Promise<string[]> => { throw new Error('gh: rate limited'); };

    // The requirement itself refuses to guess: no silent project/global fallback.
    await expect(defaultUatRequired('PAN-6', {
      getIssueLabels: unreadable, project: { auto_merge_default: 'auto' }, globalRequireUat: false,
    })).rejects.toThrow('rate limited');

    const result = await evaluateIssueMergeGate('PAN-6', {
      getFacts: async () => failedAtHead,
      ciTestsRequired: () => false,
      uatRequired: (issueId) => defaultUatRequired(issueId, {
        getIssueLabels: unreadable, project: { auto_merge_default: 'auto' }, globalRequireUat: false,
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe(`browser UAT failed on PR HEAD ${HEAD}`);
  });

  it('resolves the requirement from the labels when they can be read', async () => {
    await expect(defaultUatRequired('PAN-7', {
      getIssueLabels: async () => ['auto-merge'], project: null, globalRequireUat: true,
    })).resolves.toBe(false);
    await expect(defaultUatRequired('PAN-7', {
      getIssueLabels: async () => ['hold-for-uat'], project: { auto_merge_default: 'auto' }, globalRequireUat: false,
    })).resolves.toBe(true);
  });

  it('passes the strike branch through to the forge read (#4016)', async () => {
    const getFacts = vi.fn(async () => readyFacts('PAN-8', { headBranch: 'strike/pan-8' }));
    await evaluateIssueMergeGate('PAN-8', { getFacts, ciTestsRequired: () => false }, { preferBranch: 'strike/pan-8' });
    expect(getFacts).toHaveBeenCalledWith('PAN-8', { preferBranch: 'strike/pan-8' });
  });

  it('returns the facts it judged, so a strike landing can pin its own PR (#4016)', async () => {
    const result = await evaluateIssueMergeGate('PAN-5', {
      getFacts: async () => readyFacts('PAN-5', { headBranch: 'strike/pan-5', checks: 'red' }),
      ciTestsRequired: () => false,
    });
    expect(result.ready).toBe(false);
    expect(result.facts.headBranch).toBe('strike/pan-5');
  });
});

describe('getMergeReadyIssues through the merge gate', () => {
  it('leaves out an issue the CI test job or a failed required UAT blocks', async () => {
    const facts: Record<string, PrFacts> = {
      'PAN-10': readyFacts('PAN-10'),
      'PAN-11': readyFacts('PAN-11', { testChecks: 'green', testJobSucceeded: false }),
      'PAN-12': readyFacts('PAN-12', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } }),
    };
    const ready = await getMergeReadyIssues({
      listProjects: async () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/p' } as never }],
      gather: async () => [{
        signals: Object.keys(facts).map((issueId) => ({ issueId, hasOpenPr: true, issueOpen: true, phaseLabel: null })),
      }] as never,
      getFacts: async (issueId) => facts[issueId]!,
      ciTestsRequired: () => true,
      uatRequired: async () => true,
    });
    expect(ready).toEqual(['PAN-10']);
  });
});

// #3983: approval for a merge is proven on the exact head, through the real
// `getPrFacts` reading marker comments and GitHub's reviews. `reviewDecision`
// is empty throughout: the repo has no branch protection requiring reviews.
describe('evaluateIssueMergeGate — approval bound to the PR head (#3983)', () => {
  const OLD = 'eeee555500000000000000000000000000000000';
  const HEAD_AT = '2026-09-24T10:00:00Z';

  function pr(overrides: Partial<IssuePullRequestData> = {}): IssuePullRequestData {
    return {
      number: 4066,
      title: 'PAN-3983',
      url: 'https://github.com/eltmon/overdeck/pull/4066',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feature/pan-3983',
      headRefOid: HEAD,
      author: { login: 'eltmon' },
      createdAt: '2026-09-24T09:00:00Z',
      updatedAt: HEAD_AT,
      reviewDecision: '',
      reviewRequests: [],
      statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
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

  const marker = (sha?: string) => ({
    authorAssociation: 'OWNER',
    body: `<!-- overdeck-verdict: APPROVED${sha ? ` sha=${sha}` : ''} -->\n\nlgtm`,
    createdAt: '2026-09-24T10:05:00Z',
  });

  function gate(data: IssuePullRequestData, reviews: GitHubReviewsAtHead = { headRefOid: HEAD, reviews: [] }) {
    const readReviews = vi.fn(async () => reviews);
    const result = evaluateIssueMergeGate('PAN-3983', {
      getFacts: (issueId, options) => {
        resetPrFactsCache();
        return getPrFacts(issueId, { fetchGitHubPr: async () => ({ issueId, pr: data }) }, options);
      },
      ciTestsRequired: () => false,
      readReviews,
    });
    return { result, readReviews };
  }

  it('merges on an approval marker whose sha= is the head, with no reviews read', async () => {
    const { result, readReviews } = gate(pr({ comments: [marker(HEAD)] }));
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: true }));
    expect(readReviews).not.toHaveBeenCalled();
  });

  it('refuses a marker naming an older head, however recent the comment', async () => {
    const { result } = gate(pr({ comments: [marker(OLD)] }));
    const verdict = await result;
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain(`PR is not approved at PR HEAD ${HEAD}`);
  });

  it('refuses a marker without sha=, even one newer than the head commit', async () => {
    const { result } = gate(pr({ comments: [marker()] }));
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: false }));
  });

  it('merges on a GitHub review approving the exact head', async () => {
    const { result, readReviews } = gate(pr(), {
      headRefOid: HEAD,
      reviews: [{ state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: HEAD } }],
    });
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: true }));
    expect(readReviews).toHaveBeenCalledWith('eltmon/overdeck', 4066);
  });

  // #4066 review: the repo is public and has no branch protection, so anyone
  // can submit an APPROVED review. Only a trusted reviewer's review counts.
  it("refuses an untrusted account's APPROVED review of the exact head", async () => {
    const readReviews = vi.fn(async () => ({
      headRefOid: HEAD,
      reviews: [{ state: 'APPROVED', author: { login: 'drive-by' }, authorAssociation: 'NONE', commit: { oid: HEAD } }],
    }));
    const result = await evaluateIssueMergeGate('PAN-3983', {
      getFacts: (issueId, options) => {
        resetPrFactsCache();
        return getPrFacts(issueId, { fetchGitHubPr: async () => ({ issueId, pr: pr() }) }, options);
      },
      ciTestsRequired: () => false,
      readReviews,
      overdeckLogins: async () => ['eltmon'],
    });
    expect(result.ready).toBe(false);
    expect(readReviews).toHaveBeenCalled();
  });

  it("refuses when the approving reviewer's latest review of the head requests changes", async () => {
    const { result } = gate(pr(), {
      headRefOid: HEAD,
      reviews: [
        { state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:00:00Z' },
        { state: 'CHANGES_REQUESTED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:05:00Z' },
      ],
    });
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: false }));
  });

  it('refuses a GitHub review that approved an older commit, even with reviewDecision APPROVED', async () => {
    const { result } = gate(pr({ reviewDecision: 'APPROVED' }), {
      headRefOid: HEAD,
      reviews: [{ state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: OLD } }],
    });
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: false }));
  });

  it('refuses a GitHub head approval when the head moved between the two reads', async () => {
    const { result } = gate(pr(), { headRefOid: OLD, reviews: [{ state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: OLD } }] });
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: false }));
  });

  it('reads no reviews for a PR the gate refuses anyway (red checks)', async () => {
    const { result, readReviews } = gate(pr({
      statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }],
    }));
    await expect(result).resolves.toEqual(expect.objectContaining({ ready: false }));
    expect(readReviews).not.toHaveBeenCalled();
  });

  it('takes a GitLab approval (a named approver, read into `approved`) as proof', async () => {
    const facts = readyFacts('MIN-1', { forge: 'gitlab', approvedAtHead: undefined });
    const result = await evaluateIssueMergeGate('MIN-1', { getFacts: async () => facts, ciTestsRequired: () => false });
    expect(result.ready).toBe(true);
  });
});
