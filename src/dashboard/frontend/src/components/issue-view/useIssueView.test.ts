import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useActivityQuery,
  useIssueCostsQuery,
  useReviewStatusQuery,
  useShipLogQuery,
  useWorkspaceQuery,
  type ActivityResponse,
  type IssueCostData,
  type ReviewStatusData,
  type WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useDashboardStore } from '../../lib/store';
import { buildIssueViewModel, useIssueView } from './useIssueView';

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries');
vi.mock('../../lib/store');

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeSession(overrides: Partial<SessionNode> & { sessionId: string; type: SessionNode['type'] }): SessionNode {
  return {
    type: overrides.type,
    sessionId: overrides.sessionId,
    model: overrides.model ?? 'claude-sonnet-5',
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    duration: overrides.duration ?? null,
    status: overrides.status ?? 'running',
    presence: overrides.presence ?? 'active',
    role: overrides.role,
    harness: overrides.harness,
    tmuxSession: overrides.tmuxSession,
    roundMetadata: overrides.roundMetadata,
    awaitingInput: overrides.awaitingInput,
    paused: overrides.paused,
    pausedReason: overrides.pausedReason,
    troubled: overrides.troubled,
    troubledReason: overrides.troubledReason,
  };
}

function makeActivity(sections: SessionNode[]): ActivityResponse {
  return {
    issueId: 'PAN-2499',
    sections: sections.map((s) => ({
      type: s.type,
      sessionId: s.sessionId,
      model: s.model,
      startedAt: s.startedAt,
      duration: s.duration,
      status: s.status,
      tmuxSession: s.tmuxSession,
      role: s.role,
      roundMetadata: s.roundMetadata,
    })),
    totalCost: 0,
    aggregateCost: null,
  };
}

function makeAgent(overrides: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: overrides.id,
    issueId: overrides.issueId ?? 'PAN-2499',
    status: overrides.status ?? 'running',
    sessionId: overrides.sessionId,
    model: overrides.model,
    runtime: overrides.runtime,
    role: overrides.role,
    paused: overrides.paused,
    pausedReason: overrides.pausedReason,
    troubled: overrides.troubled,
    troubledReason: overrides.troubledReason,
    hasPendingQuestion: overrides.hasPendingQuestion,
    pendingInputCount: overrides.pendingInputCount,
    pendingAskUserQuestion: overrides.pendingAskUserQuestion,
    pendingProposedPlan: overrides.pendingProposedPlan,
  } as AgentSnapshot;
}

