import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capturePane = vi.fn(async (_name: string, _lines?: number) => '');
// The deadline probe's tmux calls: `has-session` then `list-panes`.
const hasSession = vi.fn(async (): Promise<unknown> => ({ stdout: '' }));
const listPanes = vi.fn(async (): Promise<unknown> => ({ stdout: '100\n' }));
const tmuxExecAsync = vi.fn(async (args: string[]) => (args[0] === 'has-session' ? hasSession() : listPanes()));
// Pane 100 is the launcher shell; by default a live claude runs under it.
const readProcessTable = vi.fn(async () => '100 1 bash\n110 100 claude\n');

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane,
  tmuxExecAsync,
}));
vi.mock('../../tmux-process-tree.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux-process-tree.js')>()),
  readProcessTable,
}));

function tmuxFailure(stderr: string): Error {
  return Object.assign(new Error(`tmux failed: ${stderr}`), { code: 1, stderr });
}

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
    hasSession.mockReset();
    hasSession.mockResolvedValue({ stdout: '' });
    listPanes.mockReset();
    listPanes.mockResolvedValue({ stdout: '100\n' });
    readProcessTable.mockReset();
    readProcessTable.mockResolvedValue('100 1 bash\n110 100 claude\n');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      'The conversation process exited before it was ready. Last output: Error: model claude-fable-5-1 requires Claude Code 2.1.255 or newer',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  // Review of #4137 (finding 3): the 84-character marker soft-wraps in a pane
  // narrower than that, and capture-pane returns it split across two lines.
  it('recognizes the marker when a narrow pane wraps it, and keeps its fragments out of the reason', async () => {
    const wrapped = [
      CONVERSATION_SESSION_ENDED_MARKER.slice(0, 40),
      CONVERSATION_SESSION_ENDED_MARKER.slice(40, 80),
      CONVERSATION_SESSION_ENDED_MARKER.slice(80),
    ];
    capturePane.mockResolvedValue(['Error: unknown model claude-nope', '', ...wrapped].join('\n'));

    const ready = waitForConversationRuntimeReady('conv-narrow', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow(/exited before .*\. Last output: Error: unknown model claude-nope$/);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  it('reports the exit when the marker and a dialog ❯ share the capture', async () => {
    capturePane.mockResolvedValue([
      '❯ 1. Yes, I trust this folder',
      'Error: model claude-nope is not available',
      CONVERSATION_SESSION_ENDED_MARKER,
    ].join('\n'));

    const ready = waitForConversationRuntimeReady('conv-dialog-exit', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow('Last output: ❯ 1. Yes, I trust this folder | Error: model claude-nope is not available');
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });

  it('throws on timeout when the process table shows no harness left in the pane', async () => {
    capturePane.mockResolvedValue('');
    readProcessTable.mockResolvedValue('100 1 bash\n130 100 sleep\n');

    const ready = waitForConversationRuntimeReady('conv-gone', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow('The conversation process exited before it was ready, with no output in its pane.');
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
  });

  // Review of #4137 (finding 4): a launcher that exits on an unreadable
  // launch-context file never starts Claude Code and takes the session with it.
  it('reports a launcher exit with its last output once the tmux session is gone', async () => {
    capturePane
      .mockResolvedValueOnce('Required launch context is unreadable: /home/u/.overdeck/context.md')
      .mockResolvedValue('');
    hasSession.mockRejectedValue(tmuxFailure("can't find session: conv-vanished"));

    const ready = waitForConversationRuntimeReady('conv-vanished', 'claude-code', 'spawn');
    const settled = expect(ready).rejects.toThrow(
      'The conversation process exited before it was ready; its tmux session is gone, so the launcher itself exited. '
        + 'Last output: Required launch context is unreadable: /home/u/.overdeck/context.md',
    );
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
  });

  // Review of #4137 (finding 1): a failed tmux or ps call at the deadline says
  // nothing about the harness, so a healthy slow start must not become a
  // permanent spawn error.
  it.each([
    ['list-panes fails', () => listPanes.mockRejectedValue(tmuxFailure('lost server'))],
    ['has-session errors without confirming the session is gone', () => hasSession.mockRejectedValue(tmuxFailure('error connecting to /tmp/tmux-1000/overdeck (Connection refused)'))],
    ['ps fails', () => readProcessTable.mockRejectedValue(new Error('ps: spawn EAGAIN'))],
  ])('only warns on timeout when the liveness probe fails (%s)', async (_label, failProbe) => {
    capturePane.mockResolvedValue('loading MCP servers…');
    failProbe();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ready = waitForConversationRuntimeReady('conv-probe-failed', 'claude-code', 'spawn');
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(ready).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Timed out waiting for Claude Code prompt'));
  });

  it('resolves once the prompt renders', async () => {
    capturePane.mockResolvedValue('╭─\n│ ❯ \n╰─');
    await expect(waitForConversationRuntimeReady('conv-ready', 'claude-code', 'spawn')).resolves.toBeUndefined();
  });
});
