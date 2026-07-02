import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  resolveAgentTargetSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  setAgentPausedSync: vi.fn(),
  stopAgentSync: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
  listSessionNamesSync: vi.fn((): string[] => []),
}));

const slotMocks = vi.hoisted(() => ({
  listSlotAgents: vi.fn((): Array<{ agentId: string; slotIndex: number }> => []),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

vi.mock('../../../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents.js')>();
  return { ...actual, ...agentMocks };
});

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/tmux.js')>();
  return {
    ...actual,
    sessionExistsSync: tmuxMocks.sessionExistsSync,
    listSessionNamesSync: tmuxMocks.listSessionNamesSync,
  };
});

vi.mock('../../../../src/lib/agents/slot-reconcile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/slot-reconcile.js')>();
  return { ...actual, listSlotAgents: slotMocks.listSlotAgents };
});

vi.mock('../../../../src/lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

beforeEach(() => {
  vi.clearAllMocks();
  tmuxMocks.sessionExistsSync.mockReturnValue(false);
  tmuxMocks.listSessionNamesSync.mockReturnValue([]);
  slotMocks.listSlotAgents.mockReturnValue([]);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code}`);
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function stderrText(): string {
  return vi.mocked(console.error).mock.calls.map(call => call.join(' ')).join('\n');
}

describe('pan pause on a swarm issue (PAN-2214)', () => {
  it('exits non-zero and names pan swarm stop and pan swarm freeze when slot agents exist', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('agent-pan-1791');
    agentMocks.getAgentStateSync.mockReturnValue(null);
    slotMocks.listSlotAgents.mockReturnValue([
      { agentId: 'agent-pan-1791-slot-1', slotIndex: 1 },
      { agentId: 'agent-pan-1791-slot-2', slotIndex: 2 },
    ]);

    const { pauseCommand } = await import('../../../../src/cli/commands/pause.js');
    await expect(pauseCommand('PAN-1791', {})).rejects.toThrow('process.exit:1');

    const stderr = stderrText();
    expect(stderr).toContain('pan swarm stop PAN-1791');
    expect(stderr).toContain('pan swarm freeze PAN-1791');
    expect(stderr).toContain('swarm of 2 slot agent(s)');
    expect(stderr).toContain('no single agent');
    expect(agentMocks.setAgentPausedSync).not.toHaveBeenCalled();
    expect(agentMocks.stopAgentSync).not.toHaveBeenCalled();
  });

  it('detects slot agents from live tmux sessions when the registry has no rows', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('agent-pan-1791');
    agentMocks.getAgentStateSync.mockReturnValue(null);
    tmuxMocks.listSessionNamesSync.mockReturnValue(['agent-pan-1791-slot-3', 'agent-pan-9999-slot-1']);

    const { pauseCommand } = await import('../../../../src/cli/commands/pause.js');
    await expect(pauseCommand('PAN-1791', {})).rejects.toThrow('process.exit:1');

    const stderr = stderrText();
    expect(stderr).toContain('swarm of 1 slot agent(s)');
    expect(stderr).toContain('pan swarm stop PAN-1791');
  });

  it('keeps the plain not-found error for a non-swarm issue with no agent', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('agent-pan-9');
    agentMocks.getAgentStateSync.mockReturnValue(null);

    const { pauseCommand } = await import('../../../../src/cli/commands/pause.js');
    await expect(pauseCommand('PAN-9', {})).rejects.toThrow('process.exit:1');

    const stderr = stderrText();
    expect(stderr).toContain('Agent agent-pan-9 not found.');
    expect(stderr).not.toContain('pan swarm stop');
  });
});

describe('pan pause single-agent regression (PAN-2214)', () => {
  it('pauses and stops a running agent exactly as before', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('agent-pan-1723');
    agentMocks.getAgentStateSync.mockReturnValue({ issueId: 'PAN-1723', status: 'running' });
    tmuxMocks.sessionExistsSync.mockReturnValue(true);

    const { pauseCommand } = await import('../../../../src/cli/commands/pause.js');
    await pauseCommand('PAN-1723', { reason: 'ram' });

    expect(agentMocks.setAgentPausedSync).toHaveBeenCalledWith('agent-pan-1723', 'ram', true);
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-1723');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1723', kind: 'pause' }),
    );
    expect(process.exit).not.toHaveBeenCalled();
  });
});
