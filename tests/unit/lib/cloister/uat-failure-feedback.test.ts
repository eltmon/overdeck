import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  writeFeedbackFile: vi.fn(),
  resolveIssueFeedbackTarget: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
  messageAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mocks.writeFeedbackFile,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));

vi.mock('../../../../src/lib/agents/messaging.js', () => ({
  messageAgent: mocks.messageAgent,
}));

import {
  clearUatFailureFeedbackAnchor,
  MAX_UAT_FAILURE_FEEDBACK_ANCHORS,
  relayUatFailureFeedback,
  resetUatFailureFeedbackStateForTests,
} from '../../../../src/lib/cloister/uat-failure-feedback.js';

describe('relayUatFailureFeedback', () => {
  const feedbackPath = '/tmp/workspace/.pan/feedback/001-uat-agent-failed.md';

  beforeEach(() => {
    vi.clearAllMocks();
    resetUatFailureFeedbackStateForTests();
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);
    mocks.writeFeedbackFile.mockReturnValue(Effect.succeed({
      success: true,
      filePath: feedbackPath,
      relativePath: '.pan/feedback/001-uat-agent-failed.md',
    }));
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-3575' });
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    mocks.surfaceIssueFeedbackNeedsYou.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('writes UAT notes and delivers the feedback file to the resolved work agent', async () => {
    const result = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'pan-3575',
      uatNotes: 'The save button did not persist the record.',
      workspacePath: '/tmp/workspace',
      anchor: 'head-one',
    }));

    expect(result).toEqual({
      feedbackPath,
      agentMessageSent: true,
      needsYouSurfaced: false,
      deduplicated: false,
    });
    expect(mocks.writeFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-3575',
      workspacePath: '/tmp/workspace',
      specialist: 'uat-agent',
      outcome: 'failed',
      markdownBody: expect.stringContaining('The save button did not persist the record.'),
    }));
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-pan-3575',
      expect.stringContaining(`MUST READ: ${feedbackPath}`),
      'internal',
      { owesRework: true },
    );
  });

  it('surfaces needs-you instead of silently returning when no feedback target is available', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({
      needsYou: true,
      reason: 'No live feedback target for PAN-3575',
    });

    const result = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'PAN-3575',
      anchor: 'head-one',
    }));

    expect(result).toEqual(expect.objectContaining({
      agentMessageSent: false,
      needsYouSurfaced: true,
    }));
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3575',
      'No live feedback target for PAN-3575',
      { specialist: 'uat-agent', feedbackPath },
    );
  });

  it('escalates a resolved agent delivery failure with the agent id and error', async () => {
    mocks.messageAgent.mockRejectedValue(new Error('PTY supervisor unavailable'));

    const result = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'PAN-3575',
      anchor: 'head-one',
    }));

    expect(result).toEqual(expect.objectContaining({
      agentMessageSent: false,
      needsYouSurfaced: true,
    }));
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3575',
      'Feedback delivery to agent-pan-3575 failed: PTY supervisor unavailable',
      { specialist: 'uat-agent', feedbackPath },
    );
  });

  it('surfaces needs-you when delivery resolves without delivering the feedback', async () => {
    mocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: false,
      reason: 'target session is unavailable',
    });

    const result = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'PAN-3575',
      anchor: 'head-one',
    }));

    expect(result).toEqual(expect.objectContaining({
      agentMessageSent: false,
      needsYouSurfaced: true,
    }));
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3575',
      'Feedback delivery to agent-pan-3575 failed: target session is unavailable',
      { specialist: 'uat-agent', feedbackPath },
    );
  });

  it('surfaces needs-you when feedback target resolution fails after persistence', async () => {
    mocks.resolveIssueFeedbackTarget.mockRejectedValue(new Error('agent registry unavailable'));

    const result = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'PAN-3575',
      anchor: 'head-one',
    }));

    expect(result).toEqual(expect.objectContaining({
      feedbackPath,
      agentMessageSent: false,
      needsYouSurfaced: true,
    }));
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3575',
      'Could not resolve UAT feedback target: agent registry unavailable',
      { specialist: 'uat-agent', feedbackPath },
    );
  });

  it('deduplicates repeated verdict anchors and accepts a later anchor', async () => {
    const first = await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-one' }));
    const duplicate = await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-one' }));
    const later = await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-two' }));

    expect(first.deduplicated).toBe(false);
    expect(duplicate).toEqual({
      agentMessageSent: false,
      needsYouSurfaced: false,
      deduplicated: true,
    });
    expect(later.deduplicated).toBe(false);
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(2);
  });

  it('bounds dedup state so terminal-cleanup delays cannot retain historical failures indefinitely', async () => {
    for (let index = 0; index <= MAX_UAT_FAILURE_FEEDBACK_ANCHORS; index++) {
      await Effect.runPromise(relayUatFailureFeedback({
        issueId: `PAN-${index}`,
        anchor: `head-${index}`,
      }));
    }

    const replayed = await Effect.runPromise(relayUatFailureFeedback({
      issueId: 'PAN-0',
      anchor: 'head-0',
    }));

    expect(replayed.deduplicated).toBe(false);
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(MAX_UAT_FAILURE_FEEDBACK_ANCHORS + 2);
  });

  it('clears an anchor for a new UAT cycle and retries a failed feedback write', async () => {
    await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-one' }));
    clearUatFailureFeedbackAnchor('pan-3575');
    await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-one' }));
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(2);

    resetUatFailureFeedbackStateForTests();
    mocks.writeFeedbackFile.mockReturnValue(Effect.succeed({ success: false, error: 'disk unavailable' }));
    const failed = await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-two' }));
    const retry = await Effect.runPromise(relayUatFailureFeedback({ issueId: 'PAN-3575', anchor: 'head-two' }));

    expect(failed).toEqual({ agentMessageSent: false, needsYouSurfaced: false, deduplicated: false });
    expect(retry).toEqual({ agentMessageSent: false, needsYouSurfaced: false, deduplicated: false });
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(4);
  });
});
