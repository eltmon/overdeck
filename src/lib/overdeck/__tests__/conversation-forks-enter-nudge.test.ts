import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capturePaneText: vi.fn(),
  deliverAgentMessage: vi.fn(),
  sendKeysAsync: vi.fn(),
}));

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../tmux.js')>(),
  capturePaneText: mocks.capturePaneText,
  sendKeysAsync: mocks.sendKeysAsync,
}));

vi.mock('../../agents.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../agents.js')>(),
  deliverAgentMessage: mocks.deliverAgentMessage,
  waitForReadySignal: vi.fn().mockResolvedValue(true),
}));

import type { LegacyConversation as Conversation } from '../conversations.js';
import * as forks from '../conversation-forks.js';

const conversation = {
  name: 'fork-conv',
  tmuxSession: 'fork-session',
  cwd: '/tmp/fork-conv',
  harness: 'codex',
} as Conversation;

describe('injectForkSummary standalone Enter recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.capturePaneText.mockReset();
    mocks.deliverAgentMessage.mockReset().mockResolvedValue(undefined);
    mocks.sendKeysAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('submits with one standalone Enter when confirmation then reports accepted', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted')
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('accepted');
    mocks.capturePaneText.mockResolvedValue('summary verify line');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('submitted');

    expect(mocks.sendKeysAsync).toHaveBeenCalledOnce();
    expect(mocks.sendKeysAsync).toHaveBeenCalledWith(
      'fork-session',
      'C-m',
      'summary-fork:enter-nudge',
    );
  });

  it('treats a cleared composer as submitted while the runtime mirror lags', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('unknown');
    mocks.capturePaneText
      .mockResolvedValueOnce('summary verify line')
      .mockResolvedValueOnce('empty prompt');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('submitted');

    expect(mocks.sendKeysAsync).toHaveBeenCalledOnce();
  });

  it('returns stranded after two nudges without re-delivering onto a full composer', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('unknown');
    mocks.capturePaneText.mockResolvedValue('summary verify line');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('stranded');

    expect(mocks.sendKeysAsync).toHaveBeenCalledTimes(2);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
  });
});
