/**
 * PAN-4738: Claude Code's one-shot "Make auto mode your default permission
 * mode?" startup dialog focuses a select whose option rows also start with
 * ❯, so a bare-❯ readiness check reports ready while the dialog has focus
 * and the first message is pasted into it. waitForClaudeReady must not count
 * a ❯ while a known blocking startup dialog title is on screen, and must
 * fail the wait with a spawn error naming the dialog if it is still there at
 * the deadline.
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

const NUDGE_PANE = [
  '────────────────────────────────────────',
  ' Make auto mode your default permission mode?',
  '',
  '  Auto mode lets Claude handle permission prompts automatically.',
  '',
  '  ❯ Yes, set auto mode as my default permission mode',
  '    No, keep bypass permissions',
].join('\n');
const COMPOSER_PANE = '────────\n❯ Try "edit index.ts to..."\n────────';

describe('waitForClaudeReady and the auto-default nudge', () => {
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

  it('does not report ready while the auto-default nudge has focus', async () => {
    readAgentPaneText.mockResolvedValue(NUDGE_PANE);
    isAlive.mockResolvedValue({ alive: true, paneAlive: true });
    const ready = waitForClaudeReady('conv-nudge');
    const settled = expect(ready).rejects.toThrow(
      /Make auto mode your default permission mode\?[\s\S]*send the message again/,
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
  });

  it('resolves once the nudge is answered and the composer shows', async () => {
    readAgentPaneText
      .mockResolvedValueOnce(NUDGE_PANE)
      .mockResolvedValueOnce(NUDGE_PANE)
      .mockResolvedValue(COMPOSER_PANE);
    const ready = waitForClaudeReady('conv-nudge');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(ready).resolves.toBeUndefined();
  });

  it('reports an exited harness before the dialog', async () => {
    readAgentPaneText.mockResolvedValue(NUDGE_PANE);
    isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    const ready = waitForClaudeReady('conv-nudge');
    const settled = expect(ready).rejects.toThrow('The conversation process exited before it was ready');
    await vi.advanceTimersByTimeAsync(31_000);
    await settled;
  });
});
