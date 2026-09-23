/**
 * #4021: in `verification.tests: ci` mode the CI test job is the only test run,
 * so merge readiness requires it to have passed on the PR head — not merely
 * that every present check is green.
 */
import { describe, expect, it } from 'vitest';

import { emptyPrFacts, evaluateMergeReadiness, getPrFacts, resetPrFactsCache, testJobSucceeded, type PrFacts } from '../pr-facts.js';
import type { IssuePullRequestData } from '../../overdeck/pull-requests.js';

const HEAD = 'c0ffee0000000000000000000000000000000001';

/** The required checks on overdeck's main: `test`, `lint`, `build (22)`, `reject-planning-paths`. */
function rollup(test: { conclusion?: string; status?: string } | null) {
  return [
    ...(test ? [{ name: 'test', status: test.status ?? 'COMPLETED', conclusion: test.conclusion }] : []),
    { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'build (22)', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'reject-planning-paths', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
}

function prFixture(statusCheckRollup: IssuePullRequestData['statusCheckRollup']): IssuePullRequestData {
  return {
    number: 4021,
    title: 'PAN-4021',
    url: 'https://github.com/eltmon/overdeck/pull/4021',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-4021',
    headRefOid: HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-09-23T09:00:00Z',
    updatedAt: '2026-09-23T10:00:00Z',
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
    commits: [{ oid: HEAD, committedDate: '2026-09-23T10:00:00Z' }],
  };
}

async function factsFor(statusCheckRollup: IssuePullRequestData['statusCheckRollup']): Promise<PrFacts> {
  resetPrFactsCache();
  return getPrFacts('PAN-4021', {
    fetchGitHubPr: async () => ({ issueId: 'PAN-4021', pr: prFixture(statusCheckRollup) }),
  });
}

describe('testJobSucceeded', () => {
  it('is true only when a test-job check concluded SUCCESS', () => {
    expect(testJobSucceeded(rollup({ conclusion: 'SUCCESS' }))).toBe(true);
    expect(testJobSucceeded([{ name: 'test-shard (1/4)', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe(true);
    expect(testJobSucceeded(rollup({ conclusion: 'SKIPPED' }))).toBe(false);
    expect(testJobSucceeded(rollup({ conclusion: 'NEUTRAL' }))).toBe(false);
    expect(testJobSucceeded(rollup(null))).toBe(false);
    expect(testJobSucceeded(undefined)).toBe(false);
  });
});

describe('evaluateMergeReadiness — CI test job in verification.tests: ci mode (#4021)', () => {
  it('blocks when no test check is reported on the head', async () => {
    const facts = await factsFor(rollup(null));
    expect(facts.checks).toBe('green');
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({
      ready: false,
      reason: `no CI test job reported on PR HEAD ${HEAD} (verification.tests: ci)`,
    });
  });

  it('blocks when the test job was skipped (a path filter or job-level if:)', async () => {
    const facts = await factsFor(rollup({ conclusion: 'SKIPPED' }));
    // Every present check is green — exactly the hole #4021 describes.
    expect(facts.checks).toBe('green');
    expect(facts.testChecks).toBe('green');
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({
      ready: false,
      reason: `the CI test job was skipped on PR HEAD ${HEAD} (verification.tests: ci)`,
    });
  });

  it('allows a head whose test job passed', async () => {
    const facts = await factsFor(rollup({ conclusion: 'SUCCESS' }));
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({ ready: true });
  });

  it('keeps a red test job a checks failure', async () => {
    const facts = await factsFor(rollup({ conclusion: 'FAILURE' }));
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({
      ready: false,
      reason: `CI checks failing on PR HEAD ${HEAD}`,
    });
  });

  it('does not require the test job in local mode', async () => {
    const facts = await factsFor(rollup(null));
    expect(evaluateMergeReadiness(facts)).toEqual({ ready: true });
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: false })).toEqual({ ready: true });
  });

  it('judges a GitLab MR by its pipeline alone: GitLab reports no per-job checks', () => {
    const facts: PrFacts = {
      ...emptyPrFacts('MIN-1'),
      forge: 'gitlab',
      exists: true,
      open: true,
      headSha: HEAD,
      reviewDecision: 'APPROVED',
      approved: true,
      mergeable: true,
      checks: 'green',
    };
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({ ready: true });
  });
});
