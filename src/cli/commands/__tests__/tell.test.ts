import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  messageAgent: vi.fn(async () => {}),
}));

const remoteMocks = vi.hoisted(() => ({
  loadRemoteAgentState: vi.fn(() => null),
  sendToRemoteAgent: vi.fn(async () => {}),
}));

// Keep the real normalizeAgentId — the PAN-1749 regression was tellCommand
// bypassing it with a naive `agent-` prefix, which broke singleton IDs.
vi.mock('../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents.js')>();
  return { ...actual, messageAgent: agentMocks.messageAgent };
});

vi.mock('../../../lib/remote/index.js', () => ({
  loadRemoteAgentState: remoteMocks.loadRemoteAgentState,
  sendToRemoteAgent: remoteMocks.sendToRemoteAgent,
}));

describe('tellCommand agent ID resolution (PAN-1749)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('does not prefix the flywheel-orchestrator singleton ID', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('flywheel-orchestrator', 'strike PAN-1: parking — need operator decision');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      'strike PAN-1: parking — need operator decision',
      'pan-tell',
    );
  });

  it('prefixes bare issue IDs with agent-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-123', 'hello', 'pan-tell');
  });

  it('preserves known agent prefixes like planning-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('planning-pan-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('planning-pan-123', 'hello', 'pan-tell');
  });
});
