/**
 * #4036: merge readiness reads the UAT verdict from the forge — the marker the
 * verdict comment `pan admin specialists done` posts carries, anchored on the
 * commit UAT ran against — and a failed required UAT at the current head is not
 * merge-ready. The repository is public, so only trusted authors' markers count
 * (#4040 review).
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

async function factsFor(pr: IssuePullRequestData, logins: readonly string[] = []): Promise<PrFacts> {
  resetPrFactsCache();
  return getPrFacts('PAN-4036', {
    fetchGitHubPr: async () => ({ issueId: 'PAN-4036', pr }),
    overdeckLogins: async () => logins,
  });
}

/** A verdict comment as `pan admin specialists done` posts it, from the repo owner. */
function uatComment(
  status: 'passed' | 'failed',
  sha: string | null,
  createdAt: string,
  author: Pick<Comment, 'author' | 'authorAssociation'> = { author: { login: 'eltmon' }, authorAssociation: 'OWNER' },
): Comment {
  return {
    ...author,
    body: `**test verdict: passed**\n\n**browser UAT: ${status}**\n\nnotes\n\n${formatUatMarker(status, sha)}`,
    createdAt,
  };
}

const OUTSIDER = { author: { login: 'drive-by' }, authorAssociation: 'NONE' };

describe('parseUatVerdict', () => {
  it('reads the marker with its anchored commit', () => {
    expect(parseUatVerdict(`**uat verdict: failed**\n\n${formatUatMarker('failed', 'ABCDEF1')}`))
      .toEqual({ status: 'failed', sha: 'abcdef1' });
    expect(parseUatVerdict(formatUatMarker('passed'))).toEqual({ status: 'passed', sha: null });
  });

  it('reads nothing from a comment without the marker, including a pre-marker verdict', () => {
    expect(parseUatVerdict('**uat verdict: failed**\n\nbutton missing')).toBeNull();
    expect(parseUatVerdict('**test verdict: passed**\n\n**browser UAT: passed**')).toBeNull();
    expect(parseUatVerdict('**test verdict: failed**\n\nlint')).toBeNull();
    expect(parseUatVerdict('<!-- overdeck-verdict: APPROVED -->')).toBeNull();
    expect(parseUatVerdict(undefined)).toBeNull();
  });

  it('ignores a quoted marker and a marker inside prose', () => {
    expect(parseUatVerdict(`> ${formatUatMarker('passed', OLD_HEAD)}\n\nagreed, ship it`)).toBeNull();
    expect(parseUatVerdict(`see ${formatUatMarker('passed', OLD_HEAD)} above`)).toBeNull();
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

  it('dates a marker posted without a commit against the head commit', async () => {
    const current = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', null, '2026-09-23T10:30:00Z'),
    ]));
    expect(evaluateMergeReadiness(current, { uatRequired: true }).ready).toBe(false);

    const superseded = await factsFor(prFixture(NEW_HEAD, '2026-09-23T11:00:00Z', [
      uatComment('failed', null, '2026-09-23T10:30:00Z'),
    ]));
    expect(superseded.uatVerdict).toBeNull();
  });

  it('reads a verdict posted before the marker existed as no verdict (fails closed to "none")', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      { author: { login: 'eltmon' }, authorAssociation: 'OWNER', body: '**uat verdict: failed**\n\nlogin broken', createdAt: '2026-09-23T10:30:00Z' },
    ]));
    expect(facts.uatVerdict).toBeNull();
  });

  it('leaves a failed UAT advisory when UAT is not required', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
    ]));
    expect(evaluateMergeReadiness(facts)).toEqual({ ready: true });
    expect(evaluateMergeReadiness(facts, { uatRequired: false })).toEqual({ ready: true });
  });
});

describe('only trusted authors declare a UAT verdict (#4040 review)', () => {
  it("ignores an outsider's pass that would clear a failure", async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
      uatComment('passed', OLD_HEAD, '2026-09-23T10:45:00Z', OUTSIDER),
    ]));
    expect(facts.uatVerdict?.status).toBe('failed');
    expect(evaluateMergeReadiness(facts, { uatRequired: true }).ready).toBe(false);
  });

  it("ignores an outsider's failure that would block a merge", async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z', OUTSIDER),
    ]));
    expect(facts.uatVerdict).toBeNull();
    expect(evaluateMergeReadiness(facts, { uatRequired: true })).toEqual({ ready: true });
  });

  it("honors a verdict posted as Overdeck's own login", async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z', { author: { login: 'Overdeck-Bot' }, authorAssociation: 'NONE' }),
    ]), ['overdeck-bot']);
    expect(facts.uatVerdict?.status).toBe('failed');
  });

  it('ignores a trusted quote-reply of an old passing verdict', async () => {
    const facts = await factsFor(prFixture(OLD_HEAD, '2026-09-23T10:00:00Z', [
      uatComment('failed', OLD_HEAD, '2026-09-23T10:30:00Z'),
      {
        author: { login: 'eltmon' },
        authorAssociation: 'OWNER',
        body: `> ${formatUatMarker('passed', OLD_HEAD)}\n\nthis passed before?`,
        createdAt: '2026-09-23T10:40:00Z',
      },
    ]));
    expect(facts.uatVerdict?.status).toBe('failed');
  });
});
