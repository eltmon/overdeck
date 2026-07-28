import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capturePaneTextMock, deliverAgentMessageMock } = vi.hoisted(() => ({
  capturePaneTextMock: vi.fn(),
  deliverAgentMessageMock: vi.fn(),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  capturePaneText: capturePaneTextMock,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  deliverAgentMessage: deliverAgentMessageMock,
}));

import { deliverResumeContractUnlessGated } from '../../../../src/lib/overdeck/resume-contract-delivery.js';

const RESUME_GATE_MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

const CLEAR_COMPOSER = [
  '● All done — the full task list is closed out.',
  '',
  '─────────────────────────────',
  '❯ ',
  '─────────────────────────────',
].join('\n');

const SESSION = 'conv-test';
const CONTRACT = 'CONVERSATION RESUME: operator-triggered';
const CALLER = 'conversation-resume';
const METHOD = 'auto' as const;

describe('deliverResumeContractUnlessGated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliverAgentMessageMock.mockResolvedValue({ ok: true, path: 'supervisor' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('skips delivery when the pane shows a blocking choice menu', async () => {
    capturePaneTextMock.mockResolvedValue(RESUME_GATE_MENU);

    await expect(deliverResumeContractUnlessGated(SESSION, CONTRACT, CALLER, METHOD))
      .resolves.toBe('skipped-gated');
    expect(deliverAgentMessageMock).not.toHaveBeenCalled();
  });

  it('delivers the contract through the requested method on a clear pane', async () => {
    capturePaneTextMock.mockResolvedValue(CLEAR_COMPOSER);

    await expect(deliverResumeContractUnlessGated(SESSION, CONTRACT, CALLER, METHOD))
      .resolves.toBe('delivered');
    expect(deliverAgentMessageMock).toHaveBeenCalledOnce();
    expect(deliverAgentMessageMock).toHaveBeenCalledWith(SESSION, CONTRACT, CALLER, METHOD);
  });

  it('fails open and attempts delivery when pane capture rejects', async () => {
    capturePaneTextMock.mockRejectedValue(new Error('tmux unavailable'));

    await expect(deliverResumeContractUnlessGated(SESSION, CONTRACT, CALLER, METHOD))
      .resolves.toBe('delivered');
    expect(deliverAgentMessageMock).toHaveBeenCalledWith(SESSION, CONTRACT, CALLER, METHOD);
  });

  it('returns failed without throwing when contract delivery rejects', async () => {
    capturePaneTextMock.mockResolvedValue(CLEAR_COMPOSER);
    deliverAgentMessageMock.mockRejectedValue(new Error('delivery unavailable'));

    await expect(deliverResumeContractUnlessGated(SESSION, CONTRACT, CALLER, METHOD))
      .resolves.toBe('failed');
    expect(console.error).toHaveBeenCalledWith(
      `[conversations] resume contract delivery failed for ${SESSION}:`,
      'delivery unavailable',
    );
  });
});
