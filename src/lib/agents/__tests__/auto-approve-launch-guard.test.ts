import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PAN-5151: every claude-code base-command builder must call
 * ensureAutoApproveHookReady() before it hands back a command that will
 * launch Claude Code, so a guard rejection (hook missing under auto) blocks
 * the launch instead of silently prompting forever on an unwatched machine.
 */
const ensureAutoApproveHookReadyMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../hook-readiness.js', () => ({
  ensureAutoApproveHookReady: ensureAutoApproveHookReadyMock,
}));

import { getAgentRuntimeBaseCommand, getRoleRuntimeBaseCommand } from '../runtime-command.js';

describe('auto-approve launch guard wiring (PAN-5151)', () => {
  beforeEach(() => {
    ensureAutoApproveHookReadyMock.mockClear();
    ensureAutoApproveHookReadyMock.mockImplementation(async () => undefined);
    delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
  });

  it('calls the guard once for a definition-less claude-code command', async () => {
    await getAgentRuntimeBaseCommand('claude-opus-5-5');

    expect(ensureAutoApproveHookReadyMock).toHaveBeenCalledTimes(1);
  });

  it('calls the guard once for a claude-code role command', async () => {
    await getRoleRuntimeBaseCommand('claude-opus-5-5', 'agent-x', 'work');

    expect(ensureAutoApproveHookReadyMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the guard for a non-claude-code harness (codex)', async () => {
    await getAgentRuntimeBaseCommand('gpt-5.6-sol', undefined, undefined, 'codex');

    expect(ensureAutoApproveHookReadyMock).not.toHaveBeenCalled();
  });

  it('does not call the guard for a non-claude-code harness (ohmypi)', async () => {
    await getAgentRuntimeBaseCommand('claude-opus-5-5', undefined, undefined, 'ohmypi');

    expect(ensureAutoApproveHookReadyMock).not.toHaveBeenCalled();
  });

  it('does not call the guard for a registered agent name (--agent flag path)', async () => {
    await getAgentRuntimeBaseCommand('claude-opus-5-5', 'agent-x', 'pan-review-agent');

    expect(ensureAutoApproveHookReadyMock).not.toHaveBeenCalled();
  });

  it('propagates a guard rejection from getAgentRuntimeBaseCommand', async () => {
    ensureAutoApproveHookReadyMock.mockRejectedValue(new Error('hook missing; run pan sync'));

    await expect(getAgentRuntimeBaseCommand('claude-opus-5-5')).rejects.toThrow('hook missing; run pan sync');
  });

  it('propagates a guard rejection from getRoleRuntimeBaseCommand', async () => {
    ensureAutoApproveHookReadyMock.mockRejectedValue(new Error('hook missing; run pan sync'));

    await expect(getRoleRuntimeBaseCommand('claude-opus-5-5', 'agent-x', 'work')).rejects.toThrow(
      'hook missing; run pan sync',
    );
  });
});
