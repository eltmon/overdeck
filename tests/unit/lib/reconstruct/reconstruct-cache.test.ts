import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { reconstructCache, type ReconstructResult } from '../../../../src/lib/reconstruct/reconstruct-cache.js';
import type { AgentState } from '../../../../src/lib/agents.js';
const agentState = (overrides: Partial<AgentState> = {}): AgentState & { tmuxActive: boolean } => ({
  id: 'agent-pan-1920',
  issueId: 'PAN-1920',
  workspace: '/projects/overdeck/workspaces/feature-pan-1920',
  role: 'work',
  model: 'claude-sonnet-4',
  status: 'running',
  startedAt: '2026-06-16T00:00:00Z',
  harness: 'claude-code',
  tmuxActive: true,
  ...overrides,
});

vi.mock('../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
}));

// PAN-3917: there is no agents table to rebuild — the fallback when the tmux
// census fails is the agent state files themselves.
vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  listAgentStatesSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/reconstruct/enumerate-in-flight.js', () => ({
  enumerateInFlightIssuesFromSources: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(),
  startSharedIssueService: vi.fn(),
}));

vi.mock('../../../../src/lib/overdeck/pull-requests.js', () => ({
  fetchIssuePullRequest: vi.fn(),
}));

import { listRunningAgents } from '../../../../src/lib/agents.js';
import { listAgentStatesSync } from '../../../../src/lib/agents/agent-state.js';
import { listProjectsSync } from '../../../../src/lib/projects.js';
import { enumerateInFlightIssuesFromSources } from '../../../../src/lib/reconstruct/enumerate-in-flight.js';
import { getSharedIssueService, startSharedIssueService } from '../../../../src/dashboard/server/services/issue-service-singleton.js';
import { fetchIssuePullRequest } from '../../../../src/lib/overdeck/pull-requests.js';

const listRunningAgentsMock = vi.mocked(listRunningAgents);
const listAgentStatesMock = vi.mocked(listAgentStatesSync);
const listProjectsMock = vi.mocked(listProjectsSync);
const enumerateMock = vi.mocked(enumerateInFlightIssuesFromSources);
const getIssueServiceMock = vi.mocked(getSharedIssueService);
const startIssueServiceMock = vi.mocked(startSharedIssueService);
const fetchPrMock = vi.mocked(fetchIssuePullRequest);

function fakeDb(): any {
  return { prepare: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
  listRunningAgentsMock.mockReturnValue(Effect.succeed([]) as any);
  listAgentStatesMock.mockReturnValue([]);
  listProjectsMock.mockReturnValue([]);
  enumerateMock.mockResolvedValue(new Set());
  getIssueServiceMock.mockReturnValue({ getIssues: () => [] } as any);
  startIssueServiceMock.mockResolvedValue(undefined);
});

describe('reconstructCache', () => {
  it('returns empty result when no agents or issues exist', async () => {
    const result = await reconstructCache(fakeDb());
    expect(result.issuesEnumerated).toBe(0);
    expect(result.agentsEnumerated).toBe(0);
    expect(result.phaseCounts).toEqual({ work: 0, review: 0, merge: 0, done: 0 });
    expect(Object.keys(result.agentsById)).toEqual([]);
    expect(Object.keys(result.agentRuntimeById)).toEqual([]);
  });

  it('reports the agents it enumerated', async () => {
    listRunningAgentsMock.mockReturnValue(Effect.succeed([
      agentState({ id: 'agent-pan-1920', issueId: 'PAN-1920' }),
      agentState({ id: 'agent-pan-1920-review', issueId: 'PAN-1920', role: 'review' }),
    ]) as any);

    const result = await reconstructCache(fakeDb());
    expect(result.agentsEnumerated).toBe(2);
    expect(result.agentsById['agent-pan-1920']?.issueId).toBe('PAN-1920');
    expect(result.agentsById['agent-pan-1920']).toMatchObject({ hasLivePane: true, hasLiveTmuxSession: true });
    expect(result.agentRuntimeById['agent-pan-1920']?.activity).toBe('working');
  });

  it('falls back to the agent state files when listRunningAgents fails', async () => {
    listRunningAgentsMock.mockReturnValue(Effect.fail(new Error('tmux unavailable')) as any);
    listAgentStatesMock.mockReturnValue([{
      id: 'agent-pan-1919',
      issueId: 'PAN-1919',
      workspace: '/projects/overdeck/workspaces/feature-pan-1919',
      role: 'work',
      model: 'claude-sonnet-4',
      status: 'stopped',
      startedAt: '2026-06-16T00:00:00Z',
    }] as AgentState[]);

    const result = await reconstructCache(fakeDb());
    expect(result.agentsById['agent-pan-1919']?.status).toBe('stopped');
    expect(result.agentsById['agent-pan-1919']).toMatchObject({ hasLivePane: false, hasLiveTmuxSession: false });
    expect(result.agentRuntimeById['agent-pan-1919']?.activity).toBe('stopped');
  });

  it('derives a merge phase from an APPROVED PR', async () => {
    listProjectsMock.mockReturnValue([{ key: 'overdeck', config: { name: 'overdeck', path: '/projects/overdeck' } }]);
    getIssueServiceMock.mockReturnValue({
      getIssues: () => [{ identifier: 'PAN-1920', state: 'open', status: 'In Progress' }],
    } as any);
    enumerateMock.mockResolvedValue(new Set(['PAN-1920']));
    fetchPrMock.mockResolvedValue({ issueId: 'PAN-1920', pr: { reviewDecision: 'APPROVED' } as any });

    const result = await reconstructCache(fakeDb());
    expect(result.phaseByIssueId['PAN-1920']).toBe('merge');
    expect(result.phaseCounts).toEqual({ work: 0, review: 0, merge: 1, done: 0 });
  });

  it('falls back to review when the PR carries no approval', async () => {
    listProjectsMock.mockReturnValue([{ key: 'overdeck', config: { name: 'overdeck', path: '/projects/overdeck' } }]);
    getIssueServiceMock.mockReturnValue({
      getIssues: () => [{ identifier: 'PAN-1920', state: 'open', status: 'In Progress' }],
    } as any);
    enumerateMock.mockResolvedValue(new Set(['PAN-1920']));
    fetchPrMock.mockResolvedValue({ issueId: 'PAN-1920', pr: { reviewDecision: 'REVIEW_REQUIRED' } as any });

    const result = await reconstructCache(fakeDb());
    expect(result.phaseByIssueId['PAN-1920']).toBe('review');
  });

});
