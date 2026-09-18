import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveAgentTargetSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
  issueOwesReworkSync: vi.fn(),
  loadRemoteAgentState: vi.fn(),
  sendToRemoteAgent: vi.fn(),
  exitCli: vi.fn(async (_code: number) => undefined as never),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  resolveAgentTargetSync: mocks.resolveAgentTargetSync,
  getAgentStateSync: mocks.getAgentStateSync,
  messageAgent: mocks.messageAgent,
}));

vi.mock('../../../src/lib/work-agent-lifecycle.js', () => ({
  issueOwesReworkSync: mocks.issueOwesReworkSync,
}));

vi.mock('../../../src/lib/remote/index.js', () => ({
  loadRemoteAgentState: mocks.loadRemoteAgentState,
  sendToRemoteAgent: mocks.sendToRemoteAgent,
}));

vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: mocks.exitCli,
}));

import { tellCommand } from '../../../src/cli/commands/tell.js';

describe('pan tell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveAgentTargetSync.mockReturnValue('agent-pan-3846');
    mocks.loadRemoteAgentState.mockReturnValue(null);
    mocks.getAgentStateSync.mockReturnValue({ id: 'agent-pan-3846', issueId: 'PAN-3846' });
    mocks.issueOwesReworkSync.mockReturnValue(false);
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true });
  });

  it('passes owesRework from the canonical row to messageAgent (PAN-3846 W3)', async () => {
    mocks.issueOwesReworkSync.mockReturnValue(true);

    await tellCommand('PAN-3846', 'fix the UAT failure');

    expect(mocks.issueOwesReworkSync).toHaveBeenCalledWith('PAN-3846');
    expect(mocks.messageAgent).toHaveBeenCalledWith('agent-pan-3846', 'fix the UAT failure', 'pan-tell', {
      owesRework: true,
    });
  });

  it('exits 1 with the reason on stderr when delivery is not confirmed (PAN-3846 W4)', async () => {
    mocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason: 'message was injected but no turn appeared in transcript session-1 within the confirmation window (2 attempts)',
    });

    await tellCommand('PAN-3846', 'are you there');

    expect(mocks.exitCli).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Message NOT delivered to agent-pan-3846'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no turn appeared in transcript session-1'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('~/.overdeck/agents/agent-pan-3846/mail/'));
  });

  it('exits 0 and prints turn confirmed on a confirmed delivery (PAN-3846 W4)', async () => {
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true });

    await tellCommand('PAN-3846', 'status please');

    expect(mocks.exitCli).toHaveBeenCalledWith(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Message delivered to agent-pan-3846 (turn confirmed)'));
  });

  it('exits 1 with the failure when remote delivery fails (PR #3870 finding 1)', async () => {
    mocks.loadRemoteAgentState.mockReturnValue({ location: 'remote', vmName: 'vm-1' });
    mocks.sendToRemoteAgent.mockResolvedValue({ ok: false, failure: 'remote paste-buffer failed for agent-pan-3846 on vm-1 (exit 1): tmux: no such session' });

    await tellCommand('PAN-3846', 'hello remote');

    expect(mocks.exitCli).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Message NOT delivered to agent-pan-3846 (remote: vm-1)'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('remote paste-buffer failed'));
  });

  it('reports success without exit 1 when remote delivery succeeds', async () => {
    mocks.loadRemoteAgentState.mockReturnValue({ location: 'remote', vmName: 'vm-1' });
    mocks.sendToRemoteAgent.mockResolvedValue({ ok: true });

    await tellCommand('PAN-3846', 'hello remote');

    expect(mocks.exitCli).not.toHaveBeenCalledWith(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Message sent to agent-pan-3846 (remote: vm-1)'));
  });
});
