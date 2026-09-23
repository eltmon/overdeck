/**
 * PR #3874 review: verification feedback must not vanish with a success log.
 * deliverVerificationFeedback checks the messageAgent outcome and escalates
 * through surfaceIssueFeedbackNeedsYou when delivery is unconfirmed
 * (delivered:false without throwing) or throws — the same contract
 * review-verdict-feedback and uat-failure-feedback already honor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messageAgent: vi.fn(),
  resolveIssueFeedbackTarget: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
  getReviewStatusSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: vi.fn(),

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  messageAgent: mocks.messageAgent,
  getAgentStateSync: vi.fn(),
  setAgentPaused: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));

import { deliverVerificationFeedback } from '../../../../src/lib/cloister/verification-runner.js';

describe('deliverVerificationFeedback (PR #3874 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReviewStatusSync.mockReturnValue(null);
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-3874' });
    mocks.surfaceIssueFeedbackNeedsYou.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('logs success only when the delivery was confirmed', async () => {
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true });

    // Review of #3993 (L2): the door reports whether the message was delivered.
    await expect(deliverVerificationFeedback('PAN-3874', 'gate failed', {}, 'verification')).resolves.toBe(true);

    expect(console.log).toHaveBeenCalledWith('[verification] Sent verification feedback for PAN-3874 to agent-pan-3874');
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('escalates with the reason when delivery is unconfirmed (delivered:false, no throw)', async () => {
    mocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason: 'cannot confirm delivery: no Claude transcript identifiable for agent-pan-3874 (workspace: none, sessionId: none)',
    });

    await expect(deliverVerificationFeedback('PAN-3874', 'gate failed', { gate: 'test' }, 'verification')).resolves.toBe(false);

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Sent verification feedback'));
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3874',
      expect.stringContaining('Feedback delivery to agent-pan-3874 failed: cannot confirm delivery'),
      expect.objectContaining({ specialist: 'verification-gate', gate: 'test' }),
    );
  });

  it('escalates when messageAgent throws', async () => {
    mocks.messageAgent.mockRejectedValue(new Error('MessageDeliveryFailed: pane-dead'));

    await expect(deliverVerificationFeedback('PAN-3874', 'gate failed', {}, 'verification')).resolves.toBe(false);

    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3874',
      expect.stringContaining('Feedback delivery to agent-pan-3874 failed: MessageDeliveryFailed: pane-dead'),
      expect.objectContaining({ specialist: 'verification-gate' }),
    );
  });
});
