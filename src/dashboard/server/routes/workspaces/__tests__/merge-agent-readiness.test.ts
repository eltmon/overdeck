/**
 * PAN-3120: the preemptive scheduler yields idle work agents to free slots, so
 * the work agent a merge needs is routinely paused by the system itself. Before
 * this, a polyrepo merge hard-refused ("Work agent … is not running") and the
 * single-repo path was worse: messageAgent silently diverts a paused agent's
 * message to the mail queue, so the merge reported a successful resume and then
 * polled 30 minutes for a push that could never happen.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../../../../lib/agents/agent-state.js';

const mocks = vi.hoisted(() => ({
  agentState: null as Partial<AgentState> | null,
  clearYieldForResumeSync: vi.fn(() => true),
  saveAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
  lifecycle: { hasLiveTmuxSession: false, canResumeSession: true, canStartFresh: true } as Record<string, unknown>,
}));

vi.mock('../../../../../lib/agents/agent-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/agents/agent-state.js')>();
  return {
    ...actual,
    getAgentStateSync: () => mocks.agentState,
    saveAgentStateSync: mocks.saveAgentStateSync,
    clearYieldForResumeSync: mocks.clearYieldForResumeSync,
  };
});

vi.mock('../../../../../lib/agents.js', async () => {
  const { Effect } = await import('effect');
  return {
    getAgentState: () => Effect.succeed(mocks.agentState),
    messageAgent: mocks.messageAgent,
    spawnAgent: mocks.spawnAgent,
  };
});

vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: () => mocks.lifecycle,
}));

import { ensureAgentReadyForMerge } from '../merge-strike.js';

const REBASE_MSG = 'MERGE REQUESTED: rebase and push.';
const WORKSPACE = '/tmp/workspaces/feature-min-902';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearYieldForResumeSync.mockReturnValue(true);
  mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
  mocks.lifecycle = { hasLiveTmuxSession: false, canResumeSession: true, canStartFresh: true };
  mocks.agentState = { id: 'agent-min-902', status: 'stopped' };
});

describe('ensureAgentReadyForMerge (PAN-3120)', () => {
  it('clears a scheduler yield and resumes the agent instead of refusing the merge', async () => {
    mocks.agentState = {
      id: 'agent-min-902',
      status: 'stopped',
      paused: true,
      pausedReason: 'yield: making room for review of MIN-902',
      yieldedByScheduler: true,
      stoppedByUser: true,
      stoppedByPause: true,
    };

    const result = await ensureAgentReadyForMerge('MIN-902', WORKSPACE, REBASE_MSG, { agentId: 'agent-min-902' });

    expect(mocks.clearYieldForResumeSync).toHaveBeenCalledWith('agent-min-902');
    expect(mocks.messageAgent).toHaveBeenCalledWith('agent-min-902', REBASE_MSG);
    expect(result.recovered).toBe(true);
    expect(result.detail).toContain('cleared scheduler yield');
  });

  it('fails loudly when the request is diverted to the mail queue rather than delivered', async () => {
    mocks.lifecycle = { hasLiveTmuxSession: true, canResumeSession: true, canStartFresh: false };
    mocks.messageAgent.mockResolvedValue({ delivered: false, queuedToMail: true, reason: 'agent is paused' });

    await expect(
      ensureAgentReadyForMerge('MIN-902', WORKSPACE, REBASE_MSG, { agentId: 'agent-min-902' }),
    ).rejects.toThrow(/mail queue/);
    expect(mocks.spawnAgent).not.toHaveBeenCalled();
  });

  it('blocks on an operator pause with guidance instead of overriding it', async () => {
    mocks.agentState = {
      id: 'agent-min-902',
      status: 'stopped',
      paused: true,
      pausedReason: 'operator investigating a data bug',
    };

    await expect(
      ensureAgentReadyForMerge('MIN-902', WORKSPACE, REBASE_MSG, { agentId: 'agent-min-902' }),
    ).rejects.toThrow(/pan unpause/);
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('clears an operator-stop gate, because clicking MERGE is itself the operator action', async () => {
    mocks.agentState = { id: 'agent-min-902', status: 'stopped', stoppedByUser: true };

    const result = await ensureAgentReadyForMerge('MIN-902', WORKSPACE, REBASE_MSG, { agentId: 'agent-min-902' });

    expect(mocks.saveAgentStateSync).toHaveBeenCalled();
    expect(mocks.agentState.stoppedByUser).toBeUndefined();
    expect(result.detail).toContain('cleared operator-stop gate');
  });

  it('passes an ungated running agent straight through', async () => {
    mocks.lifecycle = { hasLiveTmuxSession: true, canResumeSession: true, canStartFresh: true };

    const result = await ensureAgentReadyForMerge('MIN-902', WORKSPACE, REBASE_MSG, { agentId: 'agent-min-902' });

    expect(mocks.clearYieldForResumeSync).not.toHaveBeenCalled();
    expect(result.detail).toBe('Work agent already running; sent merge preparation request.');
  });
});
