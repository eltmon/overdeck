import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForCodexAppServerReady } from '../runtime-command.js';
import { shouldUseSupervisorForConversation } from '../../overdeck/conversation-runtime.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForCodexAppServerReady', () => {
  it('resolves when the status op reports ready', async () => {
    const readStatus = vi.fn(async () => ({ state: 'ready' }));
    const sessionExists = vi.fn(async () => true);

    await expect(waitForCodexAppServerReady('agent-ready', 1, {
      readStatus,
      sessionExists,
      sleep: async () => {},
    })).resolves.toBeUndefined();

    expect(sessionExists).toHaveBeenCalledWith('agent-ready');
    expect(readStatus).toHaveBeenCalledWith('agent-ready');
  });

  it('rejects with an actionable timeout when readiness never arrives', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00Z'));
    const pending = waitForCodexAppServerReady('agent-timeout', 1, {
      readStatus: vi.fn(async () => ({ state: 'starting' })),
      sessionExists: vi.fn(async () => true),
    });
    const assertion = expect(pending).rejects.toThrow(
      'Timed out waiting for Codex app-server readiness for agent-timeout. Last state: starting.',
    );

    await vi.advanceTimersByTimeAsync(1_500);

    await assertion;
  });
});

describe('shouldUseSupervisorForConversation', () => {
  it('disables the PTY supervisor for Codex app-server conversations', () => {
    expect(shouldUseSupervisorForConversation('codex', { codexTransport: 'app-server' })).toBe(false);
  });

  it('preserves the existing Codex TUI and Claude Code supervisor behavior', () => {
    expect(shouldUseSupervisorForConversation('codex', { codexTransport: 'tui' })).toBe(true);
    expect(shouldUseSupervisorForConversation('claude-code')).toBe(true);
  });
});
