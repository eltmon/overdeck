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

vi.mock('../../src/lib/agents.js', () => ({
  resolveAgentTargetSync: mocks.resolveAgentTargetSync,
  getAgentStateSync: mocks.getAgentStateSync,
  messageAgent: mocks.messageAgent,
}));

vi.mock('../../src/lib/work-agent-lifecycle.js', () => ({
  issueOwesReworkSync: mocks.issueOwesReworkSync,
}));

vi.mock('../../src/lib/remote/index.js', () => ({
  loadRemoteAgentState: mocks.loadRemoteAgentState,
  sendToRemoteAgent: mocks.sendToRemoteAgent,
}));

vi.mock('../../src/cli/exit.js', () => ({
  exitCli: mocks.exitCli,
}));

import { tellCommand } from '../../src/cli/commands/tell.js';

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
});
