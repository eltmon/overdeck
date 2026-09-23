/**
 * #4036: merge readiness reads the UAT verdict from the forge — the verdict
 * comment `pan admin specialists done` posts, anchored on the commit UAT ran
 * against — and a failed required UAT at the current head is not merge-ready.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateMergeReadiness,
  formatUatMarker,
  getPrFacts,
  parseUatVerdict,
  resetPrFactsCache,
  type PrFacts,
} from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const OLD_HEAD = 'aaaa111100000000000000000000000000000000';
const NEW_HEAD = 'bbbb222200000000000000000000000000000000';

const GREEN = [
  { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { name: 'build (22)', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { name: 'reject-planning-paths', status: 'COMPLETED', conclusion: 'SUCCESS' },
];

type Comment = NonNullable<IssuePullRequestData['comments']>[number];

function prFixture(head: string, headAt: string, comments: Comment[]): IssuePullRequestData {
  return {
    number: 4036,
    title: 'PAN-4036',
    url: 'https://github.com/eltmon/overdeck/pull/4036',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-4036',
    headRefOid: head,
    author: { login: 'eltmon' },
    createdAt: '2026-09-23T08:00:00Z',
    updatedAt: headAt,
    reviewDecision: 'APPROVED',
    reviewRequests: [],
    statusCheckRollup: GREEN,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    labels: [],
    mergeable: 'MERGEABLE',
    body: '',
    comments,
    commits: [{ oid: head, committedDate: headAt }],
  };
}

async function factsFor(pr: IssuePullRequestData): Promise<PrFacts> {
  resetPrFactsCache();
  return getPrFacts('PAN-4036', { fetchGitHubPr: async () => ({ issueId: 'PAN-4036', pr }) });
}

function uatComment(status: 'passed' | 'failed', sha: string | null, createdAt: string): Comment {
  return {
    body: `**test verdict: passed**\n\n**browser UAT: ${status}**\n\nnotes\n\n${formatUatMarker(status, sha)}`,
    createdAt,
  };
}

describe('parseUatVerdict', () => {
  it('reads the marker with its anchored commit', () => {
    expect(parseUatVerdict(`**uat verdict: failed**\n\n${formatUatMarker('failed', 'ABCDEF1')}`))
      .toEqual({ status: 'failed', sha: 'abcdef1' });
    expect(parseUatVerdict(formatUatMarker('passed'))).toEqual({ status: 'passed', sha: null });
  });

  it('reads a legacy comment posted before the marker, without a commit', () => {
    expect(parseUatVerdict('**uat verdict: failed**\n\nbutton missing')).toEqual({ status: 'failed', sha: null });
    expect(parseUatVerdict('**test verdict: passed**\n\n**browser UAT: passed**')).toEqual({ status: 'passed', sha: null });
  });

  it('ignores comments that carry no UAT verdict', () => {
    expect(parseUatVerdict('**test verdict: failed**\n\nlint')).toBeNull();
    expect(parseUatVerdict('<!-- overdeck-verdict: APPROVED -->')).toBeNull();
    expect(parseUatVerdict(undefined)).toBeNull();
  });
});

describe('merge readiness and a failed required UAT (#4036)', () => {
  it('is not merge-ready when the required UAT failed at the current head', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
    ]));

    expect(facts.uatVerdict).toEqual({ status: 'failed', sha: OLD_HEAD, postedAt: '2026-09-23T10:30:00Z' });
    expect(evaluateMergeReadiness(facts, { uatRequired: true })).toEqual({
      ready: false,
      reason: `browser UAT failed on PR HEAD ${OLD_HEAD}`,
    });
  });

  it('matches a verdict anchored on an abbreviated --tested-sha', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD.slice(0, 7), '2026-09-23T10:30:00Z'),
    ]));
    expect(evaluateMergeReadiness(facts, { uatRequired: true }).ready).toBe(false);
  });

  it('restores readiness when a later UAT passes at a newer head', async () => {
    const facts = await factsFor(prFixture(NEW_HEAD, '2026-09-23T11:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
      uatComment('passed', NEW_HEAD, '2026-09-23T11:30:00Z'),
    ]));

    expect(facts.uatVerdict?.status).toBe('passed');
    expect(evaluateMergeReadiness(facts, { uatRequired: true })).toEqual({ ready: true });
  });

  it('restores readiness when UAT is re-run and passes at the same head', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
      uatComment('passed', OLD_HEAD, '2026-09-23T10:45:00Z'),
    ]));
    expect(evaluateMergeReadiness(facts, { uatRequired: true })).toEqual({ ready: true });
  });

  it('does not hold a newer head on a failure recorded against an older one', async () => {
    // The UAT stack is assembled from ready features, so a fix pushed after a
    // failure must become ready again for UAT to run on it at all.
    const facts = await factsFor(prFixture(NEW_HEAD, '2026-09-23T11:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
    ]));
    expect(facts.uatVerdict).toBeNull();
    expect(evaluateMergeReadiness(facts, { uatRequired: true })).toEqual({ ready: true });
  });

  it('dates a legacy (unanchored) verdict against the head commit', async () => {
    const current = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      { body: '**uat verdict: failed**\n\nlogin broken', createdAt: '2026-09-23T10:30:00Z' },
    ]));
    expect(evaluateMergeReadiness(current, { uatRequired: true }).ready).toBe(false);

    const superseded = await factsFor(prFixture(NEW_HEAD, '2026-09-23T11:00:00Z', [
      { body: '**uat verdict: failed**\n\nlogin broken', createdAt: '2026-09-23T10:30:00Z' },
    ]));
    expect(superseded.uatVerdict).toBeNull();
  });

  it('leaves a failed UAT advisory when UAT is not required', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
    ]));
    expect(evaluateMergeReadiness(facts)).toEqual({ ready: true });
    expect(evaluateMergeReadiness(facts, { uatRequired: false })).toEqual({ ready: true });
  });
});