function makeReviewStatus(overrides: Partial<ReviewStatusData> = {}): ReviewStatusData {
  return {
    issueId: 'PAN-2499',
    reviewStatus: 'pending',
    testStatus: 'pending',
    readyForMerge: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildIssueViewModel', () => {
  it('produces all ten sub-objects', () => {
    const model = buildIssueViewModel('PAN-2499', 'Title', 'feature/pan-2499', 'overdeck', undefined, undefined, undefined, undefined, {});
    expect(model.header).toBeDefined();
    expect(model.narrative).toBeDefined();
    expect(model.pipeline).toBeDefined();
    expect(model.agents).toBeDefined();
    expect(model.verification).toBeDefined();
    expect(model.ship).toBeDefined();
    expect(model.beads).toBeDefined();
    expect(model.activity).toBeDefined();
    expect(model.resources).toBeDefined();
    expect(model.operator).toBeDefined();
  });

  it('populates header from options and review status', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      'Unified issue view',
      'feature/pan-2499',
      'overdeck',
      makeReviewStatus({ readyForMerge: true }),
      { issueId: 'PAN-2499', totalCost: 4.56, totalTokens: 9000, sessions: [], byModel: {} },
      undefined,
      undefined,
      {},
    );
    expect(model.header.issueId).toBe('PAN-2499');
    expect(model.header.title).toBe('Unified issue view');
    expect(model.header.branch).toBe('feature/pan-2499');
    expect(model.header.projectName).toBe('overdeck');
    expect(model.header.cost).toBe('$4.56');
    expect(model.header.phase).toBe('ready');
  });

  it('maps activity sections to AgentRowModel with active detection', () => {
    const sessions = [
      makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' }),
      makeSession({ type: 'reviewer', sessionId: 'agent-pan-2499-review-correctness', status: 'stopped', presence: 'ended', role: 'correctness' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', sessionId: 'agent-pan-2499-slot-2', status: 'running' }),
      },
    );
    expect(model.agents).toHaveLength(2);
    const work = model.agents[0]!;
    expect(work.type).toBe('work');
    expect(work.label).toBe('Slot 2');
    expect(work.status).toBe('running');
    expect(work.active).toBe(true);
    const reviewer = model.agents[1]!;
    expect(reviewer.type).toBe('reviewer');
    expect(reviewer.label).toBe('Correctness');
    expect(reviewer.icon).toBe('reviewer-correctness');
    expect(reviewer.active).toBe(false);
  });

  it('detects a running agent from snapshot status even when session is idle', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', sessionId: 'agent-pan-2499-slot-2', status: 'starting' }),
      },
    );
    expect(model.agents[0]!.active).toBe(true);
  });

  it('flags pending input from agent snapshot', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {
        'agent-pan-2499-slot-2': makeAgent({
          id: 'agent-pan-2499-slot-2',
          sessionId: 'agent-pan-2499-slot-2',
          pendingInputCount: 1,
          pendingAskUserQuestion: { toolUseId: 'q1', askedAt: new Date().toISOString(), questions: [] },
        }),
      },
    );
    expect(model.agents[0]!.pendingInput).toBe(true);
  });

  it('formats reviewer verdict approved/changes_requested', () => {
    const sessions = [
      makeSession({
        type: 'reviewer',
        sessionId: 'agent-pan-2499-review-correctness',
        status: 'stopped',
        presence: 'ended',
        role: 'correctness',
        roundMetadata: { roundCount: 1, latestRound: 1, latestReviewResult: 'APPROVED', history: [] },
      }),
      makeSession({
        type: 'reviewer',
        sessionId: 'agent-pan-2499-review-security',
        status: 'stopped',
        presence: 'ended',
        role: 'security',
        roundMetadata: { roundCount: 1, latestRound: 1, latestReviewResult: 'CHANGES_REQUESTED', history: [] },
      }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.agents[0]!.verdict).toBe('approved');
    expect(model.agents[1]!.verdict).toBe('changes_requested');
  });

  it('derives merged ship status', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ mergeStatus: 'merged', readyForMerge: true }),
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(model.ship.status).toBe('merged');
    expect(model.ship.readyForMerge).toBe(true);
    expect(model.ship.mergeStep).toBe('merged');
    expect(model.ship.blockerReason).toBeUndefined();
    expect(model.header.phase).toBe('merged');
  });

  it('derives ready-for-merge ship status and blocker reason when not ready', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ reviewStatus: 'passed', testStatus: 'failed', readyForMerge: false }),
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(model.ship.status).toBe('pending');
    expect(model.ship.readyForMerge).toBe(false);
    expect(model.ship.blockerReason).toBe('Tests failed');
  });

  it('uses explicit mergeStep when available', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ mergeStatus: 'queued', readyForMerge: false, mergeStep: 'awaiting-queue-slot' } as ReviewStatusData),
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(model.ship.mergeStep).toBe('awaiting-queue-slot');
  });

  it('reports operator troubled state from agent snapshot', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'error', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {
        'agent-pan-2499-slot-2': makeAgent({
          id: 'agent-pan-2499-slot-2',
          sessionId: 'agent-pan-2499-slot-2',
          troubled: true,
          troubledReason: 'crash loop',
        }),
      },
    );
    expect(model.operator.needsYou?.kind).toBe('troubled');
    expect(model.operator.needsYou?.sessionId).toBe('agent-pan-2499-slot-2');
    expect(model.operator.needsYou?.reason).toBe('crash loop');
  });

  it('reports operator paused state from agent snapshot', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {
        'agent-pan-2499-slot-2': makeAgent({
          id: 'agent-pan-2499-slot-2',
          sessionId: 'agent-pan-2499-slot-2',
          paused: true,
          pausedReason: 'operator pause',
        }),
      },
    );
    expect(model.operator.needsYou?.kind).toBe('paused');
    expect(model.operator.needsYou?.reason).toBe('operator pause');
  });

  it('reports operator stopped state when work is not running and not merged', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus(),
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.operator.needsYou?.kind).toBe('stopped');
    expect(model.operator.needsYou?.sessionId).toBe('agent-pan-2499-slot-2');
  });

  it('prefers ready_for_merge operator state over stopped', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ readyForMerge: true }),
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.operator.needsYou?.kind).toBe('ready_for_merge');
  });

  it('marks pipeline steps done/active based on sessions and review status', () => {
    const sessions = [
      makeSession({ type: 'planning', sessionId: 'plan-1', status: 'stopped', presence: 'ended' }),
      makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.pipeline.plan.done).toBe(true);
    expect(model.pipeline.work.active).toBe(true);
    expect(model.pipeline.review.status).toBe('pending');
    expect(model.pipeline.ship.status).toBe('pending');
  });

  it('includes verification gates', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ verificationStatus: 'failed', verificationNotes: 'Verification FAILED at lint' }),
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(model.verification.status).toBe('failed');
    expect(model.verification.gates.map((g) => `${g.id}:${g.status}`)).toEqual([
      'typecheck:passed',
      'lint:failed',
      'test:pending',
      'uat:infra-unavailable',
    ]);
  });

  it('maps uat status from review status when workspace has docker', () => {
    const workspace: WorkspaceData = { exists: true, issueId: 'PAN-2499', hasDocker: true };
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeReviewStatus({ uatStatus: 'passed' }),
      undefined,
      workspace,
      undefined,
      {},
    );
    expect(model.verification.gates.find((g) => g.id === 'uat')?.status).toBe('passed');
  });

  it('exposes resources from workspace query', () => {
    const workspace: WorkspaceData = { exists: true, issueId: 'PAN-2499', path: '/workspaces/feature-pan-2499' };
    const model = buildIssueViewModel('PAN-2499', undefined, undefined, undefined, undefined, undefined, workspace, undefined, {});
    expect(model.resources.exists).toBe(true);
    expect(model.resources.workspace?.path).toBe('/workspaces/feature-pan-2499');
  });

  it('includes activity sections unchanged', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' })];
    const activity = makeActivity(sessions);
    const model = buildIssueViewModel('PAN-2499', undefined, undefined, undefined, undefined, undefined, undefined, activity, {});
    expect(model.activity.sections).toHaveLength(1);
    expect(model.activity.sections[0]!.sessionId).toBe('agent-pan-2499-slot-2');
  });
});

