/**
 * #3853: the human-override half of `pan admin specialists done review` is the
 * operator's. A review synthesizer once reversed an approval on an unchanged
 * head and called it an "operator-authorized override".
 *
 * The guard refuses an agent's rejection only on proof that the exact head sha
 * carries an approval. Unknown lets the rejection through: turning a real
 * blocker into a pass is the worse failure.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  forgeApprovalAtHead,
  getPrFacts,
  resetPrFactsCache,
  type GitHubReviewRecord,
  type GitLabMrView,
  type PrFactsDeps,
} from '../pr-facts.js';
import {
  isIssueReviewSession,
  reviewVerdictRefusal,
  verdictCallerFromEnv,
} from '../verdict-caller.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'a7b64f7c0000000000000000000000000000abcd';
const OLDER = '1c36f7db9148c7dd9da6d43cf9884d959e433307';
const HEAD_AT = '2026-09-16T19:00:00Z';

describe('verdictCallerFromEnv', () => {
  it('reads a shell without OVERDECK_AGENT_ID as an operator', () => {
    expect(verdictCallerFromEnv({})).toEqual({ kind: 'operator', id: null });
    expect(verdictCallerFromEnv({ OVERDECK_AGENT_ID: '  ' })).toEqual({ kind: 'operator', id: null });
  });

  it('reads a conv-* conversation as an operator', () => {
    expect(verdictCallerFromEnv({ OVERDECK_AGENT_ID: 'conv-20260916-2706' }))
      .toEqual({ kind: 'operator', id: 'conv-20260916-2706' });
  });

  it('reads every other managed session as an agent', () => {
    for (const id of ['agent-pan-3836-review', 'agent-pan-3836', 'flywheel-overdeck', 'planning-pan-3836']) {
      expect(verdictCallerFromEnv({ OVERDECK_AGENT_ID: id })).toEqual({ kind: 'agent', id });
    }
  });
});

describe('isIssueReviewSession', () => {
  it('matches the review parent and its convoy, for that issue only', () => {
    expect(isIssueReviewSession('agent-pan-3836-review', 'PAN-3836')).toBe(true);
    expect(isIssueReviewSession('agent-pan-3836-review-security', 'PAN-3836')).toBe(true);
    expect(isIssueReviewSession('agent-pan-3836', 'PAN-3836')).toBe(false);
    expect(isIssueReviewSession('agent-pan-3836-reviewer', 'PAN-3836')).toBe(false);
    expect(isIssueReviewSession('agent-pan-38360-review', 'PAN-3836')).toBe(false);
  });
});

describe('reviewVerdictRefusal', () => {
  const synthesizer = { kind: 'agent', id: 'agent-pan-3836-review' } as const;
  const approvedAtHead = { approved: true, approvedAtHead: true, headSha: '9e039c17aaaa' };

  it('refuses the synthesizer reversing an approval proven at head (PAN-3836 cycle 9)', () => {
    const refusal = reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked', facts: approvedAtHead,
    });
    expect(refusal).toContain('cannot reverse an approval on the commit it approved');
    expect(refusal).toContain('9e039c17');
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'failed', facts: approvedAtHead,
    })).not.toBeNull();
  });

  it('never teaches the bypass: the refusal names no operator identity', () => {
    const refusal = reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked', facts: approvedAtHead,
    }) ?? '';
    expect(refusal).not.toMatch(/conv-|OVERDECK_AGENT_ID|operator override/);
  });

  it('lets the rejection through when the approval is not proven at head', () => {
    for (const unproven of [undefined, false] as const) {
      expect(reviewVerdictRefusal({
        caller: synthesizer, issueId: 'PAN-3836', status: 'blocked',
        facts: { approved: true, approvedAtHead: unproven, headSha: HEAD },
      })).toBeNull();
    }
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked',
      facts: { approved: true, headSha: null },
    })).toBeNull();
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked', facts: null,
    })).toBeNull();
  });

  it('lets an operator-requested run block an approved head', () => {
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked', facts: approvedAtHead,
      operatorRequested: true,
    })).toBeNull();
  });

  it('lets the review agent block new commits and approve', () => {
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked',
      facts: { approved: false, headSha: HEAD },
    })).toBeNull();
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'passed', facts: approvedAtHead,
    })).toBeNull();
  });

  it('refuses any other agent session, whatever the verdict', () => {
    for (const id of ['agent-pan-3836', 'flywheel-overdeck', 'agent-pan-9999-review']) {
      expect(reviewVerdictRefusal({
        caller: { kind: 'agent', id }, issueId: 'PAN-3836', status: 'passed', facts: null,
      })).toContain('not PAN-3836\'s review session');
      expect(reviewVerdictRefusal({
        caller: { kind: 'agent', id }, issueId: 'PAN-3836', status: 'blocked', facts: null, operatorRequested: true,
      })).toContain('not PAN-3836\'s review session');
    }
  });

  it('accepts the operator override', () => {
    for (const caller of [{ kind: 'operator', id: null }, { kind: 'operator', id: 'conv-1' }] as const) {
      expect(reviewVerdictRefusal({
        caller, issueId: 'PAN-3836', status: 'blocked', facts: approvedAtHead,
      })).toBeNull();
    }
  });
});

describe('getPrFacts — approvedAtHead (GitHub)', () => {
  function prFixture(overrides: Partial<IssuePullRequestData> = {}): IssuePullRequestData {
    return {
      number: 3838,
      title: 'PAN-3836',
      url: 'https://github.com/eltmon/overdeck/pull/3838',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feature/pan-3836',
      headRefOid: HEAD,
      author: { login: 'eltmon' },
      createdAt: '2026-09-16T09:00:00Z',
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
    return getPrFacts('PAN-3836', { fetchGitHubPr: async () => ({ issueId: 'PAN-3836', pr }) });
  }

  const marker = (line: string, createdAt = '2026-09-16T19:50:00Z') => ({
    authorAssociation: 'OWNER', body: `${line}\n\nok`, createdAt,
  });

  it('a marker naming the head sha proves the approval', async () => {
    const facts = await factsFor(prFixture({
      comments: [marker(`<!-- overdeck-verdict: APPROVED sha=${HEAD} -->`)],
    }));
    expect(facts.approved).toBe(true);
    expect(facts.approvedAtHead).toBe(true);
  });

  it('a marker dated after the head but naming no sha, or an older sha, proves nothing', async () => {
    // A commit made before the approval but pushed after it has an older
    // committer date: timestamps cannot tell, the sha can.
    const undated = await factsFor(prFixture({
      comments: [marker('<!-- overdeck-verdict: APPROVED -->')],
    }));
    expect(undated.approved).toBe(true);
    expect(undated.approvedAtHead).toBeUndefined();

    const older = await factsFor(prFixture({
      comments: [marker(`<!-- overdeck-verdict: APPROVED sha=${OLDER} -->`)],
    }));
    expect(older.approvedAtHead).toBeUndefined();
  });

  it('a forge approval is not proven by the shared read (the guard reads review shas itself)', async () => {
    const facts = await factsFor(prFixture({ reviewDecision: 'APPROVED' }));
    expect(facts.approved).toBe(true);
    expect(facts.approvedAtHead).toBeUndefined();
  });
});

describe('getPrFacts — approvedAtHead (GitLab)', () => {
  const WEB_URL = 'https://gitlab.com/mind-your-now/frontend/-/merge_requests/77';

  function deps(view: GitLabMrView): PrFactsDeps {
    return {
      fetchGitHubPr: async (issueId) => ({ issueId, pr: null }),
      resolveRepos: () => [{
        forge: 'gitlab', required: true, repoPath: '/repos/frontend', sourceBranch: 'feature/min-77',
      }] as never,
      listGitLabMrs: async () => [{ iid: 77, source_branch: 'feature/min-77', web_url: WEB_URL, state: 'opened' }] as never,
      viewGitLabMr: async () => view,
    };
  }

  it('a mergeable MR with no approval never counts as approved at head, so the agent may block', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps({
      iid: 77, state: 'opened', web_url: WEB_URL, sha: 'f00d', source_branch: 'feature/min-77',
      detailed_merge_status: 'mergeable',
    }));
    // Merge readiness still reads the MR as it did.
    expect(facts.approved).toBe(true);
    expect(facts.mergeable).toBe(true);
    expect(facts.approvedAtHead).toBeUndefined();
    expect(await forgeApprovalAtHead(facts, async () => { throw new Error('not GitHub'); })).toBeUndefined();
    expect(reviewVerdictRefusal({
      caller: { kind: 'agent', id: 'agent-min-77-review' }, issueId: 'MIN-77', status: 'blocked', facts,
    })).toBeNull();
  });

  it('even an approved MR is not tied to its head sha', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps({
      iid: 77, state: 'opened', web_url: WEB_URL, sha: 'f00d', source_branch: 'feature/min-77',
      detailed_merge_status: 'mergeable', approved: true,
    }));
    expect(facts.approvedAtHead).toBeUndefined();
  });
});

describe('forgeApprovalAtHead', () => {
  const facts = {
    forge: 'github' as const,
    url: 'https://github.com/eltmon/overdeck/pull/3979',
    number: 3979,
    headSha: HEAD,
  };
  // A trusted reviewer unless the fixture says otherwise (#4066 review).
  type Review = GitHubReviewRecord & { state: string; commit: { oid: string } };
  const atHead = (reviews: Review[]) =>
    async () => ({
      headRefOid: HEAD,
      reviews: reviews.map((review) => ({ author: { login: 'eltmon' }, authorAssociation: 'OWNER', ...review })),
    });
  const noLogins = async () => [] as string[];

  it('is true only for an APPROVED review whose commit is the head', async () => {
    const read = vi.fn(atHead([
      { state: 'CHANGES_REQUESTED', commit: { oid: OLDER } },
      { state: 'APPROVED', commit: { oid: HEAD } },
    ]));
    expect(await forgeApprovalAtHead(facts, read)).toBe(true);
    expect(read).toHaveBeenCalledWith('eltmon/overdeck', 3979);
  });

  it('is false for an approval of an older commit, whenever it was submitted', async () => {
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: OLDER } },
      { state: 'COMMENTED', commit: { oid: HEAD } },
    ]))).toBe(false);
  });

  it('is false for an empty or oid-less review list: no approval proven', async () => {
    expect(await forgeApprovalAtHead(facts, atHead([]))).toBe(false);
    expect(await forgeApprovalAtHead(facts, async () => ({ headRefOid: HEAD, reviews: null }))).toBe(false);
    expect(await forgeApprovalAtHead(facts, atHead([{ state: 'APPROVED', commit: { oid: '' } }]))).toBe(false);
  });

  // #4066 review: the repo is public; any GitHub account can submit a review.
  it('ignores an APPROVED review of the head from an untrusted author', async () => {
    const overdeckLogins = vi.fn(async () => ['eltmon', 'overdeck-app[bot]']);
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, author: { login: 'drive-by' }, authorAssociation: 'NONE' },
    ]), overdeckLogins)).toBe(false);
    expect(overdeckLogins).toHaveBeenCalled();
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, author: { login: 'coderabbitai' }, authorAssociation: 'CONTRIBUTOR' },
    ]), overdeckLogins)).toBe(false);
  });

  it('counts an APPROVED review of the head from the identity Overdeck posts as', async () => {
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, author: { login: 'overdeck-app[bot]' }, authorAssociation: 'NONE' },
    ]), async () => ['overdeck-app[bot]'])).toBe(true);
  });

  it('ignores a review with no author login: it cannot be attributed', async () => {
    expect(await forgeApprovalAtHead(facts, async () => ({
      headRefOid: HEAD,
      reviews: [{ state: 'APPROVED', authorAssociation: 'OWNER', commit: { oid: HEAD } }],
    }), noLogins)).toBe(false);
  });

  it("takes each author's latest verdict: a later CHANGES_REQUESTED on the head withdraws the approval", async () => {
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:00:00Z' },
      { state: 'CHANGES_REQUESTED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:05:00Z' },
    ]), noLogins)).toBe(false);
  });

  it('a later dismissal withdraws the approval; a later COMMENTED review does not', async () => {
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'DISMISSED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:00:00Z' },
    ]), noLogins)).toBe(false);
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:00:00Z' },
      { state: 'COMMENTED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:05:00Z' },
    ]), noLogins)).toBe(true);
  });

  it("another trusted author's standing CHANGES_REQUESTED leaves the head unapproved", async () => {
    expect(await forgeApprovalAtHead(facts, atHead([
      { state: 'APPROVED', commit: { oid: HEAD }, submittedAt: '2026-09-24T10:05:00Z' },
      {
        state: 'CHANGES_REQUESTED', commit: { oid: OLDER }, submittedAt: '2026-09-24T09:00:00Z',
        author: { login: 'teammate' }, authorAssociation: 'MEMBER',
      },
    ]), noLogins)).toBe(false);
  });

  it('is undefined when the head moved between the PR read and the review read', async () => {
    expect(await forgeApprovalAtHead({ ...facts, headSha: OLDER }, atHead([
      { state: 'APPROVED', commit: { oid: OLDER } },
    ]))).toBeUndefined();
  });

  it('is undefined when it cannot be told', async () => {
    expect(await forgeApprovalAtHead(facts, async () => { throw new Error('gh: rate limited'); })).toBeUndefined();
    expect(await forgeApprovalAtHead({ ...facts, headSha: null }, atHead([]))).toBeUndefined();
    expect(await forgeApprovalAtHead({ ...facts, forge: 'gitlab' }, atHead([]))).toBeUndefined();
  });
});
