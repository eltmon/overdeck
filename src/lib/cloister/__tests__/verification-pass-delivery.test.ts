/**
 * The verification PASS message (PAN-3705).
 *
 * The work agent used to be told to "confirm the pipeline state change" with
 * nothing on disk that said one had happened, so it polled `pan show` for ten
 * minutes. A pass now reaches it directly — and, unlike a failure, owes no
 * rework and never escalates to the operator.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveIssueFeedbackTarget: vi.fn(),
  messageAgent: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
}));

vi.mock('../feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));
vi.mock('../../agents.js', () => ({
  messageAgent: mocks.messageAgent,
  clearAgentPaused: vi.fn(),
  getAgentState: vi.fn(() => null),
  setAgentPaused: vi.fn(),
  stopAgent: vi.fn(),
}));

const { deliverVerificationPass } = await import('../verification-runner.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('deliverVerificationPass', () => {
  it('messages the work agent without owesRework', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-3705' });
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });

    await deliverVerificationPass('PAN-3705', 'a7b64f7c', 'request-review');

    expect(mocks.messageAgent).toHaveBeenCalledTimes(1);
    const [agentId, message, channel, options] = mocks.messageAgent.mock.calls[0];
    expect(agentId).toBe('agent-pan-3705');
    expect(channel).toBe('internal');
    expect(options).toBeUndefined();
    expect(message).toContain('VERIFICATION PASSED for PAN-3705 (HEAD a7b64f7c)');
    expect(message).toContain('The review convoy is starting now.');
    expect(message).toContain('end your turn and wait');
  });

  it('omits the head when verification could not read one', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-1' });
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });

    await deliverVerificationPass('PAN-1', undefined, 'request-review');

    expect(mocks.messageAgent.mock.calls[0][1]).toContain('VERIFICATION PASSED for PAN-1. The review convoy');
  });

  it('never surfaces needs-you when there is no agent to tell', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ reason: 'no running work agent' });

    await deliverVerificationPass('PAN-1', 'abc12345', 'request-review');

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('never throws and never escalates when delivery is refused', async () => {
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-1' });
    mocks.messageAgent.mockResolvedValue({ delivered: false, queuedToMail: false, reason: 'session gone' });

    await expect(deliverVerificationPass('PAN-1', 'abc12345', 'request-review')).resolves.toBeUndefined();
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('never throws when the target lookup itself fails', async () => {
    mocks.resolveIssueFeedbackTarget.mockRejectedValue(new Error('tracker unreachable'));

    await expect(deliverVerificationPass('PAN-1', 'abc12345', 'request-review')).resolves.toBeUndefined();
    expect(mocks.surfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });
});
