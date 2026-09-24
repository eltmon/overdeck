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
  liveness: { alive: false, reason: 'no-session' } as { alive: boolean; reason?: string; paneAlive?: boolean },
}));

vi.mock('../../../../../lib/agents/liveness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/agents/liveness.js')>();
  return { ...actual, isAlive: async () => mocks.liveness };
});

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
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
    getAgentStateSync: () => mocks.agentState,
    messageAgent: mocks.messageAgent,
    spawnAgent: mocks.spawnAgent,
  };
});

vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: () => mocks.lifecycle,
}));

import { ensureAgentReadyForMerge, rebaseWithAgentFallback } from '../merge-strike.js';

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

// Review of #3987 (PAN-3973): a strike ends at its PR URL. A merge-queue strike
// rebase may still hand its PR update to a strike session idling at its prompt,
// but must never resume one that has exited.
describe('rebaseWithAgentFallback with liveAgentOnly (strike)', () => {
  const strikeOptions = {
    issueId: 'PAN-77',
    // No such directory: the server-side rebase is skipped, so the agent path decides.
    workspacePath: '/tmp/definitely-missing/workspaces/feature-pan-77-strike',
    branchName: 'strike/pan-77',
    targetBranch: 'main',
    agentId: 'strike-pan-77',
    rebaseMsg: 'STRIKE PR UPDATE REQUEST',
    allowFreshStart: false,
    liveAgentOnly: true,
    setStatus: () => undefined,
  };

  it('does not message or resume an exited strike session and fails without a retry', async () => {
    mocks.liveness = { alive: false, reason: 'no-session' };
    mocks.agentState = { id: 'strike-pan-77', status: 'stopped' };

    const result = await rebaseWithAgentFallback(strikeOptions);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('strike-pan-77 has exited');
    expect(result.reason).toContain('pan strike PAN-77');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.spawnAgent).not.toHaveBeenCalled();
  });

  // Review of #4015 (4015-3): an indeterminate probe is not evidence of life.
  it('treats an indeterminate liveness probe as not live and does not resume the strike', async () => {
    mocks.liveness = { alive: false, reason: 'runtime-indeterminate' };
    mocks.agentState = { id: 'strike-pan-77', status: 'stopped' };

    const result = await rebaseWithAgentFallback(strikeOptions);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain('strike-pan-77 cannot be confirmed running');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.spawnAgent).not.toHaveBeenCalled();
  });

  it('asks a strike session the liveness oracle confirms is running', async () => {
    mocks.liveness = { alive: true, paneAlive: true };
    mocks.lifecycle = { hasLiveTmuxSession: true, canResumeSession: true, canStartFresh: false };
    mocks.messageAgent.mockResolvedValue({ delivered: false, queuedToMail: true, reason: 'test stops here' });

    const result = await rebaseWithAgentFallback(strikeOptions);

    expect(mocks.messageAgent).toHaveBeenCalledWith('strike-pan-77', 'STRIKE PR UPDATE REQUEST');
    expect(result.success).toBe(false);
  });
});
