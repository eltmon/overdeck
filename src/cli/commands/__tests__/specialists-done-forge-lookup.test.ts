/**
 * PAN-4263: `pan admin specialists done` separates a forge failure from an
 * absent PR, and saves a review verdict that hit a transient failure as a
 * `review.verdict-deferred` journal entry for deacon-lite to replay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  discoverArtifact: vi.fn(),
  postReviewVerdict: vi.fn(),
  getPrFacts: vi.fn(),
  appendPipelineEntry: vi.fn(),
  getAgentState: vi.fn(),
  emitActivityEntry: vi.fn(),
  ancestors: [] as string[],
}));

vi.mock('../../../lib/forge.js', () => ({
  discoverArtifact: mocks.discoverArtifact,
  commentOnArtifact: vi.fn(() => Effect.succeed(undefined)),
}));
vi.mock('../../../lib/cloister/pr-review-verdict.js', () => ({ postReviewVerdict: mocks.postReviewVerdict }));
vi.mock('../../../lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
  resetPrFactsCache: vi.fn(),
  forgeApprovalAtHead: vi.fn(async () => undefined),
}));
vi.mock('../../../lib/cloister/verdict-caller.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/cloister/verdict-caller.js')>(),
  readAncestorAgentIds: () => mocks.ancestors,
}));
vi.mock('../../../lib/agents/agent-state-read.js', () => ({ getAgentState: mocks.getAgentState }));
vi.mock('../../../dashboard/server/services/pr-tab-cache.js', () => ({ bumpIssuePrTabCacheGeneration: vi.fn() }));
vi.mock('../../../lib/cloister/pipeline-journal.js', () => ({ appendPipelineEntry: mocks.appendPipelineEntry }));
vi.mock('../../../lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => '/project/workspaces/feature-pan-4222'),
}));
vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(() => true),
}));


const PR_URL = 'https://github.com/eltmon/overdeck/pull/4230';
const RUN_ID = 'agent-pan-4222-review-abcdef12';
const RATE_LIMIT = 'gh pr view feature/pan-4222 failed: GraphQL: API rate limit already exceeded for user ID 1';

function lookupFails(message: string) {
  mocks.discoverArtifact.mockReturnValue(Effect.fail(new Error(message)));
}

async function recordReview(status: 'passed' | 'blocked' = 'passed') {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error');
  const { doneCommand } = await import('../specialists/done.js');
  await doneCommand('review', 'pan-4222', { status, notes: 'looks right', runId: RUN_ID });
  return { exit, stderr: error.mock.calls.map((c) => String(c[0])).join('\n') };
}

const journaled = (type: string) =>
  mocks.appendPipelineEntry.mock.calls.map((c) => c[1]).filter((entry) => entry.type === type);

describe('specialists done: forge lookup failure is not absence (PAN-4263)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-4222-review');
    vi.stubEnv('OVERDECK_ISSUE_ID', '');
    vi.stubEnv('OVERDECK_SESSION_TYPE', '');
    mocks.ancestors = [];
    mocks.getAgentState.mockReturnValue(null);
    mocks.discoverArtifact.mockReturnValue(Effect.succeed({ forge: 'github', url: PR_URL, id: '4230', created: false }));
    mocks.getPrFacts.mockResolvedValue({
      issueId: 'PAN-4222', forge: 'github', url: PR_URL, open: true, approved: false, changesRequested: false,
      headSha: 'abcdef1234567890',
    });
    mocks.postReviewVerdict.mockResolvedValue({ posted: true, forge: 'github', url: PR_URL, verdict: 'approve' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reports a rate-limited lookup as unreachable and defers the verdict', async () => {
    lookupFails(RATE_LIMIT);

    const { exit, stderr } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain("Couldn't reach github");
    expect(stderr).toContain('rate limit');
    expect(stderr).not.toContain('No open review artifact');
    expect(mocks.postReviewVerdict).not.toHaveBeenCalled();
    expect(journaled('review.verdict-deferred')).toEqual([expect.objectContaining({
      issueId: 'PAN-4222',
      data: expect.objectContaining({
        status: 'passed',
        runId: RUN_ID,
        callerId: 'agent-pan-4222-review',
        notes: 'looks right',
        reason: expect.stringContaining('rate limit'),
      }),
    })]);
  });

  it('keeps the no-artifact message for a true absence and defers nothing', async () => {
    mocks.discoverArtifact.mockReturnValue(Effect.succeed(null));

    const { exit, stderr } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain('No open review artifact');
    expect(journaled('review.verdict-deferred')).toEqual([]);
  });

  it('reports a non-transient lookup failure without deferring it', async () => {
    lookupFails('gh pr view feature/pan-4222 failed: HTTP 401: Bad credentials');

    const { exit, stderr } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain("Couldn't reach github");
    expect(stderr).toContain('Retry this command once the forge is reachable.');
    expect(journaled('review.verdict-deferred')).toEqual([]);
  });

  it('refuses a work agent before any forge call and leaves no deferral', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-4222');
    lookupFails(RATE_LIMIT);

    const { exit } = await recordReview();

    expect(exit).toHaveBeenCalledWith(1);
    expect(mocks.discoverArtifact).not.toHaveBeenCalled();
    expect(journaled('review.verdict-refused')).toHaveLength(1);
    expect(journaled('review.verdict-deferred')).toEqual([]);
  });

  it('defers a verdict whose post hit a transient forge failure', async () => {
    mocks.postReviewVerdict.mockResolvedValue({ posted: false, reason: 'gh pr review failed: API rate limit exceeded' });

    const { exit, stderr } = await recordReview('blocked');

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toContain('The verdict is saved and deacon-lite will retry recording it.');
    expect(journaled('review.verdict-deferred')).toEqual([expect.objectContaining({
      data: expect.objectContaining({ status: 'blocked', runId: RUN_ID, callerId: 'agent-pan-4222-review' }),
    })]);
  });

  it('defers an operator verdict with no caller id', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', '');
    lookupFails(RATE_LIMIT);

    await recordReview();

    expect(journaled('review.verdict-deferred')).toEqual([expect.objectContaining({
      data: expect.objectContaining({ callerId: null }),
    })]);
  });
});
