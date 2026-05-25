import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  getAgentStateSync: agentMocks.getAgentStateSync,
  clearAgentPausedSync: agentMocks.clearAgentPausedSync,
  clearAgentTroubledSync: agentMocks.clearAgentTroubledSync,
}));

vi.mock('../../../lib/issue-id.js', () => ({
  resolveIssueIdSync: vi.fn((id: string) => id),
}));

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

describe('operator intervention CLI emission', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.clearAgentPausedSync.mockReset();
    agentMocks.clearAgentTroubledSync.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  it('emits an unpause intervention when pan unpause clears a pause gate', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ paused: true });

    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('PAN-1');

    expect(agentMocks.clearAgentPausedSync).toHaveBeenCalledWith('agent-pan-1');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-1',
      kind: 'unpause',
      source: 'pan unpause',
    });
  });

  it('does not emit an unpause intervention when the agent was already unpaused', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ paused: false });

    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('PAN-1');

    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('emits an untroubled intervention when pan untroubled clears a troubled gate', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ troubled: false, consecutiveFailures: 2 });

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-2');

    expect(agentMocks.clearAgentTroubledSync).toHaveBeenCalledWith('agent-pan-2');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2',
      kind: 'untroubled',
      source: 'pan untroubled',
    });
  });

  it('does not emit an untroubled intervention when the agent was already untroubled', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ troubled: false, consecutiveFailures: 0 });

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-2');

    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });
});
