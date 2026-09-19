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

// reconstruct-cache now uses overdeck/agents (not database/agent-backfill or database/agents-db)
vi.mock('../../../../src/lib/overdeck/agents.js', () => ({
  backfillAgentsSync: vi.fn(),
  listAllAgentsSync: vi.fn(),
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
import { backfillAgentsSync, listAllAgentsSync } from '../../../../src/lib/overdeck/agents.js';
import { listProjectsSync } from '../../../../src/lib/projects.js';
import { enumerateInFlightIssuesFromSources } from '../../../../src/lib/reconstruct/enumerate-in-flight.js';
import { getSharedIssueService, startSharedIssueService } from '../../../../src/dashboard/server/services/issue-service-singleton.js';
import { fetchIssuePullRequest } from '../../../../src/lib/overdeck/pull-requests.js';

const listRunningAgentsMock = vi.mocked(listRunningAgents);
const backfillMock = vi.mocked(backfillAgentsSync);
const listAllAgentsMock = vi.mocked(listAllAgentsSync);
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
  backfillMock.mockReturnValue({ processed: 0, skipped: 0, markedStopped: 0, markedStoppedIds: [] });
  listRunningAgentsMock.mockReturnValue(Effect.succeed([]) as any);
  listAllAgentsMock.mockReturnValue([]);
  listProjectsMock.mockReturnValue([]);
  enumerateMock.mockResolvedValue(new Set());
  getIssueServiceMock.mockReturnValue({ getIssues: () => [] } as any);
  startIssueServiceMock.mockResolvedValue(undefined);
});

describe('reconstructCache', () => {
  it('returns empty result when no agents or issues exist', async () => {
    const result = await reconstructCache(fakeDb());
    expect(result.issuesEnumerated).toBe(0);
    expect(result.agentsRebuilt).toBe(0);
    expect(result.markedStoppedIds).toEqual([]);
    expect(result.phaseCounts).toEqual({ work: 0, review: 0, merge: 0, done: 0 });
    expect(Object.keys(result.agentsById)).toEqual([]);
    expect(Object.keys(result.agentRuntimeById)).toEqual([]);
  });

  it('reports agents rebuilt and marked stopped from backfill', async () => {
    backfillMock.mockReturnValue({
      processed: 3,
      skipped: 0,
      markedStopped: 1,
      markedStoppedIds: [{ id: 'agent-pan-old', previousStatus: 'running' }],
    });
    listRunningAgentsMock.mockReturnValue(Effect.succeed([
      agentState({ id: 'agent-pan-1920', issueId: 'PAN-1920' }),
    ]) as any);

    const result = await reconstructCache(fakeDb());
    expect(result.agentsRebuilt).toBe(3);
    expect(result.markedStoppedIds).toEqual([
      { id: 'agent-pan-old', previousStatus: 'running' },
    ]);
    expect(result.agentsById['agent-pan-1920']?.issueId).toBe('PAN-1920');
    expect(result.agentRuntimeById['agent-pan-1920']?.activity).toBe('working');
  });

  it('falls back to agents table when listRunningAgents fails', async () => {
    backfillMock.mockReturnValue({ processed: 1, skipped: 0, markedStopped: 0, markedStoppedIds: [] });
    listRunningAgentsMock.mockReturnValue(Effect.fail(new Error('tmux unavailable')) as any);
    listAllAgentsMock.mockReturnValue([{
      id: 'agent-pan-1919',
      issueId: 'PAN-1919',
      workspace: '/projects/overdeck/workspaces/feature-pan-1919',
      role: 'work',
      status: 'stopped',
      harness: null,
      model: null,
      branch: null,
      sessionId: null,
      startedAt: null,
      lastActivity: null,
      lastResumeAt: null,
      stoppedAt: null,
      stoppedByUser: null,
      stoppedByPause: null,
      kickoffDelivered: null,
      hostOverride: null,
      costSoFar: null,
      phase: null,
      workType: null,
      paused: null,
      pausedReason: null,
      pausedAt: null,
      troubled: null,
      troubledAt: null,
      consecutiveFailures: null,
      firstFailureInRunAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastFailureNextRetryAt: null,
      flywheelRunId: null,
      roleRunHead: null,
      reviewSubRole: null,
      reviewRunId: null,
      reviewSynthesisAgentId: null,
      reviewOutputPath: null,
      reviewDeadlineAt: null,
      reviewMonitorSignaled: null,
      reviewRetryAttempt: null,
      inspectSubRole: null,
      deliveryMethod: null,
      supervisorEnabled: null,
      channelsEnabled: null,
      updatedAt: new Date().toISOString(),
    }]);

    const result = await reconstructCache(fakeDb());
    expect(result.agentsById['agent-pan-1919']?.status).toBe('stopped');
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

  it('passes verbose and listLiveSessions options through', async () => {
    const liveSessions = () => new Set(['agent-pan-1920']);
    await reconstructCache(fakeDb(), { verbose: true, listLiveSessions: liveSessions });
    expect(backfillMock).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true, listLiveSessions: liveSessions }),
    );
  });
});
