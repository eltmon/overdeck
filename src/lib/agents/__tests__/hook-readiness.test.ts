import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { provisionClaudeHooksMock, logAgentLifecycleSyncMock } = vi.hoisted(() => ({
  provisionClaudeHooksMock: vi.fn(),
  logAgentLifecycleSyncMock: vi.fn(),
}));

vi.mock('../../claude-hooks-provision.js', () => ({
  provisionClaudeHooks: provisionClaudeHooksMock,
}));

vi.mock('../../persistent-logger.js', () => ({
  logAgentLifecycle: logAgentLifecycleSyncMock,
}));

import { ensureAutoApproveHookReady, ensureLifecycleHooksBeforeLaunch } from '../hook-readiness.js';

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

describe('ensureAutoApproveHookReady', () => {
  let home: string;
  let binDir: string;
  let settingsPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    home = mkdtempSync(join(tmpdir(), 'pan-5151-hook-ready-'));
    binDir = join(home, 'bin');
    settingsPath = join(home, 'settings.json');
    mkdirSync(binDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves under bypass without calling provisionClaudeHooks', async () => {
    await ensureAutoApproveHookReady({ settingsPath, binDir, mode: 'bypass' });

    expect(provisionClaudeHooksMock).not.toHaveBeenCalled();
  });

  it('resolves under auto when the hook is already registered and the script exists', async () => {
    writeFileSync(join(binDir, 'auto-approve-hook'), '', 'utf-8');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: join(binDir, 'auto-approve-hook') }] }] },
    }), 'utf-8');

    await ensureAutoApproveHookReady({ settingsPath, binDir, mode: 'auto' });

    expect(provisionClaudeHooksMock).not.toHaveBeenCalled();
  });

  it('rejects naming pan sync when provisioning fails under auto', async () => {
    provisionClaudeHooksMock.mockResolvedValue({
      ok: false,
      reason: 'jq is not installed',
      changed: false,
      binariesSynced: 0,
      registered: [],
      pruned: [],
    });

    await expect(ensureAutoApproveHookReady({ settingsPath, binDir, mode: 'auto' })).rejects.toThrow(
      /pan sync/,
    );
    await expect(ensureAutoApproveHookReady({ settingsPath, binDir, mode: 'auto' })).rejects.toThrow(
      /jq is not installed/,
    );
  });

  it('resolves under auto when provisioning registers the hook', async () => {
    writeFileSync(join(binDir, 'auto-approve-hook'), '', 'utf-8');
    provisionClaudeHooksMock.mockImplementation(async () => {
      writeFileSync(settingsPath, JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: join(binDir, 'auto-approve-hook') }] }] },
      }), 'utf-8');
      return { ok: true, changed: true, binariesSynced: 1, registered: ['PreToolUse:auto-approve-hook'], pruned: [] };
    });

    await ensureAutoApproveHookReady({ settingsPath, binDir, mode: 'auto' });

    expect(provisionClaudeHooksMock).toHaveBeenCalledTimes(1);
  });
});
