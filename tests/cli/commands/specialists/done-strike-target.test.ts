/**
 * PAN-4753 WI-5: the review verdict for a strike-only issue. With no feature
 * workspace, `pan admin specialists done review` reads the strike workspace,
 * finds the PR on `strike/<id>`, journals the reviewed head and the summary,
 * and never drives rework: a flagged strike stops (D1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  discoverArtifact: vi.fn(),
  commentOnArtifact: vi.fn(),
  getIssueWorkspacePath: vi.fn(),
  resolveReviewTarget: vi.fn(),
  deliverReviewVerdictFeedback: vi.fn(),
  postReviewVerdict: vi.fn(),
  getPrFacts: vi.fn(),
  appendPipelineEntry: vi.fn(),
  forgeApprovalAtHead: vi.fn(),
  getAgentState: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/forge.js', () => ({
  discoverArtifact: mocks.discoverArtifact,
  commentOnArtifact: mocks.commentOnArtifact,
}));
vi.mock('../../../../src/lib/cloister/pr-review-verdict.js', () => ({ postReviewVerdict: mocks.postReviewVerdict }));
vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
  resetPrFactsCache: vi.fn(),
  forgeApprovalAtHead: mocks.forgeApprovalAtHead,
}));
vi.mock('../../../../src/lib/cloister/verdict-caller.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/cloister/verdict-caller.js')>(),
  readAncestorAgentIds: () => [],
}));
vi.mock('../../../../src/lib/agents/agent-state-read.js', () => ({ getAgentState: mocks.getAgentState }));
vi.mock('../../../../src/dashboard/server/services/pr-tab-cache.js', () => ({ bumpIssuePrTabCacheGeneration: vi.fn() }));
vi.mock('../../../../src/lib/cloister/pipeline-journal.js', () => ({ appendPipelineEntry: mocks.appendPipelineEntry }));
vi.mock('../../../../src/lib/overdeck/issue-projects.js', () => ({ getIssueWorkspacePath: mocks.getIssueWorkspacePath }));
vi.mock('../../../../src/lib/cloister/review-target.js', () => ({ resolveReviewTarget: mocks.resolveReviewTarget }));
vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mocks.deliverReviewVerdictFeedback,
}));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({ surfaceIssueFeedbackNeedsYou: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mocks.existsSync,
}));

const FEATURE = '/project/workspaces/feature-pan-9';
const STRIKE = '/project/workspaces/feature-pan-9-strike';
const STRIKE_PR = 'https://github.com/eltmon/overdeck/pull/9';
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';

describe('specialists done review for a strike-only issue (PAN-4753 WI-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-9-review');
    vi.stubEnv('OVERDECK_ISSUE_ID', '');
    vi.stubEnv('OVERDECK_SESSION_TYPE', '');
    mocks.getAgentState.mockReturnValue(null);
    mocks.forgeApprovalAtHead.mockResolvedValue(undefined);
    mocks.getIssueWorkspacePath.mockReturnValue(FEATURE);
    mocks.existsSync.mockImplementation((path: string) => path !== FEATURE);
    mocks.resolveReviewTarget.mockReturnValue({ kind: 'strike', workspacePath: STRIKE, branch: 'strike/pan-9' });
    mocks.discoverArtifact.mockReturnValue(Effect.succeed({ forge: 'github', url: STRIKE_PR, id: '9', created: false }));
    mocks.getPrFacts.mockResolvedValue({
      issueId: 'PAN-9', forge: 'github', url: STRIKE_PR, exists: true, open: true,
      approved: false, changesRequested: true, headSha: HEAD,
    });
    mocks.postReviewVerdict.mockResolvedValue({ posted: true, forge: 'github', url: STRIKE_PR, verdict: 'request-changes' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function record(status: 'passed' | 'blocked', notes: string) {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');
    await doneCommand('review', 'pan-9', { status, notes, runId: 'agent-pan-9-review-abcdef12' });
  }

  it('posts the verdict against strike/<id> from the strike workspace', async () => {
    await record('passed', 'lgtm');
    expect(mocks.discoverArtifact).toHaveBeenCalledWith('github', { sourceBranch: 'strike/pan-9', cwd: STRIKE });
    for (const call of mocks.getPrFacts.mock.calls) expect(call[2]).toEqual({ preferBranch: 'strike/pan-9' });
    expect(mocks.postReviewVerdict.mock.calls[0]![0]).toMatchObject({ issueId: 'PAN-9', verdict: 'approve', facts: { url: STRIKE_PR } });
  });

  it('journals the reviewed head and the summary in the strike workspace', async () => {
    await record('blocked', 'the fix drops the retry guard');
    const verdict = mocks.appendPipelineEntry.mock.calls.find(([, entry]) => entry.type === 'review.verdict');
    expect(verdict?.[0]).toBe(STRIKE);
    expect(verdict?.[1].data).toMatchObject({
      verdict: 'CHANGES_REQUESTED',
      headSha: 'abcdef12',
      summary: 'the fix drops the retry guard',
    });
  });

  it('never delivers rework feedback for a flagged strike (D1)', async () => {
    await record('blocked', 'the fix drops the retry guard');
    expect(mocks.deliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('keeps the feature workspace when it exists', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.discoverArtifact.mockReturnValue(Effect.succeed({ forge: 'github', url: STRIKE_PR, id: '9', created: false }));
    await record('passed', 'lgtm');
    expect(mocks.resolveReviewTarget).not.toHaveBeenCalled();
    expect(mocks.discoverArtifact).toHaveBeenCalledWith('github', { sourceBranch: 'feature/pan-9', cwd: FEATURE });
  });
});
