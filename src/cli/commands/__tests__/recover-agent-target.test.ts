import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PAN-3150: `pan recover <issue>` prefixed the target with `agent-`
 * unconditionally, so every non-work agent was unreachable — `pan recover
 * PAN-3150` reported "Agent not found: agent-pan-3150" while the issue's only
 * registered agent was `strike-pan-3150`. That left the strike namespace with
 * no recovery door at all for the flywheel, which cannot run `pan kill`.
 */
const agentMocks = vi.hoisted(() => ({
  detectCrashedAgents: vi.fn(() => []),
  recoverAgent: vi.fn(),
  autoRecoverAgents: vi.fn(),
  normalizeAgentId: vi.fn((id: string) => `agent-${id.toLowerCase()}`),
  resolveAgentTargetSync: vi.fn(),
  resumeAgent: vi.fn(),
}));
const exitMocks = vi.hoisted(() => ({
  exitCli: vi.fn(async () => { throw new Error('exit'); }),
}));

vi.mock('../../../lib/agents.js', () => agentMocks);
vi.mock('../../exit.js', () => exitMocks);

import { recoverCommand } from '../recover.js';

describe('recoverCommand agent-target resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.normalizeAgentId.mockImplementation((id: string) => `agent-${id.toLowerCase()}`);
  });

  it('recovers the strike agent registered for an issue rather than a nonexistent agent-<id>', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('strike-pan-3150');
    agentMocks.recoverAgent.mockResolvedValue({
      action: 'respawned',
      state: {
        id: 'strike-pan-3150',
        issueId: 'PAN-3150',
        workspace: '/tmp/feature-pan-3150-strike',
        model: 'claude-opus-5',
      },
    });

    await recoverCommand('PAN-3150');

    expect(agentMocks.recoverAgent).toHaveBeenCalledWith('strike-pan-3150', { modelOverride: undefined });
    expect(agentMocks.recoverAgent).not.toHaveBeenCalledWith('agent-pan-3150', expect.anything());
  });

  it('exits non-zero when a live harness has not been recovered', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('strike-pan-3604');
    agentMocks.recoverAgent.mockResolvedValue({
      action: 'already-running',
      state: {
        id: 'strike-pan-3604',
        issueId: 'PAN-3604',
        workspace: '/tmp/feature-pan-3604-strike',
        model: 'claude-opus-5',
      },
    });

    await expect(recoverCommand('PAN-3604')).rejects.toThrow('exit');

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
  });

  it('still prefers the canonical work agent when the resolver finds one', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue('agent-pan-3116');
    agentMocks.recoverAgent.mockResolvedValue({
      action: 'respawned',
      state: {
        id: 'agent-pan-3116',
        issueId: 'PAN-3116',
        workspace: '/tmp/feature-pan-3116',
        model: 'claude-opus-5',
      },
    });

    await recoverCommand('PAN-3116');

    expect(agentMocks.recoverAgent).toHaveBeenCalledWith('agent-pan-3116', { modelOverride: undefined });
  });

  it('falls back to the canonical work-agent id when nothing resolves', async () => {
    agentMocks.resolveAgentTargetSync.mockReturnValue(null);
    agentMocks.recoverAgent.mockResolvedValue({
      action: 'respawned',
      state: {
        id: 'agent-pan-9999',
        issueId: 'PAN-9999',
        workspace: '/tmp/feature-pan-9999',
        model: 'claude-opus-5',
      },
    });

    await recoverCommand('PAN-9999');

    expect(agentMocks.normalizeAgentId).toHaveBeenCalledWith('PAN-9999');
    expect(agentMocks.recoverAgent).toHaveBeenCalledWith('agent-pan-9999', { modelOverride: undefined });
  });
});
