/**
 * PAN-4030 acceptance: a failed browser UAT reaches the work agent again.
 * #4035 acceptance: once per failing head per verdict episode, on Herdr and
 * on tmux.
 *
 * PAN-3917 deleted the only caller of the UAT relay. The UAT result is now
 * observed in `pan admin specialists done` (test role `--uat-status`, or the
 * uat role), so these tests drive that command with the REAL relay and the
 * REAL pipeline journal (in a temp workspace), and only fake the edges: the
 * forge, the feedback file, the target resolver and the delivery transport.
 * Each `doneCommand` call models one fresh CLI process: nothing in memory
 * survives between verdicts except what the transport itself remembers.
 *
 * The two backends differ in exactly that memory. On Herdr the whole delivery
 * is `backend.prompt`, which remembers message ids only inside one process,
 * so a repeat run is never reported `deduplicated`. On tmux the keyed tier
 * (tmux user options / PTY supervisor) holds the key across processes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  workspace: { path: '' },
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
vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipelineSync: vi.fn() }));
vi.mock('../../../../src/lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => mocks.workspace.path),
}));
vi.mock('../../../../src/lib/projects.js', () => ({ resolveProjectFromIssueSync: vi.fn(() => null) }));
vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({ writeFeedbackFile: mocks.writeFeedbackFile }));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));
vi.mock('../../../../src/lib/agents/messaging.js', () => ({ messageAgent: mocks.messageAgent }));

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { doneCommand } from '../../../../src/cli/commands/specialists/done.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';

const FEEDBACK_PATH = '/project/workspaces/feature-pan-4030/.pan/feedback/001-uat-agent-failed.md';

type DeliveryOutcome = { delivered: boolean; queuedToMail: boolean; deduplicated?: boolean };

/** One `pan admin specialists done` invocation in a fresh process. */
async function reportUat(uatStatus: 'passed' | 'failed', uatNotes: string, testedSha?: string): Promise<void> {
  await doneCommand('test', 'pan-4030', {
    status: 'passed', notes: 'gates green', uatStatus, uatNotes, ...(testedSha ? { testedSha } : {}),
  });
}

describe('PAN-4030: UAT failure feedback reaches the work agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspace.path = mkdtempSync(join(tmpdir(), 'done-uat-feedback-'));
    mocks.deliveredKeys.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getPrFacts.mockResolvedValue({ issueId: 'PAN-4030', forge: 'github', open: true, headSha: 'sha-a' });
    mocks.writeFeedbackFile.mockResolvedValue({ success: true, filePath: FEEDBACK_PATH });
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
    rmSync(mocks.workspace.path, { recursive: true, force: true });
  });

  it('delivers the UAT notes to a live work agent exactly once per failing anchor', async () => {
    await reportUat('failed', 'criterion 2: export button missing');
    await reportUat('failed', 'criterion 2: export button missing');

    // #4035: the second run reads the journal and never reaches the transport.
    expect(mocks.messageAgent).toHaveBeenCalledTimes(1);
    expect(mocks.resolveIssueFeedbackTarget).toHaveBeenCalledTimes(1);
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
    const latest = await mocks.messageAgent.mock.results[1].value;
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

  it('anchors on the tested commit: a push during a run does not swallow the next failure', async () => {
    // UAT runs on A; the work agent pushes B meanwhile, so the PR head is B
    // when the verdict for A lands.
    mocks.getPrFacts.mockResolvedValue({ issueId: 'PAN-4030', forge: 'github', open: true, headSha: 'bbbbbbb' });
    await reportUat('failed', 'criterion 1 unmet on A', 'aaaaaaa');
    // The next cycle tests B and fails there too.
    await reportUat('failed', 'criterion 1 still unmet on B', 'bbbbbbb');

    const outcomes = await Promise.all(mocks.messageAgent.mock.results.map((r) => r.value));
    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((o: { deduplicated?: boolean }) => o.deduplicated)).toHaveLength(0);
    expect(mocks.messageAgent.mock.calls[1][1]).toContain('MUST READ');
  });

  describe.each([
    {
      backend: 'herdr',
      // backend.prompt: message ids live only as long as the process, so a
      // fresh process never learns the key was used.
      deliver: async (): Promise<DeliveryOutcome> => ({ delivered: true, queuedToMail: false }),
    },
    {
      backend: 'tmux',
      // Keyed tier: the key outlives the CLI process.
      deliver: async (opts: { dedupKey?: string }): Promise<DeliveryOutcome> => {
        if (opts.dedupKey && mocks.deliveredKeys.has(opts.dedupKey)) {
          return { delivered: true, queuedToMail: false, deduplicated: true };
        }
        if (opts.dedupKey) mocks.deliveredKeys.add(opts.dedupKey);
        return { delivered: true, queuedToMail: false };
      },
    },
  ])('#4035 on $backend', ({ deliver }) => {
    beforeEach(() => {
      mocks.messageAgent.mockImplementation(
        async (_id: string, _msg: string, _caller: string, opts: { dedupKey?: string }) => deliver(opts),
      );
    });

    async function freshDeliveries(): Promise<number> {
      const outcomes: DeliveryOutcome[] = await Promise.all(mocks.messageAgent.mock.results.map((r) => r.value));
      return outcomes.filter((o) => o.delivered && !o.deduplicated).length;
    }

    it('two done runs with the same failing head deliver once', async () => {
      await reportUat('failed', 'criterion 1 unmet', 'aaaaaaa');
      await reportUat('failed', 'criterion 1 unmet', 'aaaaaaa');

      expect(await freshDeliveries()).toBe(1);
      expect(mocks.messageAgent).toHaveBeenCalledTimes(1);
      const delivered = readPipelineJournal(mocks.workspace.path).filter((e) => e.type === 'feedback.delivered');
      expect(delivered).toHaveLength(1);
    });

    it('fail, pass, fail on the same head delivers twice', async () => {
      await reportUat('failed', 'criterion 1 unmet', 'aaaaaaa');
      await reportUat('passed', 'all observed', 'aaaaaaa');
      await reportUat('failed', 'criterion 1 flaked back', 'aaaaaaa');

      expect(await freshDeliveries()).toBe(2);
      const keys = mocks.messageAgent.mock.calls.map((call) => (call[3] as { dedupKey?: string }).dedupKey);
      expect(new Set(keys).size).toBe(2);
      expect(readPipelineJournal(mocks.workspace.path).map((e) => e.type)).toEqual([
        'uat.verdict', 'feedback.delivered', 'uat.verdict', 'uat.verdict', 'feedback.delivered',
      ]);
    });
  });
});
