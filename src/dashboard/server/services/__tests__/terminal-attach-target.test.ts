/**
 * PAN-3921 (review of #4104, F5): a terminal WebSocket that connects during a
 * conversation's respawn attaches to the pane the respawn produced — on Herdr
 * a new terminal — instead of closing with a fatal 4404.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveTerminalAttachTarget, type TerminalAttachTargetDeps } from '../terminal-service.js';

function deps(overrides: Partial<TerminalAttachTargetDeps> = {}): TerminalAttachTargetDeps {
  return {
    resolveHerdr: vi.fn(async () => null),
    listTmuxSessions: vi.fn(async () => []),
    tmuxSessionExists: vi.fn(async () => false),
    isRespawnPending: vi.fn(() => false),
    waitForRespawn: vi.fn(async () => false),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('resolveTerminalAttachTarget', () => {
  it('attaches to a live Herdr terminal at once', async () => {
    const d = deps({ resolveHerdr: vi.fn(async () => 't-1') });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, d)).resolves.toEqual({ kind: 'herdr', terminalId: 't-1' });
    expect(d.listTmuxSessions).not.toHaveBeenCalled();
  });

  it('attaches to a tmux session when Herdr holds nothing', async () => {
    const d = deps({ listTmuxSessions: vi.fn(async () => ['conv-x']) });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, d)).resolves.toEqual({ kind: 'tmux' });
  });

  it('re-resolves the Herdr terminal after a respawn instead of falling to tmux', async () => {
    const resolveHerdr = vi.fn<(name: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null) // old pane closed, new one not up yet
      .mockResolvedValueOnce('t-new');
    const d = deps({
      resolveHerdr,
      isRespawnPending: vi.fn(() => true),
      waitForRespawn: vi.fn(async () => true),
    });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, d)).resolves.toEqual({ kind: 'herdr', terminalId: 't-new' });
    expect(d.waitForRespawn).toHaveBeenCalledWith('conv-x', 95_000);
  });

  it('retries the Herdr lookup briefly after the respawn lands', async () => {
    const resolveHerdr = vi.fn<(name: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('t-late');
    const d = deps({ resolveHerdr, isRespawnPending: vi.fn(() => true), waitForRespawn: vi.fn(async () => true) });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, d)).resolves.toEqual({ kind: 'herdr', terminalId: 't-late' });
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it('falls back to tmux after a respawn only when the tmux session exists', async () => {
    const d = deps({
      isRespawnPending: vi.fn(() => true),
      waitForRespawn: vi.fn(async () => true),
      tmuxSessionExists: vi.fn(async () => true),
    });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, d)).resolves.toEqual({ kind: 'tmux' });
  });

  it('is missing when no respawn is pending, or the respawn never lands', async () => {
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, deps())).resolves.toEqual({ kind: 'missing' });
    const neverLands = deps({ isRespawnPending: vi.fn(() => true), waitForRespawn: vi.fn(async () => false) });
    await expect(resolveTerminalAttachTarget('conv-x', 95_000, neverLands)).resolves.toEqual({ kind: 'missing' });
  });
});
