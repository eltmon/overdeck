import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const tmuxMocks = vi.hoisted(() => ({
  sendEscapeKeyAsync: vi.fn(),
  sendKeys: vi.fn(),
  host: 'tmux' as 'tmux' | 'herdr',
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'herdr' })),
}));

vi.mock('../../src/lib/tmux.js', () => ({
  sendEscapeKeyAsync: tmuxMocks.sendEscapeKeyAsync,
  sendKeys: tmuxMocks.sendKeys,
}));

vi.mock('../../src/lib/terminal-backends/select.js', () => ({
  hostTerminalBackendName: vi.fn(async () => tmuxMocks.host),
}));

describe('sendGracefulRestartWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tmuxMocks.host = 'tmux';
    tmuxMocks.sendEscapeKeyAsync.mockResolvedValue(undefined);
    tmuxMocks.sendKeys.mockReturnValue(Effect.void);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each(['claude-code', 'codex'] as const)('sends Escape twice before the 60s warning for %s', async (harness) => {
    const { GRACEFUL_RESTART_GRACE_MS, sendGracefulRestartWarning } = await import('../../src/lib/graceful-restart.js');

    const result = sendGracefulRestartWarning('agent-pan-1787', harness, '/tmp/workspace');
    await vi.advanceTimersByTimeAsync(0);

    expect(tmuxMocks.sendEscapeKeyAsync).toHaveBeenCalledWith('agent-pan-1787', 2);
    expect(tmuxMocks.sendKeys).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tmuxMocks.sendKeys).toHaveBeenCalledWith('agent-pan-1787', expect.stringContaining('Restarting in 60s'));

    await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS - 1);
    let resolved = false;
    result.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await result;
  });

  it('does not send Escape for pi but still waits the 60s grace period', async () => {
    const { GRACEFUL_RESTART_GRACE_MS, sendGracefulRestartWarning } = await import('../../src/lib/graceful-restart.js');

    const result = sendGracefulRestartWarning('agent-pan-1787', 'pi', '/tmp/workspace');
    await vi.advanceTimersByTimeAsync(0);

    expect(tmuxMocks.sendEscapeKeyAsync).not.toHaveBeenCalled();
    expect(tmuxMocks.sendKeys).toHaveBeenCalledWith('agent-pan-1787', expect.stringContaining('Restarting in 60s'));

    await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS);
    await result;
  });

  it('delivers the warning through the backend-aware door on a Herdr host (PAN-3960)', async () => {
    tmuxMocks.host = 'herdr';
    const { GRACEFUL_RESTART_GRACE_MS, sendGracefulRestartWarning } = await import('../../src/lib/graceful-restart.js');

    const result = sendGracefulRestartWarning('agent-pan-3960', 'claude-code', '/tmp/workspace', tmuxMocks.deliverAgentMessage);
    await vi.advanceTimersByTimeAsync(0);

    expect(tmuxMocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-3960',
      expect.stringContaining('Restarting in 60s'),
      'graceful-restart-warning',
    );
    expect(tmuxMocks.sendEscapeKeyAsync).not.toHaveBeenCalled();
    expect(tmuxMocks.sendKeys).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS);
    await result;
  });

  it('preserves the missing-harness path without sending Escape', async () => {
    const { GRACEFUL_RESTART_GRACE_MS, sendGracefulRestartWarning } = await import('../../src/lib/graceful-restart.js');

    const result = sendGracefulRestartWarning('agent-pan-1787', undefined, '/tmp/workspace');
    await vi.advanceTimersByTimeAsync(0);

    expect(tmuxMocks.sendEscapeKeyAsync).not.toHaveBeenCalled();
    expect(tmuxMocks.sendKeys).toHaveBeenCalledWith('agent-pan-1787', expect.stringContaining('Restarting in 60s'));

    await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS);
    await result;
  });
});
