import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const tmuxMocks = vi.hoisted(() => ({
  sendEscapeKeyAsync: vi.fn(),
  sendKeys: vi.fn(),
}));

vi.mock('../../src/lib/tmux.js', () => ({
  sendEscapeKeyAsync: tmuxMocks.sendEscapeKeyAsync,
  sendKeys: tmuxMocks.sendKeys,
}));

describe('sendGracefulRestartWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
