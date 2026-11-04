/**
 * PAN-4917: `listFailedChecks` reports every failing check on a PR head, not
 * only the CI test job's rows; `getPrFacts` surfaces it as `checkFailures`.
 */
import { describe, expect, it } from 'vitest';

import { listFailedChecks, listFailedTestChecks } from '../check-failures.js';
import { getPrFacts, resetPrFactsCache } from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'c0ffee0000000000000000000000000000000001';

const daggerUrl = (context: string) =>
  `https://dagger.cloud/o/checks/github.com/o/r@sha?check=${context}`;

const daggerStatus = (context: string, state: string) => ({
  __typename: 'StatusContext',
  context,
  state,
  targetUrl: daggerUrl(context),
});

function prFixture(statusCheckRollup: IssuePullRequestData['statusCheckRollup']): IssuePullRequestData {
  return {
    number: 4917,
    title: 'PAN-4917',
    url: 'https://github.com/eltmon/overdeck/pull/4917',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-4917',
    headRefOid: HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-11-03T09:00:00Z',
    updatedAt: '2026-11-03T10:00:00Z',
    reviewDecision: 'APPROVED',
    reviewRequests: [],
    statusCheckRollup,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    labels: [],
    mergeable: 'MERGEABLE',
    body: '',
    commits: [{ oid: HEAD, committedDate: '2026-11-03T10:00:00Z' }],
  };
}

async function factsFor(statusCheckRollup: IssuePullRequestData['statusCheckRollup']) {
  resetPrFactsCache();
  return getPrFacts('PAN-4917', {
    fetchGitHubPr: async () => ({ issueId: 'PAN-4917', pr: prFixture(statusCheckRollup) }),
  });
}

describe('listFailedChecks', () => {
  it('returns a cancelled check alongside an unrelated passing test row', () => {
    const rollup = [
      { name: 'Prompt change trailer gate', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ];
    expect(listFailedChecks(rollup)).toEqual([{ name: 'Prompt change trailer gate', conclusion: 'CANCELLED' }]);
  });

  it('returns a commit status in ERROR with its link', () => {
    const rollup = [daggerStatus('go-client/test', 'ERROR')];
    expect(listFailedChecks(rollup)).toEqual([
      { name: 'go-client/test', conclusion: 'ERROR', targetUrl: daggerUrl('go-client/test') },
    ]);
  });

  it('returns an empty array for undefined and for an all-passing rollup', () => {
    expect(listFailedChecks(undefined)).toEqual([]);
    expect(listFailedChecks([
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'build (22)', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'reject-planning-paths', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    ])).toEqual([]);
  });
});

describe('listFailedTestChecks', () => {
  it('excludes a cancelled non-test row and includes a failed test row', () => {
    const rollup = [
      { name: 'lint', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    ];
    expect(listFailedTestChecks(rollup)).toEqual([{ name: 'test', conclusion: 'FAILURE' }]);
  });
});

describe('getPrFacts.checkFailures (PAN-4917)', () => {
  it('is red and names the cancelled trailer-gate check', async () => {
    const rollup = [
      { name: 'Prompt change trailer gate', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ];
    const facts = await factsFor(rollup);
    expect(facts.checks).toBe('red');
    expect(facts.checkFailures).toEqual([{ name: 'Prompt change trailer gate', conclusion: 'CANCELLED' }]);
  });
});
