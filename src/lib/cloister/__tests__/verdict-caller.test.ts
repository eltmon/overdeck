/**
 * #3853: the human-override half of `pan admin specialists done review` is the
 * operator's. A review synthesizer once reversed an approval on an unchanged
 * head and called it an "operator-authorized override".
 */
import { describe, expect, it } from 'vitest';

import { getPrFacts, resetPrFactsCache } from '../pr-facts.js';
import {
  isIssueReviewSession,
  reviewVerdictRefusal,
  verdictCallerFromEnv,
} from '../verdict-caller.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'a7b64f7c0000000000000000000000000000abcd';
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

  it('refuses the synthesizer reversing an approval on an unchanged head (PAN-3836 cycle 9)', () => {
    const refusal = reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked', facts: approvedAtHead,
    });
    expect(refusal).toContain('operator override');
    expect(refusal).toContain('9e039c17');
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'failed', facts: approvedAtHead,
    })).not.toBeNull();
  });

  it('treats an approval of unknown dating as at head', () => {
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked',
      facts: { approved: true, headSha: null },
    })).not.toBeNull();
  });

  it('lets the review agent block new commits and approve', () => {
    expect(reviewVerdictRefusal({
      caller: synthesizer, issueId: 'PAN-3836', status: 'blocked',
      facts: { ...approvedAtHead, approvedAtHead: false },
    })).toBeNull();
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

describe('getPrFacts — approvedAtHead', () => {
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
      reviewDecision: 'APPROVED',
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

  it('dates a forge approval against the head commit', async () => {
    const atHead = await factsFor(prFixture({
      latestReviews: [{ state: 'APPROVED', submittedAt: '2026-09-16T19:50:00Z' }],
    }));
    expect(atHead.approved).toBe(true);
    expect(atHead.approvedAtHead).toBe(true);

    const kept = await factsFor(prFixture({
      latestReviews: [{ state: 'APPROVED', submittedAt: '2026-09-16T18:00:00Z' }],
    }));
    expect(kept.approved).toBe(true);
    expect(kept.approvedAtHead).toBe(false);
  });

  it('reads a forge approval without review dates as at head', async () => {
    const facts = await factsFor(prFixture());
    expect(facts.approvedAtHead).toBe(true);
  });

  it('a fresh approval marker is at head; no approval is not', async () => {
    const marker = await factsFor(prFixture({
      reviewDecision: null,
      comments: [{ authorAssociation: 'OWNER', body: '<!-- overdeck-verdict: APPROVED -->\n\nok', createdAt: '2026-09-16T19:50:00Z' }],
    }));
    expect(marker.approvedAtHead).toBe(true);
    const none = await factsFor(prFixture({ reviewDecision: null }));
    expect(none.approvedAtHead).toBe(false);
  });
});
