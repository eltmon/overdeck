/**
 * PAN-5169: `claudeConversationPaneChoice` skips pane-choice detection on a
 * Herdr host unless the caller passes a captured screen.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const captureSpy = vi.hoisted(() => vi.fn(async (_sessionName: string, _capture?: unknown) => null));
vi.mock('../../session-pane-choice.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-pane-choice.js')>()),
  captureSessionPaneChoice: captureSpy,
}));

const { claudeConversationPaneChoice } = await import('../conversation-pane-choice.js');

const conv = (overrides: Record<string, unknown> = {}) =>
  ({ name: 'conv-x', tmuxSession: 'conv-x', harness: 'claude-code', ...overrides }) as Parameters<
    typeof claudeConversationPaneChoice
  >[0];

describe('claudeConversationPaneChoice host backend', () => {
  beforeEach(() => {
    captureSpy.mockClear();
  });

  it('resolves null without capturing on a Herdr host with no capture option', async () => {
    await expect(
      claudeConversationPaneChoice(conv(), { hostBackend: async () => 'herdr' }),
    ).resolves.toBeNull();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('captures on a tmux host with no capture option', async () => {
    await claudeConversationPaneChoice(conv(), { hostBackend: async () => 'tmux' });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith('conv-x', undefined);
  });

  it('captures on a Herdr host when a capture function is supplied', async () => {
    const capture = vi.fn(async () => 'screen');
    await claudeConversationPaneChoice(conv(), { hostBackend: async () => 'herdr', capture });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith('conv-x', capture);
  });

  it('resolves null without capturing for a codex conversation', async () => {
    await expect(
      claudeConversationPaneChoice(conv({ harness: 'codex' }), { hostBackend: async () => 'tmux' }),
    ).resolves.toBeNull();
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
