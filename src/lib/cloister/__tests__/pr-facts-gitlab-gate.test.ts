/**
 * #4040 review: the merge gate reads a GitLab MR the way the board does, and
 * says so when it cannot read the MR at all.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateMergeReadiness,
  getPrFacts,
  resetPrFactsCache,
  type GitLabMrApprovals,
  type GitLabMrView,
  type PrFactsDeps,
} from '../pr-facts.js';

const WEB_URL = 'https://gitlab.com/mind-your-now/frontend/-/merge_requests/77';

const APPROVED: GitLabMrApprovals = {
  approved: true, approvals_required: 0, approvals_left: 0, approved_by: [{ user: { username: 'eltmon' } }],
};

function deps(
  view: () => Promise<GitLabMrView>,
  approvals: () => Promise<GitLabMrApprovals> = async () => APPROVED,
): PrFactsDeps {
  return {
    fetchGitHubPr: async (issueId) => ({ issueId, pr: null }),
    resolveRepos: () => [{
      forge: 'gitlab',
      required: true,
      repoPath: '/repos/frontend',
      sourceBranch: 'feature/min-77',
    }] as never,
    listGitLabMrs: async () => [{ iid: 77, source_branch: 'feature/min-77', web_url: WEB_URL, state: 'opened' }] as never,
    viewGitLabMr: view,
    readGitLabApprovals: approvals,
  };
}

const MERGEABLE_VIEW: GitLabMrView = {
  iid: 77,
  state: 'opened',
  web_url: WEB_URL,
  sha: 'f00d',
  source_branch: 'feature/min-77',
  detailed_merge_status: 'mergeable',
  head_pipeline: { status: 'success' },
};

describe('GitLab MR through the merge gate', () => {
  it('reads a skipped pipeline as green, as the board does', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(async () => ({ ...MERGEABLE_VIEW, head_pipeline: { status: 'skipped' } })));
    expect(facts.checks).toBe('green');
    // The CI test-job rule does not apply to GitLab: its pipeline is the verdict.
    expect(evaluateMergeReadiness(facts, { ciTestsRequired: true })).toEqual({ ready: true });
  });

  it('still refuses a failed pipeline', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(async () => ({ ...MERGEABLE_VIEW, head_pipeline: { status: 'failed' } })));
    expect(evaluateMergeReadiness(facts).ready).toBe(false);
  });

  // #4066 review: the MYN backend requires 0 approvals, so GitLab's own
  // `approved` is true and the merge status `mergeable` for every green MR.
  it('refuses a green, mergeable MR nobody approved (approvals_required: 0, approved_by: [])', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(
      async () => MERGEABLE_VIEW,
      async () => ({ approved: true, approvals_required: 0, approvals_left: 0, approved_by: [] }),
    ));
    expect(facts.approved).toBe(false);
    expect(evaluateMergeReadiness(facts, { requireApprovalAtHead: true })).toEqual({ ready: false, reason: 'PR is not approved' });
  });

  it('merges a green MR someone approved with `glab mr approve`', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(async () => MERGEABLE_VIEW));
    expect(facts.approved).toBe(true);
    expect(evaluateMergeReadiness(facts, { requireApprovalAtHead: true })).toEqual({ ready: true });
  });

  it('names a failed approvals read as the refusal', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(async () => MERGEABLE_VIEW, async () => { throw new Error('glab: 403'); }));
    expect(facts.approved).toBe(false);
    expect(evaluateMergeReadiness(facts).reason).toBe('GitLab MR approvals read failed for !77: glab: 403');
  });

  it('names a failed MR view as the refusal instead of a missing approval', async () => {
    resetPrFactsCache();
    const facts = await getPrFacts('MIN-77', deps(async () => { throw new Error('glab: 502 Bad Gateway'); }));
    expect(facts.exists).toBe(true);
    expect(facts.number).toBe(77);
    const readiness = evaluateMergeReadiness(facts);
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toBe('GitLab MR view failed for !77: glab: 502 Bad Gateway');
  });
});
