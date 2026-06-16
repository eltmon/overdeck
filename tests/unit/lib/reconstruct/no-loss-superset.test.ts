import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { reconstructCache } from '../../../../src/lib/reconstruct/reconstruct-cache.js';
import type { AgentState } from '../../../../src/lib/agents.js';

const baselineAgent = (overrides: Partial<AgentState> = {}): AgentState & { tmuxActive: boolean } => ({
  id: 'agent-pan-1920',
  issueId: 'PAN-1920',
  workspace: '/projects/panopticon/workspaces/feature-pan-1920',
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

vi.mock('../../../../src/lib/database/agent-backfill.js', () => ({
  backfillAgentsFromStateJsonSync: vi.fn(),
}));

vi.mock('../../../../src/lib/database/agents-db.js', () => ({
  listAllAgents: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecord: vi.fn(),
  resolveProjectForIssue: vi.fn(),
}));

vi.mock('../../../../src/lib/reconstruct/enumerate-in-flight.js', () => ({
  enumerateInFlightIssuesFromSources: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(),
  startSharedIssueService: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/routes/issues.js', () => ({
  fetchIssuePullRequest: vi.fn(),
}));

import { listRunningAgents } from '../../../../src/lib/agents.js';
import { backfillAgentsFromStateJsonSync } from '../../../../src/lib/database/agent-backfill.js';
import { listAllAgents } from '../../../../src/lib/database/agents-db.js';
import { listProjectsSync } from '../../../../src/lib/projects.js';
import { readIssueRecord, resolveProjectForIssue } from '../../../../src/lib/pan-dir/record.js';
import { enumerateInFlightIssuesFromSources } from '../../../../src/lib/reconstruct/enumerate-in-flight.js';
import { getSharedIssueService, startSharedIssueService } from '../../../../src/dashboard/server/services/issue-service-singleton.js';
import { fetchIssuePullRequest } from '../../../../src/dashboard/server/routes/issues.js';

const listRunningAgentsMock = vi.mocked(listRunningAgents);
const backfillMock = vi.mocked(backfillAgentsFromStateJsonSync);
const listAllAgentsMock = vi.mocked(listAllAgents);
const listProjectsMock = vi.mocked(listProjectsSync);
const readRecordMock = vi.mocked(readIssueRecord);
const resolveProjectMock = vi.mocked(resolveProjectForIssue);
const enumerateMock = vi.mocked(enumerateInFlightIssuesFromSources);
const getIssueServiceMock = vi.mocked(getSharedIssueService);
const startIssueServiceMock = vi.mocked(startSharedIssueService);
const fetchPrMock = vi.mocked(fetchIssuePullRequest);

function fakeDb(): any {
  return { prepare: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
  backfillMock.mockReturnValue({ processed: 0, skipped: 0, markedStopped: 0 });
  listRunningAgentsMock.mockReturnValue(Effect.succeed([]) as any);
  listAllAgentsMock.mockReturnValue([]);
  listProjectsMock.mockReturnValue([]);
  enumerateMock.mockResolvedValue(new Set());
  getIssueServiceMock.mockReturnValue({ getIssues: () => [] } as any);
  startIssueServiceMock.mockResolvedValue(undefined);
});

describe('reconstructCache no-loss superset (PAN-1920)', () => {
  it('does not drop agents or issues present in the cache view', async () => {
    // Baseline cache view: one running agent and two open issues, one of which
    // has a workspace (in-flight). The closed issue is not in reconstruction's
    // in-flight set, so we only assert the in-flight issue is preserved.
    const agent = baselineAgent();
    const openIssue = { identifier: 'PAN-1920', state: 'open', status: 'In Progress' };
    const openIssueNoWorkspace = { identifier: 'PAN-1919', state: 'open', status: 'In Progress' };

    listRunningAgentsMock.mockReturnValue(Effect.succeed([agent]) as any);
    listAllAgentsMock.mockReturnValue([{
      id: agent.id,
      issueId: agent.issueId,
      workspace: agent.workspace,
      role: agent.role,
      status: agent.status,
      harness: agent.harness,
      model: agent.model,
      branch: null,
      sessionId: null,
      startedAt: agent.startedAt,
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
    }] as any);

    listProjectsMock.mockReturnValue([{ key: 'panopticon', config: { name: 'panopticon', path: '/projects/panopticon' } }]);
    getIssueServiceMock.mockReturnValue({
      getIssues: () => [openIssue, openIssueNoWorkspace],
    } as any);
    enumerateMock.mockResolvedValue(new Set(['PAN-1920']));
    resolveProjectMock.mockReturnValue({ name: 'panopticon', path: '/projects/panopticon' } as any);
    readRecordMock.mockResolvedValue({
      issueId: 'PAN-1920',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-1920',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        updatedAt: new Date().toISOString(),
      },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'localhost' },
    } as any);
    fetchPrMock.mockResolvedValue({ issueId: 'PAN-1920', pr: { reviewDecision: 'APPROVED' } as any });

    const result = await reconstructCache(fakeDb());

    // Every agent in the baseline cache view must appear in reconstruction.
    expect(result.agentsById[agent.id]).toBeDefined();
    expect(result.agentsById[agent.id]?.issueId).toBe(agent.issueId);

    // Every in-flight issue in the baseline must be present and its phase must
    // not be downgraded. The baseline phase for an approved PR is merge.
    expect(result.phaseByIssueId['PAN-1920']).toBe('merge');
    expect(result.reviewStatusByIssueId['PAN-1920']?.readyForMerge).toBe(true);
  });
});
