import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const waitForAcpHostReady = vi.fn(async () => {});
const tmuxSessionExists = vi.fn((_name: string) => Effect.succeed(true));

vi.mock('../../agents/runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/runtime-command.js')>()),
  waitForAcpHostReady,
}));

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  sessionExists: tmuxSessionExists,
}));

const { waitForConversationRuntimeReady } = await import('../conversation-runtime.js');

describe('waitForConversationRuntimeReady — ACP conversations', () => {
  beforeEach(() => {
    waitForAcpHostReady.mockClear();
    tmuxSessionExists.mockClear();
  });

  // Conversations run as tmux sessions on every host. The ACP readiness wait's
  // default probe asks the selected terminal backend, which on a Herdr host
  // never sees a tmux session, so every opencode/acp start and resume failed
  // as "exited before readiness". The conversation path must probe tmux.
  it.each(['opencode', 'acp'] as const)('%s probes the tmux session, not the selected backend', async (harness) => {
    await waitForConversationRuntimeReady('conv-acp-ready', harness, 'respawn');

    expect(waitForAcpHostReady).toHaveBeenCalledTimes(1);
    const [agentId, timeoutSec, deps] = waitForAcpHostReady.mock.calls[0] as unknown as [
      string,
      number,
      { sessionExists?: (id: string) => Promise<boolean> },
    ];
    expect(agentId).toBe('conv-acp-ready');
    expect(timeoutSec).toBe(30);
    expect(deps.sessionExists).toBeTypeOf('function');

    await expect(deps.sessionExists!('conv-acp-ready')).resolves.toBe(true);
    expect(tmuxSessionExists).toHaveBeenCalledWith('conv-acp-ready');
  });
});
