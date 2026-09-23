import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  relayUatFailureFeedbackPromise,
  resetUatFailureFeedbackStateForTests,
  UAT_AMBIGUOUS_DELIVERY_RETRY_MS,
  uatFeedbackDedupKey,
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
      dedupKey: uatFeedbackDedupKey('PAN-3575', 'head-one'),
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
      { owesRework: true, feedbackRedelivery: true, dedupKey: uatFeedbackDedupKey('PAN-3575', 'head-one') },
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
      dedupKey: uatFeedbackDedupKey('PAN-3575', 'head-one'),
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

    const key = uatFeedbackDedupKey('PAN-3575', 'head-two');
    expect(failed).toEqual({ agentMessageSent: false, needsYouSurfaced: false, deduplicated: false, dedupKey: key });
    expect(retry).toEqual({ agentMessageSent: false, needsYouSurfaced: false, deduplicated: false, dedupKey: key });
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.writeFeedbackFile).toHaveBeenCalledTimes(4);
  });

  describe('PAN-4030: once per failing anchor across CLI processes', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keys delivery on the anchor: stable for one anchor, distinct across anchors and issues', () => {
      const key = uatFeedbackDedupKey('PAN-3575', 'abc123');
      expect(key).toMatch(/^uat-feedback:pan-3575:[0-9a-f]{16}$/);
      expect(uatFeedbackDedupKey('pan-3575', 'abc123')).toBe(key);
      expect(uatFeedbackDedupKey('PAN-3575', 'def456')).not.toBe(key);
      expect(uatFeedbackDedupKey('PAN-9999', 'abc123')).not.toBe(key);
    });

    it('a repeat whose key the delivery store already holds is deduplicated, not re-sent or escalated', async () => {
      // A fresh process (empty in-memory map) re-relays the same anchor: the
      // keyed store reports the message was already delivered.
      mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false, deduplicated: true });

      const result = await relayUatFailureFeedbackPromise({
        issueId: 'PAN-3575',
        uatNotes: 'Criterion 2 unmet.',
        anchor: 'abc123',
      });

      expect(result).toEqual(expect.objectContaining({
        agentMessageSent: false,
        needsYouSurfaced: false,
        deduplicated: true,
      }));
      expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
    });

    it('omits the key when no anchor is known', async () => {
      const result = await relayUatFailureFeedbackPromise({ issueId: 'PAN-3575', uatNotes: 'x' });

      expect(result.dedupKey).toBeUndefined();
      expect(mocks.messageAgent).toHaveBeenCalledWith(
        'agent-pan-3575',
        expect.any(String),
        'internal',
        { owesRework: true, feedbackRedelivery: true },
      );
    });

    it('retries an ambiguous keyed delivery with the same key', async () => {
      vi.useFakeTimers();
      const ambiguous = Object.assign(new Error('socket closed mid-response'), { name: 'AmbiguousKeyedDeliveryError' });
      mocks.messageAgent
        .mockRejectedValueOnce(ambiguous)
        .mockResolvedValueOnce({ delivered: true, queuedToMail: false });

      const pending = relayUatFailureFeedbackPromise({ issueId: 'PAN-3575', uatNotes: 'x', anchor: 'abc123' });
      await vi.advanceTimersByTimeAsync(UAT_AMBIGUOUS_DELIVERY_RETRY_MS);
      const result = await pending;

      expect(result.agentMessageSent).toBe(true);
      expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
      const key = uatFeedbackDedupKey('PAN-3575', 'abc123');
      for (const call of mocks.messageAgent.mock.calls) {
        expect(call[3]).toEqual(expect.objectContaining({ dedupKey: key }));
      }
    });

    it('falls back to one unkeyed delivery when the transport cannot enforce a key', async () => {
      mocks.messageAgent
        .mockRejectedValueOnce(new Error('MessageDeliveryFailed: keyed delivery failed for agent-pan-3575 (internal): the ACP tier cannot enforce a dedup key'))
        .mockResolvedValueOnce({ delivered: true, queuedToMail: false });

      const result = await relayUatFailureFeedbackPromise({ issueId: 'PAN-3575', uatNotes: 'x', anchor: 'abc123' });

      expect(result.agentMessageSent).toBe(true);
      expect(mocks.messageAgent).toHaveBeenLastCalledWith(
        'agent-pan-3575',
        expect.any(String),
        'internal',
        { owesRework: true, feedbackRedelivery: true },
      );
    });
  });
});
