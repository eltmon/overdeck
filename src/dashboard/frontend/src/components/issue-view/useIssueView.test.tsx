import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useActivityQuery,
  useIssueCostsQuery,
  useWorkspaceQuery,
  type ActivityResponse,
  type WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useBackendPanes, useDashboardStore, useDerivedIssueState } from '../../lib/store';
import { buildIssueViewModel, useIssueView } from './useIssueView';
import { isAgentRunning, isReadyToMerge, stuckReason } from './index';
import type { DerivedIssueState, DerivedIssueStateName } from '../../types';

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
    hasPendingQuestion: overrides.hasPendingQuestion,
    pendingInputCount: overrides.pendingInputCount,
    pendingAskUserQuestion: overrides.pendingAskUserQuestion,
    pendingProposedPlan: overrides.pendingProposedPlan,
  } as AgentSnapshot;
}

function makeDerived(state: DerivedIssueStateName, overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return { issueId: 'PAN-2499', state, ...overrides };
}

const GREEN_PR = { url: 'https://example.test/pr/2499', number: 2499, reviewState: 'approved', checks: 'green' as const, mergeable: true };

describe('buildIssueViewModel', () => {
  it('exports the canonical issue-view derivations from the component family', () => {
    expect(isAgentRunning).toBeTypeOf('function');
    expect(isReadyToMerge).toBeTypeOf('function');
    expect(stuckReason).toBeTypeOf('function');
  });

  it('produces all ten sub-objects', () => {
    const model = buildIssueViewModel('PAN-2499', 'Title', 'feature/pan-2499', 'overdeck', undefined, undefined, undefined, undefined, {});
    expect(model.header).toBeDefined();
    expect(model.narrative).toBeDefined();
    expect(model.pipeline).toBeDefined();
    expect(model.agents).toBeDefined();
    expect(model.verification).toBeDefined();
    expect(model.ship).toBeDefined();
    expect(model.activity).toBeDefined();
    expect(model.resources).toBeDefined();
    expect(model.operator).toBeDefined();
  });

  it('populates header from options and the derived state', () => {
    const model = buildIssueViewModel(
      'PAN-2499',
      'Unified issue view',
      'feature/pan-2499',
      'overdeck',
      makeDerived('ready', { pr: GREEN_PR }),
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
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('merged', { pr: GREEN_PR }),
      undefined, undefined, undefined, {},
    );
    expect(model.ship.status).toBe('merged');
    expect(model.ship.prUrl).toBe(GREEN_PR.url);
    expect(model.ship.blockerReason).toBeUndefined();
    expect(model.header.phase).toBe('merged');
  });

  // PAN-3420: `pan close` closes the tracker issue, and `closed` outranks
  // `merged`, so a closed-out issue must still render as shipped with its history.
  it('renders a closed-out issue with a merged PR as shipped, not pending or stopped', () => {
    const sessions = [
      makeSession({ type: 'planning', sessionId: 'planning-pan-2499', status: 'stopped', presence: 'ended' }),
      makeSession({ type: 'work', sessionId: 'agent-pan-2499', status: 'stopped', presence: 'ended' }),
      makeSession({ type: 'review', sessionId: 'agent-pan-2499-review', status: 'stopped', presence: 'ended' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('closed', { pr: { ...GREEN_PR, mergeable: null } }),
      undefined, undefined, makeActivity(sessions), {},
    );
    expect(model.ship.status).toBe('merged');
    expect(model.ship.blockerReason).toBeUndefined();
    expect(model.pipeline.plan.done).toBe(true);
    expect(model.pipeline.work.done).toBe(true);
    expect(model.pipeline.review.done).toBe(true);
    expect(model.pipeline.test.done).toBe(true);
    expect(model.pipeline.ship).toMatchObject({ status: 'merged', done: true });
    expect(model.narrative.now).toBe('Merged and closed out');
    expect(model.agents.map((agent) => agent.label)).toEqual(['Plan', 'Work', 'Review']);
    expect(model.operator.needsYouItems).toEqual([]);
  });

  it('does not report a cancelled issue (closed, no PR) as shipped', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('closed'),
      undefined, undefined, makeActivity(sessions), {},
    );
    expect(model.ship.status).toBe('pending');
    expect(model.pipeline.ship.done).toBe(false);
    expect(model.narrative.now).toBe('Closed');
    expect(model.operator.needsYouItems).toEqual([]);
  });

  it('derives the blocker reason from the forge when the PR is not mergeable', () => {
    const model = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('in-review', { pr: { ...GREEN_PR, checks: 'red', mergeable: true } }),
      undefined, undefined, undefined, {},
    );
    expect(model.ship.status).toBe('pending');
    expect(model.ship.checks).toBe('red');
    expect(model.ship.blockerReason).toBe('Checks are red');
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
      makeDerived('working'),
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.operator.needsYou?.kind).toBe('stopped');
    expect(model.operator.needsYou?.sessionId).toBe('agent-pan-2499-slot-2');
    expect(model.operator.needsYouItems).toEqual([
      { kind: 'stopped', sessionId: 'agent-pan-2499-slot-2' },
    ]);
  });

  it('prefers ready_for_merge operator state over stopped', () => {
    const sessions = [makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'stopped', presence: 'ended' })];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeDerived('ready', { pr: GREEN_PR }),
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );
    expect(model.operator.needsYou?.kind).toBe('ready_for_merge');
    expect(model.operator.needsYouItems.map((item) => item.kind)).toEqual([
      'ready_for_merge',
      'stopped',
    ]);
  });

  it('does not classify an active review convoy as stale', () => {
    const sessions = [
      makeSession({ type: 'review', sessionId: 'review-parent', status: 'running', presence: 'active' }),
      makeSession({ type: 'reviewer', sessionId: 'review-security', status: 'running', presence: 'active', role: 'security' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499',
      undefined,
      undefined,
      undefined,
      makeDerived('in-review', { pr: { ...GREEN_PR, reviewState: 'review-requested', checks: 'pending' } }),
      undefined,
      undefined,
      makeActivity(sessions),
      {},
    );

    expect(model.operator.needsYouItems).toEqual([]);
    expect(model.operator.needsYou).toBeNull();
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

  it('reads the review step off the derived state, not off historical sessions', () => {
    const sessions = [
      makeSession({ type: 'review', sessionId: 'review-old', status: 'stopped', presence: 'ended' }),
      makeSession({ type: 'test', sessionId: 'test-old', status: 'stopped', presence: 'ended' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('changes-requested', { pr: { ...GREEN_PR, reviewState: 'changes-requested', checks: 'red' } }),
      undefined, undefined, makeActivity(sessions), {},
    );

    expect(model.pipeline.review).toEqual({ status: 'failed', active: false, done: false });
    expect(model.pipeline.test).toEqual({ status: 'failed', active: false, done: false });
  });

  it('uses live reviewer sessions only to mark the review step active', () => {
    const sessions = [
      makeSession({ type: 'review', sessionId: 'review-live', status: 'running', presence: 'active' }),
    ];
    const model = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('in-review', { pr: { ...GREEN_PR, reviewState: 'review-requested', checks: 'pending' } }),
      undefined, undefined, makeActivity(sessions), {},
    );

    expect(model.pipeline.review).toEqual({ status: 'passed', active: true, done: true });
    expect(model.pipeline.test).toEqual({ status: 'pending', active: true, done: false });
  });

  it('renders the PR check runs as the one verification gate (FR-8)', () => {
    const failing = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('in-review', { pr: { ...GREEN_PR, checks: 'red' } }),
      undefined, undefined, undefined, {},
    );
    expect(failing.verification.status).toBe('failed');
    expect(failing.verification.gates.map((g) => `${g.id}:${g.status}`)).toEqual(['checks:failed']);

    const green = buildIssueViewModel(
      'PAN-2499', undefined, undefined, undefined,
      makeDerived('ready', { pr: GREEN_PR }),
      undefined, undefined, undefined, {},
    );
    expect(green.verification.gates.map((g) => `${g.id}:${g.status}`)).toEqual(['checks:passed']);
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

  it('reads the derived state and the backend panes alongside the artifact queries', () => {
    vi.mocked(useDerivedIssueState).mockReturnValue(makeDerived('working'));
    vi.mocked(useBackendPanes).mockReturnValue([]);
    vi.mocked(useIssueCostsQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useIssueCostsQuery>);
    vi.mocked(useWorkspaceQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useWorkspaceQuery>);
    vi.mocked(useActivityQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useActivityQuery>);
    vi.mocked(useDashboardStore).mockImplementation((selector) => selector({ agentsById: {} } as never));

    const { result } = renderHook(() => useIssueView('PAN-2499'), { wrapper: wrapper(queryClient) });

    expect(useDerivedIssueState).toHaveBeenCalledWith('PAN-2499');
    expect(useBackendPanes).toHaveBeenCalledWith('PAN-2499');
    expect(useIssueCostsQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useWorkspaceQuery).toHaveBeenCalledWith('PAN-2499');
    expect(useActivityQuery).toHaveBeenCalledWith('PAN-2499');
    expect(result.current.header.issueId).toBe('PAN-2499');
    expect(result.current.header.phase).toBe('working');
  });

  it('passes store agents into the model', () => {
    const agent = makeAgent({ id: 'agent-pan-2499-slot-2', sessionId: 'agent-pan-2499-slot-2', status: 'running' });
    const activity = makeActivity([makeSession({ type: 'work', sessionId: 'agent-pan-2499-slot-2', status: 'running', presence: 'active' })]);
    vi.mocked(useDerivedIssueState).mockReturnValue(makeDerived('working'));
    vi.mocked(useBackendPanes).mockReturnValue([]);
    vi.mocked(useIssueCostsQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useIssueCostsQuery>);
    vi.mocked(useWorkspaceQuery).mockReturnValue({ data: undefined } as ReturnType<typeof useWorkspaceQuery>);
    vi.mocked(useActivityQuery).mockReturnValue({ data: activity } as ReturnType<typeof useActivityQuery>);
    vi.mocked(useDashboardStore).mockImplementation((selector) => selector({ agentsById: { 'agent-pan-2499-slot-2': agent } } as never));

    const { result } = renderHook(() => useIssueView('PAN-2499'), { wrapper: wrapper(queryClient) });

    expect(result.current.agents[0]!.active).toBe(true);
  });
});