describe('useIssueView hook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.resetAllMocks();
  });

  it('reuses the four existing query hooks', () => {
    vi.mocked(useReviewStatusQuery).mockReturnValue({ data: makeReviewStatus() } as ReturnType<typeof useReviewStatusQuery>);
    vi.mocked(useIssueCostsQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useIssueCostsQuery>);
    vi.mocked(useWorkspaceQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useWorkspaceQuery>);
    vi.mocked(useActivityQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useActivityQuery>);
    vi.mocked(useShipLogQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useShipLogQuery>);
    vi.mocked(useDashboardStore).mockImplementation((selector) => selector({ agentsById: {} } as never));

    const { result } = renderHook(() => useIssueView('PAN-2499'), { wrapper: wrapper(queryClient) });

    expect(useReviewStatusQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useIssueCostsQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useWorkspaceQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useActivityQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useShipLogQuery).toHaveBeenCalledWith('PAN-2499');
    expect(result.current.header.issueId).toBe('PAN-2499');
  });

  it('passes store agents into the model', () => {
    const agent = makeAgent({ id: 'agent-pan-2499-slot-2', sessionId: 'agent-pan-2499-slot-2', status: 'running' });
    const activity = makeActivity([makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' })]);
    vi.mocked(useReviewStatusQuery).mockReturnValue({ data: makeReviewStatus() } as ReturnType<typeof useReviewStatusQuery>);
    vi.mocked(useIssueCostsQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useIssueCostsQuery>);
    vi.mocked(useWorkspaceQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useWorkspaceQuery>);
    vi.mocked(useActivityQuery).mockReturnValue({ data: activity } as ReturnType<typeof useActivityQuery>);
    vi.mocked(useShipLogQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useShipLogQuery>);
    vi.mocked(useDashboardStore).mockImplementation((selector) => selector({ agentsById: { 'agent-pan-2499-slot-2': agent } } as never));

    const { result } = renderHook(() => useIssueView('PAN-2499'), { wrapper: wrapper(queryClient) });

    expect(result.current.agents[0]!.active).toBe(true);
  });
});
