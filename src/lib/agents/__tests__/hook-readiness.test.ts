import { beforeEach, describe, expect, it, vi } from 'vitest';

const { provisionClaudeHooksMock, logAgentLifecycleSyncMock } = vi.hoisted(() => ({
  provisionClaudeHooksMock: vi.fn(),
  logAgentLifecycleSyncMock: vi.fn(),
}));

vi.mock('../../claude-hooks-provision.js', () => ({
  provisionClaudeHooks: provisionClaudeHooksMock,
}));

vi.mock('../../persistent-logger.js', () => ({
  logAgentLifecycleSync: logAgentLifecycleSyncMock,
}));

import { ensureLifecycleHooksBeforeLaunch } from '../hook-readiness.js';

describe('ensureLifecycleHooksBeforeLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits successful Claude hook provisioning and records the result', async () => {
    provisionClaudeHooksMock.mockResolvedValue({
      ok: true,
      changed: true,
      binariesSynced: 14,
      registered: ['SessionStart:session-start-hook'],
      pruned: [],
    });

    await ensureLifecycleHooksBeforeLaunch('agent-pan-1', 'claude-code');

    expect(provisionClaudeHooksMock).toHaveBeenCalledTimes(1);
    expect(logAgentLifecycleSyncMock).toHaveBeenCalledWith(
      'agent-pan-1',
      expect.stringContaining('hook provisioning: ready harness=claude-code changed=true'),
    );
  });

  it('blocks launch with an actionable error when provisioning fails', async () => {
    provisionClaudeHooksMock.mockResolvedValue({
      ok: false,
      reason: 'jq is not installed',
      changed: false,
      binariesSynced: 0,
      registered: [],
      pruned: [],
    });

    await expect(ensureLifecycleHooksBeforeLaunch('agent-pan-2', 'claude-code')).rejects.toThrow(
      'Run `pan up` to install host prerequisites, then `pan sync` and retry.',
    );
    expect(logAgentLifecycleSyncMock).toHaveBeenCalledWith(
      'agent-pan-2',
      expect.stringContaining('hook provisioning: failed harness=claude-code reason=jq is not installed'),
    );
  });

  it('does not provision hooks for a non-Claude harness', async () => {
    await ensureLifecycleHooksBeforeLaunch('agent-pan-3', 'codex');

    expect(provisionClaudeHooksMock).not.toHaveBeenCalled();
  });
});
