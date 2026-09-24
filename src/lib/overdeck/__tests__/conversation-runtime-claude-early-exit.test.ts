import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capturePane = vi.fn(async (_name: string, _lines?: number) => '');
const isHarnessProcessAlive = vi.fn(async (_name: string) => true);

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane,
  isHarnessProcessAlive,
}));

const { waitForConversationRuntimeReady } = await import('../conversation-runtime.js');
const { CONVERSATION_SESSION_ENDED_MARKER } = await import('../../launcher-generator.js');

// PAN-3827: a claude binary that dies on launch (unsupported --model, no
// account access) leaves the launcher's keep-alive loop holding the pane, so
// the conversation read as live and empty and the dashboard greeted the user
// with "How can I help you?". The readiness wait must throw instead, so the
// spawn path records the exit reason as spawnError.
describe('waitForConversationRuntimeReady — Claude Code exits before its prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturePane.mockReset();
    isHarnessProcessAlive.mockReset();
    isHarnessProcessAlive.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws the harness output as the exit reason once the launcher reports the session ended', async () => {
    capturePane
      .mockResolvedValueOnce('')
      .mockResolvedValue([
        'Error: model claude-fable-5-1 requires Claude Code 2.1.255 or newer',
        '',
        CONVERSATION_SESSION_ENDED_MARKER,
      ].join('\n'));

    const ready = waitForConversationRuntimeReady('conv-early-exit', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow(
      'Claude Code exited before writing a transcript. Last output: Error: model claude-fable-5-1 requires Claude Code 2.1.255 or newer',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  it('throws on timeout when no harness process is left in the pane', async () => {
    capturePane.mockResolvedValue('');
    isHarnessProcessAlive.mockResolvedValue(false);

    const ready = waitForConversationRuntimeReady('conv-gone', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow('Claude Code exited before writing a transcript, with no output in its pane.');
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
  });

  it('only warns on timeout while the harness is still running', async () => {
    capturePane.mockResolvedValue('loading MCP servers…');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ready = waitForConversationRuntimeReady('conv-slow', 'claude-code', 'spawn');
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(ready).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Timed out waiting for Claude Code prompt'));
    warn.mockRestore();
  });

  it('resolves once the prompt renders', async () => {
    capturePane.mockResolvedValue('╭─\n│ ❯ \n╰─');
    await expect(waitForConversationRuntimeReady('conv-ready', 'claude-code', 'spawn')).resolves.toBeUndefined();
  });
});
