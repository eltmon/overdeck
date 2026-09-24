/**
 * PAN-3921 FR-10: conversation readiness reads the pane through the host's
 * terminal backend, so a conversation on a Herdr pane (no tmux session) still
 * becomes ready.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readAgentPaneText = vi.hoisted(() => vi.fn(async (_agentId: string, _lines: number) => ''));
const capturePane = vi.hoisted(() => vi.fn(async () => ''));

vi.mock('../../terminal-backends/agent-pane-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/agent-pane-io.js')>()),
  readAgentPaneText,
  probeAgentPane: vi.fn(async () => 'present'),
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane,
}));

const { waitForConversationRuntimeReady, waitForPiTuiReady } = await import('../conversation-runtime.js');
const { waitForPromptReady } = await import('../../agents/runtime-command.js');

beforeEach(() => {
  readAgentPaneText.mockReset();
  capturePane.mockClear();
});

describe('conversation readiness on the host backend (PAN-3921)', () => {
  it('reads the ohmypi TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('❯ ');
    await expect(waitForPiTuiReady('conv-x', 5_000)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 40);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('keeps polling while the pane cannot be read yet', async () => {
    readAgentPaneText
      .mockRejectedValueOnce(new Error('herdr holds no pane for conv-x'))
      .mockResolvedValue('❯ ');
    await expect(waitForPiTuiReady('conv-x', 5_000)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledTimes(2);
  });

  it('waits for the Claude Code prompt through the backend pane reader on spawn', async () => {
    readAgentPaneText.mockResolvedValue('❯ ');
    await waitForConversationRuntimeReady('conv-x', 'claude-code', 'spawn');
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 200);
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('waits for the Kimi Code TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('│ > │\ncontext: 0% (0/262k)');
    await expect(waitForPromptReady('conv-x', 'kimi-code', 5)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 80);
    expect(capturePane).not.toHaveBeenCalled();
  });
});
