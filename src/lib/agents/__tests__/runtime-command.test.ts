import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const tmuxMocks = vi.hoisted(() => ({
  sessionExists: vi.fn(),
  capturePane: vi.fn(),
}));

vi.mock('../../tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../../tmux.js')>('../../tmux.js');
  return {
    ...actual,
    sessionExists: tmuxMocks.sessionExists,
    capturePane: tmuxMocks.capturePane,
  };
});

import { waitForAcpHostReady, waitForCodexAppServerReady, waitForPromptReady } from '../runtime-command.js';
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

describe('waitForAcpHostReady', () => {
  it('does not accept stale socket and token artifacts without the fresh readiness marker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00Z'));
    let readinessPublished = false;
    let settled = false;
    const pending = waitForAcpHostReady('agent-stale-acp', 2, {
      sessionExists: vi.fn(async () => true),
      pathExists: vi.fn((path: string) => !path.endsWith('acp-launch-error')),
      readText: vi.fn((path: string) => {
        if (path.endsWith('acp-session-id')) {
          if (!readinessPublished) {
            throw Object.assign(new Error('missing readiness marker'), { code: 'ENOENT' });
          }
          return 'fresh-session\n';
        }
        return 'fresh-token\n';
      }),
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    readinessPublished = true;
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBeUndefined();
  });

  it('surfaces persisted Kimi authentication guidance before the readiness timeout', async () => {
    await expect(waitForAcpHostReady('agent-auth-failed', 30, {
      sessionExists: vi.fn(async () => true),
      pathExists: vi.fn((path: string) => path.endsWith('acp-launch-error')),
      readText: vi.fn(() => 'Kimi authentication is required. Run `kimi`, then /login, and retry.\n'),
    })).rejects.toThrow(
      'ACP host agent-auth-failed failed to start: Kimi authentication is required. Run `kimi`, then /login, and retry.',
    );
  });
});

describe('waitForPromptReady — kimi-code TUI (PAN-1837)', () => {
  afterEach(() => {
    tmuxMocks.sessionExists.mockReset();
    tmuxMocks.capturePane.mockReset();
  });

  const BOOTING_PANE = '  Welcome to Kimi Code!\n  Directory: /tmp\n';
  const READY_PANE = [
    '╰────────────────────────────────╯',
    '│ >                                                                          │',
    '╰────────────────────────────────╯',
    ' yolo  K3 thinking: high  ~                                /model: switch model',
    '                                                             context: 0% (0/1M)',
  ].join('\n');

  it('resolves true once the input box and status line render (real pane captured live, PAN-1837 wi14)', async () => {
    vi.useFakeTimers();
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    tmuxMocks.capturePane
      .mockReturnValueOnce(Effect.succeed(BOOTING_PANE))
      .mockReturnValueOnce(Effect.succeed(READY_PANE));

    const pending = waitForPromptReady('agent-kimi-ready', 'kimi-code', 5);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when the session disappears before the TUI ever renders ready', async () => {
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(false));
    tmuxMocks.capturePane.mockReturnValue(Effect.succeed(BOOTING_PANE));

    await expect(waitForPromptReady('agent-kimi-gone', 'kimi-code', 1)).resolves.toBe(false);
  });

  it('resolves false on timeout when the TUI never shows its ready prompt', async () => {
    vi.useFakeTimers();
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    tmuxMocks.capturePane.mockReturnValue(Effect.succeed(BOOTING_PANE));

    const pending = waitForPromptReady('agent-kimi-stuck', 'kimi-code', 1);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBe(false);
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
