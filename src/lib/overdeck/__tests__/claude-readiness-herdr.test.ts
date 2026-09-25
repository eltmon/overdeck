/**
 * PAN-3921 x PAN-3827: on a Herdr host the Claude Code readiness wait reads the
 * visible screen through the backend and asks the backend-aware liveness door
 * at its deadline. A confirmed exit is a spawn error; an indeterminate probe is
 * not, and tmux is never asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LivenessVerdict } from '../../agents/liveness.js';

const readAgentPaneText = vi.hoisted(() => vi.fn(async (_id: string, _lines: number, _backend?: unknown, _source?: string) => ''));
const isAlive = vi.hoisted(() => vi.fn(async (_id: string, _deps?: unknown): Promise<LivenessVerdict> => ({ alive: true, paneAlive: true })));
const tmuxExecAsync = vi.hoisted(() => vi.fn(async () => ({ stdout: '' })));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/select.js')>()),
  hostTerminalBackendName: vi.fn(async () => 'herdr'),
}));
vi.mock('../../terminal-backends/agent-pane-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/agent-pane-io.js')>()),
  readAgentPaneText,
}));
vi.mock('../../agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/liveness.js')>()),
  isAlive,
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  tmuxExecAsync,
}));

const { waitForClaudeReady } = await import('../claude-readiness.js');

describe('waitForClaudeReady on a Herdr host', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readAgentPaneText.mockReset();
    readAgentPaneText.mockResolvedValue('');
    isAlive.mockReset();
    tmuxExecAsync.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the visible screen through the backend and returns on the prompt', async () => {
    readAgentPaneText.mockResolvedValueOnce('').mockResolvedValue('❯ ');
    const ready = waitForClaudeReady('conv-h');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(ready).resolves.toBeUndefined();
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-h', 200, undefined, 'visible');
    expect(isAlive).not.toHaveBeenCalled();
  });

  it('throws a spawn error when the pane is gone at the deadline', async () => {
    readAgentPaneText
      .mockResolvedValueOnce('Error: model not available')
      .mockRejectedValue(new Error('herdr holds no pane for conv-h'));
    isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    const ready = waitForClaudeReady('conv-h');
    const settled = expect(ready).rejects.toThrow(
      'The conversation process exited before it was ready. Last output: Error: model not available',
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
    expect(isAlive).toHaveBeenCalledWith('conv-h', { backend: 'herdr' });
    expect(tmuxExecAsync).not.toHaveBeenCalled();
  });

  it('records nothing when the Herdr probe is indeterminate', async () => {
    isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ready = waitForClaudeReady('conv-h');
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(ready).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('harness probe: unknown'));
    warn.mockRestore();
  });
});
