import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  clearAgentTroubled: vi.fn(),
  resolveAgentTarget: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

vi.mock('../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents.js')>();
  return {
    ...actual,
    getAgentState: agentMocks.getAgentState,
    clearAgentTroubled: agentMocks.clearAgentTroubled,
    resolveAgentTarget: agentMocks.resolveAgentTarget,
  };
});

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

beforeEach(() => {
  vi.clearAllMocks();
  agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed(null));
  agentMocks.resolveAgentTarget.mockImplementation((id: string) =>
    id.toLowerCase().startsWith('agent-') || id.toLowerCase().startsWith('strike-')
      ? id.toLowerCase()
      : `agent-${id.toLowerCase()}`,
  );
});

describe('untroubledCommand (PAN-4211)', () => {
  it('clears a troubled agent, records one intervention, and prints the next step', async () => {
    agentMocks.getAgentState.mockReturnValue({ issueId: 'PAN-1641', troubled: true, consecutiveFailures: 3 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-1641');

    expect(agentMocks.clearAgentTroubled).toHaveBeenCalledWith('agent-pan-1641');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledTimes(1);
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-1641',
      kind: 'untroubled',
      source: 'pan untroubled',
    });
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Cleared troubled state for agent: agent-pan-1641');
    expect(output).toContain('pan start PAN-1641');

    logSpy.mockRestore();
  });

  it('reports already-untroubled and records no intervention when nothing was set', async () => {
    agentMocks.getAgentState.mockReturnValue({ issueId: 'PAN-1641' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-1641');

    expect(agentMocks.clearAgentTroubled).toHaveBeenCalledWith('agent-pan-1641');
    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('is already untroubled');

    logSpy.mockRestore();
  });

  it('exits 1 when the agent has no state', async () => {
    agentMocks.getAgentState.mockReturnValue(null);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { untroubledCommand } = await import('../untroubled.js');
    await expect(untroubledCommand('PAN-1641')).rejects.toThrow('exit:1');

    const output = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Agent agent-pan-1641 not found.');
    expect(agentMocks.clearAgentTroubled).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('resolves a full agent ID directly', async () => {
    agentMocks.getAgentState.mockReturnValue({ issueId: 'PAN-1723', troubled: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('strike-pan-1723');

    expect(agentMocks.clearAgentTroubled).toHaveBeenCalledWith('strike-pan-1723');
  });
});
