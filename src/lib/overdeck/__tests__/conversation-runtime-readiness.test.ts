/**
 * PAN-3921 FR-10: conversation readiness reads the pane through the host's
 * terminal backend, so a conversation on a Herdr pane (no tmux session) still
 * becomes ready.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readAgentPaneText = vi.hoisted(() => vi.fn(async (_agentId: string, _lines: number, _backend?: unknown, _source?: string) => ''));
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
// Pass-through spies: the real waiters run unless a case stubs them (PAN-4562).
vi.mock('../../agents/runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/runtime-command.js')>();
  return { ...actual, waitForPromptReady: vi.fn(actual.waitForPromptReady), waitForHostReady: vi.fn(actual.waitForHostReady) };
});
vi.mock('../claude-readiness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../claude-readiness.js')>();
  return { ...actual, waitForClaudeReady: vi.fn(actual.waitForClaudeReady) };
});
vi.mock('../../agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents.js')>();
  return { ...actual, waitForReadySignal: vi.fn(actual.waitForReadySignal) };
});

const { waitForConversationRuntimeReady, waitForPiTuiReady } = await import('../conversation-runtime.js');
const { waitForPromptReady, waitForHostReady } = await import('../../agents/runtime-command.js');
const { waitForClaudeReady } = await import('../claude-readiness.js');
const { waitForReadySignal } = await import('../../agents.js');

beforeEach(() => {
  readAgentPaneText.mockReset();
  capturePane.mockClear();
});

describe('conversation readiness on the host backend (PAN-3921)', () => {
  it('reads the ohmypi TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('❯ ');
    await expect(waitForPiTuiReady('conv-x', 5_000)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 40, undefined, 'visible');
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
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 200, undefined, 'visible');
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('waits for the Kimi Code TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('│ > │\ncontext: 0% (0/262k)');
    await expect(waitForPromptReady('conv-x', 'kimi-code', 5)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 80, undefined, 'visible');
    expect(capturePane).not.toHaveBeenCalled();
  });
});

describe('readiness dispatches on the declared readinessKind (PAN-4562)', () => {
  beforeEach(() => {
    vi.mocked(waitForPromptReady).mockClear().mockResolvedValueOnce(true);
    vi.mocked(waitForHostReady).mockClear().mockResolvedValueOnce(undefined);
    vi.mocked(waitForClaudeReady).mockClear().mockResolvedValueOnce(undefined);
    vi.mocked(waitForReadySignal).mockClear().mockResolvedValueOnce(true);
    readAgentPaneText.mockResolvedValue('❯ ');
  });

  const waiterCalls = () => ({
    prompt: vi.mocked(waitForPromptReady).mock.calls.map((call) => call.slice(0, 3)),
    host: vi.mocked(waitForHostReady).mock.calls.map((call) => call.slice(0, 3)),
    claude: vi.mocked(waitForClaudeReady).mock.calls,
    signal: vi.mocked(waitForReadySignal).mock.calls,
  });
  const none = { prompt: [], host: [], claude: [], signal: [] };

  it.each([
    ['muse', 'spawn', { ...none, prompt: [['conv-x', 'muse', 60]] }],
    ['acp', 'spawn', { ...none, host: [['conv-x', 'acp', 30]] }],
    ['opencode', 'spawn', { ...none, host: [['conv-x', 'acp', 30]] }],
    ['prime-agent', 'spawn', { ...none, host: [['conv-x', 'prime-agent', 60]] }],
    ['kimi-code', 'spawn', { ...none, prompt: [['conv-x', 'kimi-code', 30]] }],
    ['codex', 'spawn', none],
    ['claude-code', 'spawn', { ...none, claude: [['conv-x']] }],
    ['claude-code', 'respawn', { ...none, signal: [['conv-x', 30]] }],
  ] as const)('%s (%s) runs only its declared waiter', async (harness, mode, expected) => {
    await waitForConversationRuntimeReady('conv-x', harness, mode);
    expect(waiterCalls()).toEqual(expected);
  });

  it('ohmypi waits on the Pi TUI pane and runs no other waiter', async () => {
    readAgentPaneText.mockClear();
    await waitForConversationRuntimeReady('conv-x', 'ohmypi', 'spawn');
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 40, undefined, 'visible');
    expect(waiterCalls()).toEqual(none);
  });

  it('a muse prompt that never appears fails with the Muse error', async () => {
    vi.mocked(waitForPromptReady).mockReset().mockResolvedValueOnce(false);
    await expect(waitForConversationRuntimeReady('conv-x', 'muse', 'spawn')).rejects.toThrow('Muse Code did not become interactive within 60 seconds');
  });
});
