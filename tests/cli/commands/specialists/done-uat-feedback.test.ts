/**
 * PAN-4030 acceptance: a failed browser UAT reaches the work agent again.
 *
 * PAN-3917 deleted the only caller of the UAT relay. The UAT result is now
 * observed in `pan admin specialists done` (test role `--uat-status`, or the
 * uat role), so these tests drive that command with the REAL relay and only
 * fake the edges: the forge, the feedback file, the target resolver and the
 * keyed delivery store. Each `doneCommand` call models one fresh CLI process,
 * so the relay's in-process map is reset between calls — once-per-anchor has
 * to come from the keyed store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  deliveredKeys: new Set<string>(),
  messageAgent: vi.fn(),
  resolveIssueFeedbackTarget: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
  writeFeedbackFile: vi.fn(),
  getPrFacts: vi.fn(),
}));

vi.mock('../../../../src/lib/forge.js', () => ({
  discoverArtifact: vi.fn(() => Effect.succeed({
    forge: 'github', url: 'https://github.com/eltmon/overdeck/pull/4030', id: '4030', created: false,
  })),
  commentOnArtifact: vi.fn(() => Effect.succeed(undefined)),
}));
vi.mock('../../../../src/lib/cloister/pr-review-verdict.js', () => ({ postReviewVerdict: vi.fn() }));
vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
  resetPrFactsCache: vi.fn(),
}));
vi.mock('../../../../src/dashboard/server/services/pr-tab-cache.js', () => ({
  bumpIssuePrTabCacheGeneration: vi.fn(),
}));
vi.mock('../../../../src/lib/cloister/pipeline-journal.js', () => ({ appendPipelineEntry: vi.fn() }));
vi.mock('../../../../src/lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => '/project/workspaces/feature-pan-4030'),
}));
vi.mock('../../../../src/lib/projects.js', () => ({ resolveProjectFromIssueSync: vi.fn(() => null) }));
vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({ writeFeedbackFile: mocks.writeFeedbackFile }));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));
vi.mock('../../../../src/lib/agents/messaging.js', () => ({ messageAgent: mocks.messageAgent }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(() => true),
}));

import { doneCommand } from '../../../../src/cli/commands/specialists/done.js';
import { resetUatFailureFeedbackStateForTests } from '../../../../src/lib/cloister/uat-failure-feedback.js';

const FEEDBACK_PATH = '/project/workspaces/feature-pan-4030/.pan/feedback/001-uat-agent-failed.md';

/** One `pan admin specialists done` invocation in a fresh process. */
async function reportUat(uatStatus: 'passed' | 'failed', uatNotes: string): Promise<void> {
  resetUatFailureFeedbackStateForTests();
  await doneCommand('test', 'pan-4030', { status: 'passed', notes: 'gates green', uatStatus, uatNotes });
}

describe('PAN-4030: UAT failure feedback reaches the work agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliveredKeys.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getPrFacts.mockResolvedValue({ issueId: 'PAN-4030', forge: 'github', open: true, headSha: 'sha-a' });
    mocks.writeFeedbackFile.mockReturnValue(Effect.succeed({ success: true, filePath: FEEDBACK_PATH }));
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-4030' });
    mocks.surfaceIssueFeedbackNeedsYou.mockResolvedValue(undefined);
    // The keyed store outlives the CLI process, like the PTY supervisor's.
    mocks.messageAgent.mockImplementation(async (_id: string, _msg: string, _caller: string, opts: { dedupKey?: string }) => {
      if (opts.dedupKey && mocks.deliveredKeys.has(opts.dedupKey)) {
        return { delivered: true, queuedToMail: false, deduplicated: true };
      }
      if (opts.dedupKey) mocks.deliveredKeys.add(opts.dedupKey);
      return { delivered: true, queuedToMail: false };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers the UAT notes to a live work agent exactly once per failing anchor', async () => {
    await reportUat('failed', 'criterion 2: export button missing');
    await reportUat('failed', 'criterion 2: export button missing');

    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    const outcomes = await Promise.all(mocks.messageAgent.mock.results.map((r) => r.value));
    expect(outcomes.filter((o: { deduplicated?: boolean }) => !o.deduplicated)).toHaveLength(1);
    expect(mocks.messageAgent.mock.calls[0][0]).toBe('agent-pan-4030');
    expect(mocks.messageAgent.mock.calls[0][1]).toContain(`MUST READ: ${FEEDBACK_PATH}`);
    expect(mocks.writeFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-4030',
      specialist: 'uat-agent',
      markdownBody: expect.stringContaining('criterion 2: export button missing'),
    }));
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();

    // The rework push moves the PR head: a failure there is a new anchor.
    mocks.getPrFacts.mockResolvedValue({ issueId: 'PAN-4030', forge: 'github', open: true, headSha: 'sha-b' });
    await reportUat('failed', 'criterion 4: still broken');
    const latest = await mocks.messageAgent.mock.results[2].value;
    expect(latest.deduplicated).toBeUndefined();
    expect(mocks.deliveredKeys.size).toBe(2);
  });

  it('escalates to needs-you when no work agent is alive', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({
      needsYou: true,
      reason: 'No live work agent for PAN-4030',
    });

    await reportUat('failed', 'criterion 1 unmet');

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-4030',
      'No live work agent for PAN-4030',
      { specialist: 'uat-agent', feedbackPath: FEEDBACK_PATH },
    );
  });

  it('a later passing UAT clears the anchor; the same head still reaches the agent only once', async () => {
    // One process for every verdict: the in-process anchor map is not reset.
    resetUatFailureFeedbackStateForTests();
    await doneCommand('test', 'pan-4030', { status: 'passed', uatStatus: 'failed', uatNotes: 'x' });
    await doneCommand('test', 'pan-4030', { status: 'passed', uatStatus: 'failed', uatNotes: 'x' });
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(1);

    await doneCommand('test', 'pan-4030', { status: 'passed', uatStatus: 'passed', uatNotes: 'all observed' });
    await doneCommand('test', 'pan-4030', { status: 'passed', uatStatus: 'failed', uatNotes: 'flaked again' });

    // Cleared: the relay runs again and writes the new notes...
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(2);
    // ...but the agent was already told about this PR head once.
    const outcomes = await Promise.all(mocks.messageAgent.mock.results.map((r) => r.value));
    expect(outcomes.filter((o: { deduplicated?: boolean }) => !o.deduplicated)).toHaveLength(1);
  });
});
