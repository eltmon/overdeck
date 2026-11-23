/**
 * PAN-5614: `pan admin specialists done review` for a GitLab polyrepo issue.
 * The workspace root has no remote, so the forge comes from the project
 * configuration, and the verdict goes on every member repo's open MR, which
 * is what the polyrepo ready set requires before it merges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const API_MR = 'https://gitlab.com/eltmon/mind-your-now-backend/-/merge_requests/108';
const INFRA_MR = 'https://gitlab.com/eltmon/myn-infra/-/merge_requests/19';
const SKILLS_PR = 'https://github.com/mindyournow/myn-skills/pull/4';

const mocks = vi.hoisted(() => ({
  discoverArtifact: vi.fn(),
  commentOnArtifact: vi.fn(),
  postReviewVerdict: vi.fn(),
  getPrFacts: vi.fn(),
  appendPipelineEntry: vi.fn(),
  resolveReviewArtifactTargets: vi.fn(),
  readMemberMrFacts: vi.fn(),
}));

vi.mock('../../../lib/forge.js', () => ({
  discoverArtifact: mocks.discoverArtifact,
  commentOnArtifact: mocks.commentOnArtifact,
}));
vi.mock('../../../lib/cloister/review-artifact-targets.js', () => ({
  resolveReviewArtifactTargets: mocks.resolveReviewArtifactTargets,
  readMemberMrFacts: mocks.readMemberMrFacts,
}));
vi.mock('../../../lib/cloister/pr-review-verdict.js', () => ({ postReviewVerdict: mocks.postReviewVerdict }));
vi.mock('../../../lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
  resetPrFactsCache: vi.fn(),
  forgeApprovalAtHead: vi.fn(async () => undefined),
}));
vi.mock('../../../lib/cloister/verdict-caller.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/cloister/verdict-caller.js')>(),
  readAncestorAgentIds: () => [],
}));
vi.mock('../../../lib/agents/agent-state-read.js', () => ({ getAgentState: vi.fn(() => null) }));
vi.mock('../../../dashboard/server/services/pr-tab-cache.js', () => ({ bumpIssuePrTabCacheGeneration: vi.fn() }));
vi.mock('../../../lib/cloister/pipeline-journal.js', () => ({ appendPipelineEntry: mocks.appendPipelineEntry }));
vi.mock('../../../lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => '/projects/myn/workspaces/feature-min-1144'),
}));
vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(() => true),
}));

const target = (repoKey: string, dir: string, forge: 'gitlab' | 'github' = 'gitlab') => ({
  repoKey, forge, cwd: `/projects/myn/${dir}`, sourceBranch: 'feature/min-1144',
});

const ARTIFACT_BY_CWD: Record<string, string | null> = {
  '/projects/myn/frontend': null,
  '/projects/myn/api': API_MR,
  '/projects/myn/infra': INFRA_MR,
  '/projects/myn/myn-skills': null,
};

function mrFacts(url: string, approved = false) {
  return { issueId: 'MIN-1144', forge: 'gitlab', url, exists: true, open: true, approved, changesRequested: false };
}

async function recordReview(specialist = 'review') {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const { doneCommand } = await import('../specialists/done.js');
  await doneCommand(specialist, 'min-1144', { status: 'passed', notes: 'looks right', runId: 'agent-min-1144-review-abcdef12' });
  const stderr = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
  return { exit, stderr };
}

const posted = () => mocks.postReviewVerdict.mock.calls.map((c) => c[0].facts?.url);

describe('specialists done review: GitLab polyrepo (PAN-5614)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-min-1144-review');
    vi.stubEnv('OVERDECK_ISSUE_ID', '');
    vi.stubEnv('OVERDECK_SESSION_TYPE', '');
    mocks.resolveReviewArtifactTargets.mockResolvedValue({
      polyrepo: true,
      targets: [target('fe', 'frontend'), target('api', 'api'), target('infra', 'infra')],
    });
    mocks.discoverArtifact.mockImplementation((forge: string, input: { cwd: string }) => {
      const url = ARTIFACT_BY_CWD[input.cwd];
      return Effect.succeed(url ? { forge, url, created: false } : null);
    });
    mocks.readMemberMrFacts.mockImplementation(async (_issue: string, _branch: string, url: string) => mrFacts(url));
    mocks.getPrFacts.mockResolvedValue(mrFacts(API_MR));
    mocks.postReviewVerdict.mockImplementation(async (input: { facts: { url: string } }) => ({
      posted: true, forge: 'gitlab', url: input.facts.url, verdict: 'approve',
    }));
    mocks.commentOnArtifact.mockReturnValue(Effect.succeed(undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('looks in each member repo and approves every open MR', async () => {
    const { exit } = await recordReview();

    expect(exit).not.toHaveBeenCalledWith(1);
    expect(mocks.discoverArtifact.mock.calls.map((c) => [c[0], c[1].cwd])).toEqual([
      ['gitlab', '/projects/myn/frontend'],
      ['gitlab', '/projects/myn/api'],
      ['gitlab', '/projects/myn/infra'],
    ]);
    expect(posted()).toEqual([API_MR, INFRA_MR]);
    expect(mocks.postReviewVerdict.mock.calls.every((c) => c[0].verdict === 'approve')).toBe(true);
    const verdicts = mocks.appendPipelineEntry.mock.calls.map((c) => c[1]).filter((e) => e.type === 'review.verdict');
    expect(verdicts).toEqual([expect.objectContaining({ data: expect.objectContaining({ verdict: 'APPROVED' }) })]);
  });

  it('leaves an MR that is already approved alone, so a re-run approves nothing twice', async () => {
    mocks.readMemberMrFacts.mockImplementation(async (_issue: string, _branch: string, url: string) =>
      mrFacts(url, url === API_MR));

    await recordReview();

    expect(posted()).toEqual([INFRA_MR]);
  });

  it('posts nothing when one member MR cannot be read', async () => {
    mocks.readMemberMrFacts.mockImplementation(async (_issue: string, _branch: string, url: string) =>
      url === INFRA_MR ? { ...mrFacts(url), error: 'GitLab MR approvals read failed for !19: glab: 403' } : mrFacts(url));

    const { exit, stderr } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain(`Could not post the review verdict on ${INFRA_MR}`);
    expect(mocks.postReviewVerdict).not.toHaveBeenCalled();
  });

  it('refuses before posting when a GitHub member has an open PR', async () => {
    mocks.resolveReviewArtifactTargets.mockResolvedValue({
      polyrepo: true,
      targets: [target('api', 'api'), target('skills', 'myn-skills', 'github')],
    });
    ARTIFACT_BY_CWD['/projects/myn/myn-skills'] = SKILLS_PR;
    try {
      const { exit, stderr } = await recordReview();

      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr).toContain('skills is a GitHub member of a polyrepo project');
      expect(mocks.postReviewVerdict).not.toHaveBeenCalled();
    } finally {
      ARTIFACT_BY_CWD['/projects/myn/myn-skills'] = null;
    }
  });

  it('reports a forge it cannot determine and makes no forge call', async () => {
    mocks.resolveReviewArtifactTargets.mockRejectedValue(new Error('no project is configured for MIN-1144'));

    const { exit, stderr } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain("Can't tell which forge holds MIN-1144's review artifact");
    expect(mocks.discoverArtifact).not.toHaveBeenCalled();
  });

  it('records a test verdict on a member MR from that repo\'s checkout', async () => {
    await recordReview('test');

    expect(mocks.commentOnArtifact).toHaveBeenCalledWith('gitlab', expect.objectContaining({
      url: API_MR, cwd: '/projects/myn/api',
    }));
  });
});
