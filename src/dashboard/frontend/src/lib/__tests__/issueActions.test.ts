import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import { DialogProvider } from '../../components/DialogProvider';
import { useIssueActions } from '../../components/IssueActionMenu/useIssueActions';
import type { Agent, Issue } from '../../types';
import {
  GROUP_LABELS,
  GROUP_ORDER,
  ISSUE_ACTIONS,
  PROJECT_TREE_CONTEXT_ACTIONS,
  ZONE_B_SESSION_ACTIONS,
  deriveIssueActionPhase,
  getEnabledActions,
  getPhasePrimaryActions,
  type IssueActionKey,
  type IssueActionState,
  type PipelinePhase,
} from '../issueActions';
import { useDashboardStore } from '../store';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const prdActionKeys: readonly IssueActionKey[] = [
  'plan',
  'autoPlan',
  'watchPlanning',
  'donePlanning',
  'startAgent',
  'startSkipPlanning',
  'tell',
  'doneWork',
  'requestReview',
  'restartReview',
  'recoverReview',
  'stopAgent',
  'pause',
  'unpause',
  'untroubled',
  'recoverAgent',
  'resumeSession',
  'syncMain',
  'inspectTask',
  'reopen',
  'closeOut',
  'wipe',
  'destroyWorkspace',
  'open',
  'resetIssue',
  'resetToPlanned',
  'viewPr',
];

const preservedActionKeys: readonly IssueActionKey[] = [
  'cancel',
  'tasks',
  'inference',
  'discussions',
  'transcripts',
  'upload',
  'syncDiscussions',
  'statusReview',
  'createWorkspace',
  'copySettings',
  'resetSession',
  'completeWorkReset',
  'restartFromPlan',
  'restartAgent',
  'addToOrderBook',
];

const baseState: IssueActionState = {
  reviewStatus: null,
  agent: null,
  lifecycle: null,
  workspace: { exists: true, path: '/tmp/workspace' },
  hasPlan: false,
  hasTasks: false,
  issueCanonicalState: 'todo',
  isMerged: false,
};

function keys(actions: { key: IssueActionKey }[]) {
  return actions.map((action) => action.key);
}

function action(key: IssueActionKey) {
  const entry = ISSUE_ACTIONS.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Missing action ${key}`);
  return entry;
}

function reviewStatus(overrides: Partial<NonNullable<IssueActionState['reviewStatus']>> = {}): NonNullable<IssueActionState['reviewStatus']> {
  return {
    issueId: 'PAN-1331',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  };
}

function reviewIssue(): Issue {
  return {
    id: 'issue-pan-3340',
    identifier: 'PAN-3340',
    title: 'Choose review mode',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://example.test/PAN-3340',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    project: { id: 'pan', name: 'Overdeck', color: '#fff' },
    hasPlan: true,
    hasTasks: true,
    workspacePath: '/tmp/feature-pan-3340',
  };
}

function stoppedWorkAgent(): Agent {
  return {
    id: 'agent-pan-3340',
    issueId: 'PAN-3340',
    runtime: 'claude-code',
    model: 'claude-opus-5',
    status: 'stopped',
    startedAt: '2026-07-30T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
  };
}

function renderReviewActions() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useIssueActions('PAN-3340'), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider,
      { client },
      createElement(DialogProvider, null, children),
    ),
  });
}

describe('ISSUE_ACTIONS', () => {
  it('contains every PRD action key and every preserved existing action key', () => {
    const registered = new Set(ISSUE_ACTIONS.map((action) => action.key));

    for (const key of prdActionKeys) expect(registered.has(key), key).toBe(true);
    for (const key of preservedActionKeys) expect(registered.has(key), key).toBe(true);
    expect(registered.size).toBe(ISSUE_ACTIONS.length);
  });

  it('exports every action group once in the fixed six-group order (C-ACTIONS)', () => {
    expect(GROUP_ORDER).toEqual([
      'communicate',
      'lifecycle',
      'recover',
      'inspect',
      'navigation',
      'danger',
    ]);
    expect(new Set(GROUP_ORDER).size).toBe(GROUP_ORDER.length);
    expect(Object.keys(GROUP_LABELS)).toEqual(GROUP_ORDER);
    for (const action of ISSUE_ACTIONS) {
      expect(GROUP_ORDER, action.key).toContain(action.group);
    }
  });

  it('fully describes every registry entry', () => {
    for (const action of ISSUE_ACTIONS) {
      expect(action.label.trim(), action.key).not.toBe('');
      expect(action.description.trim(), action.key).not.toBe('');
      expect(action, action.key).toHaveProperty('panVerb');
      expect(action, action.key).toHaveProperty('endpoint');
      expect(typeof action.enabledWhen, action.key).toBe('function');
      expect(Array.isArray(action.phasePrimary), action.key).toBe(true);
      expect(['safe', 'dialog', 'destructive']).toContain(action.kind);
      expect(action.group.trim(), action.key).not.toBe('');
    }
  });

  it('discriminates issue entries from executable non-issue entries by scope', () => {
    expect(ISSUE_ACTIONS.every((entry) => entry.scope === 'issue')).toBe(true);

    for (const action of [...PROJECT_TREE_CONTEXT_ACTIONS, ...ZONE_B_SESSION_ACTIONS]) {
      expect(action.scope, action.key).not.toBe('issue');
      expect(action.description.trim(), action.key).not.toBe('');
      expect(typeof action.enabledWhen, action.key).toBe('function');
      expect(typeof action.invoke, action.key).toBe('function');
      expect(['safe', 'dialog', 'destructive'], action.key).toContain(action.kind);
      expect(action, action.key).toHaveProperty('confirm');
    }
  });

  it('executes callback-backed session actions through surface-provided context', async () => {
    const onViewTerminal = vi.fn();
    const viewTerminal = ZONE_B_SESSION_ACTIONS.find((entry) => entry.key === 'viewTerminal');
    if (!viewTerminal) throw new Error('Missing viewTerminal action');

    const context = {
      sessionId: 'agent-pan-1610',
      tmuxSession: 'agent-pan-1610',
      onViewTerminal,
    };

    expect(viewTerminal.enabledWhen(context)).toBe(true);
    await viewTerminal.invoke(context);
    expect(onViewTerminal).toHaveBeenCalledWith('agent-pan-1610');
  });

  it('enables restart only for focused work sessions', () => {
    const restartSession = ZONE_B_SESSION_ACTIONS.find((entry) => entry.key === 'restartSession');
    if (!restartSession) throw new Error('Missing restartSession action');

    expect(restartSession.enabledWhen({
      sessionId: 'agent-pan-1610',
      sessionType: 'work',
      onRestartSession: vi.fn(),
    })).toBe(true);
    expect(restartSession.enabledWhen({
      sessionId: 'planning-pan-1610',
      sessionType: 'planning',
      onRestartSession: vi.fn(),
    })).toBe(false);
  });

  it('exports focused-session metadata without requiring a JSONL transcript', async () => {
    const onExportSessionMetadata = vi.fn();
    const exportMetadata = ZONE_B_SESSION_ACTIONS.find(
      (entry) => entry.key === 'exportSessionMetadata',
    );
    if (!exportMetadata) throw new Error('Missing exportSessionMetadata action');
    const context = {
      sessionId: 'agent-pan-1610',
      hasJsonl: false,
      onExportSessionMetadata,
    };

    expect(exportMetadata.enabledWhen(context)).toBe(true);
    await exportMetadata.invoke(context);
    expect(onExportSessionMetadata).toHaveBeenCalledWith('agent-pan-1610');
  });

  it('derives confirmation copy for destructive non-issue actions from invocation context', () => {
    const stopSession = ZONE_B_SESSION_ACTIONS.find((entry) => entry.key === 'stopSession');
    const deepWipe = PROJECT_TREE_CONTEXT_ACTIONS.find((entry) => entry.key === 'deepWipe');

    expect(stopSession?.confirm?.message({ sessionId: 'agent-pan-1610' })).toBe('Stop session agent-pan-1610?');
    expect(deepWipe?.confirm?.message({ issueId: 'PAN-1610' })).toContain('PAN-1610');
  });

  it('filters enabled actions without mutating registry order', () => {
    const enabled = keys(getEnabledActions({
      ...baseState,
      hasPlan: true,
      hasTasks: true,
      hasInference: true,
      hasDiscussions: true,
      hasTranscripts: true,
      agent: { status: 'stopped', git: { branch: 'feature/pan-1331', latestCommit: 'abc', uncommittedFiles: 0 } },
      lifecycle: { canResumeSession: true },
    }));

    expect(enabled).toContain('tasks');
    expect(enabled).toContain('inference');
    expect(enabled).toContain('discussions');
    expect(enabled).toContain('transcripts');
    expect(enabled).toContain('syncMain');
    expect(enabled).toContain('resumeSession');
    expect(enabled).toContain('resetSession');
  });

  it('declares real CLI verbs only for issue-scoped pan commands', () => {
    expect(action('doneWork').label).toBe('Done — mark work complete & start review');
    expect(action('restartReview').label).toBe('Re-run review on latest commit');
    expect(action('recoverReview').label).toBe('Reset stalled review state');
    expect(action('purgeReview').label).toBe('Remove review sessions & reset');
    expect(action('requestReview').panVerb).toBe('review request');
    expect(action('restartReview').panVerb).toBe('review restart');
    expect(action('recoverReview').panVerb).toBe('review reset');
    expect(action('stopAgent').panVerb).toBe('kill');
    expect(action('resetIssue').panVerb).toBeNull();
    expect(action('resetToPlanned').panVerb).toBe('reset-to-planned');
    expect(action('restartFromPlan').panVerb).toBeNull();
    expect(action('restartAgent').panVerb).toBeNull();
    expect(action('completeWorkReset').panVerb).toBeNull();
    expect(action('completeWorkReset').kind).toBe('destructive');
    expect(action('completeWorkReset').group).toBe('danger');
    expect(action('completeWorkReset').endpoint).toBe('/api/agents/:agentId/restart-fresh');
  });

  it('aligns PRD action kinds for lifecycle and navigation actions', () => {
    expect(action('watchPlanning').kind).toBe('dialog');
    expect(action('donePlanning').kind).toBe('safe');
    expect(action('doneWork').kind).toBe('safe');
    expect(action('requestReview').kind).toBe('safe');
    expect(action('restartReview').kind).toBe('safe');
    expect(action('recoverReview').kind).toBe('safe');
    expect(action('stopAgent').kind).toBe('safe');
    expect(action('recoverAgent').kind).toBe('safe');
    expect(action('reopen').kind).toBe('safe');
    expect(action('open').kind).toBe('safe');
    expect(action('closeOut').kind).toBe('destructive');
    expect(action('wipe').kind).toBe('destructive');
    expect(action('resetIssue').kind).toBe('destructive');
    expect(action('resetToPlanned').kind).toBe('destructive');
    expect(action('cancel').kind).toBe('destructive');
  });

  it('enables order-book promotion only for open issues outside non-complete books', () => {
    const available = { ...baseState, orderBooksLoaded: true, isInActiveOrderBook: false };
    expect(action('addToOrderBook').enabledWhen(available)).toBe(true);
    expect(action('addToOrderBook').enabledWhen({ ...available, issueCanonicalState: 'done' })).toBe(false);
    expect(action('addToOrderBook').enabledWhen({ ...available, isInActiveOrderBook: true })).toBe(false);
    expect(action('addToOrderBook').enabledWhen({ ...available, orderBooksLoaded: false })).toBe(false);
  });

  it('does not enable running-agent actions for stopped agents', () => {
    const stopped: IssueActionState = {
      ...baseState,
      agent: { status: 'stopped', role: 'work' },
      lifecycle: { canResumeSession: true },
    };

    expect(action('tell').enabledWhen(stopped)).toBe(false);
    expect(action('stopAgent').enabledWhen(stopped)).toBe(false);
    expect(action('pause').enabledWhen(stopped)).toBe(false);
    expect(action('recoverAgent').enabledWhen(stopped)).toBe(true);
    expect(action('resumeSession').enabledWhen(stopped)).toBe(true);
  });

  it('gates planning and review actions to their lifecycle states', () => {
    const planningActive: IssueActionState = { ...baseState, agent: { status: 'running', role: 'plan' }, issueCanonicalState: 'in_progress' };
    const planAgentIdle: IssueActionState = { ...baseState, hasPlan: true, agent: { status: 'stopped', role: 'plan' } };
    const workRunning: IssueActionState = { ...baseState, hasPlan: true, agent: { status: 'running', role: 'work' }, issueCanonicalState: 'in_progress' };
    const readyForReview: IssueActionState = { ...baseState, hasPlan: true, workspace: { exists: true }, agent: { status: 'stopped', role: 'work' } };
    const reviewRunning: IssueActionState = { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'reviewing' }) };
    const reviewFailed: IssueActionState = { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'failed' }) };

    expect(action('watchPlanning').enabledWhen(planningActive)).toBe(true);
    expect(action('watchPlanning').enabledWhen(baseState)).toBe(false);
    expect(action('donePlanning').enabledWhen(planAgentIdle)).toBe(true);
    expect(action('donePlanning').enabledWhen(planningActive)).toBe(false);
    expect(action('doneWork').enabledWhen(workRunning)).toBe(true);
    expect(action('doneWork').enabledWhen(planAgentIdle)).toBe(false);
    expect(action('requestReview').enabledWhen(readyForReview)).toBe(true);
    expect(action('requestReview').enabledWhen(workRunning)).toBe(false);
    expect(action('restartReview').enabledWhen(reviewRunning)).toBe(true);
    expect(action('recoverReview').enabledWhen(reviewFailed)).toBe(true);
    expect(action('recoverAgent').enabledWhen(reviewRunning)).toBe(false);
  });

  it('enables rebuildAndStart wherever a normal start is viable and a workspace exists', () => {
    const canStart: IssueActionState = {
      ...baseState,
      hasPlan: true,
      hasTasks: true,
      agent: { status: 'stopped', role: 'work' },
    };
    expect(action('rebuildAndStart').enabledWhen(canStart)).toBe(true);
    // rebuild operates on the workspace's Docker stack → requires a workspace
    expect(action('rebuildAndStart').enabledWhen({ ...canStart, workspace: { exists: false, path: undefined } })).toBe(false);
    // mirrors canStartAgent: needs plan + tasks, a stopped agent, not merged
    expect(action('rebuildAndStart').enabledWhen({ ...canStart, hasPlan: false })).toBe(false);
    expect(action('rebuildAndStart').enabledWhen({ ...canStart, hasTasks: false })).toBe(false);
    expect(action('rebuildAndStart').enabledWhen({ ...canStart, agent: { status: 'running', role: 'work' } })).toBe(false);
    expect(action('rebuildAndStart').enabledWhen({ ...canStart, isMerged: true })).toBe(false);
  });

  it('points rebuildAndStart at the chained workspace endpoint as a safe action', () => {
    expect(action('rebuildAndStart').endpoint).toBe('/api/workspaces/:id/rebuild-and-start');
    expect(action('rebuildAndStart').kind).toBe('safe');
    expect(action('rebuildAndStart').group).toBe('recover');
  });
});

describe('requestReview mode submenu', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) {
        return Response.json({ csrfToken: 'test-csrf-token' });
      }
      if (url === '/api/orders') {
        return Response.json({ books: [] });
      }
      return Response.json({ success: true });
    }));
    useDashboardStore.setState({
      issuesRaw: [reviewIssue()],
      agentsById: { 'agent-pan-3340': stoppedWorkAgent() },
      reviewStatusByIssueId: {},
      drawer: { issueId: null, tab: 'overview' },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('exposes full, quick, and none options with hint labels', () => {
    const { result } = renderReviewActions();
    const requestReview = result.current.all.find((view) => view.action.key === 'requestReview');

    expect(requestReview?.enabled).toBe(true);
    expect(requestReview?.submenu?.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'full', label: 'Full — 4-reviewer convoy' },
      { key: 'quick', label: 'Quick — single pass (default)' },
      { key: 'none', label: 'None — skip AI review' },
    ]);
  });

  it('posts the selected full mode to the review trigger endpoint', async () => {
    const { result } = renderReviewActions();
    const requestReview = result.current.all.find((view) => view.action.key === 'requestReview');

    act(() => requestReview?.submenu?.find((option) => option.key === 'full')?.invoke());

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/review/PAN-3340/trigger',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reviewMode: 'full' }),
      }),
    ));
  });

  it('toasts the selected mode and keeps direct invokes mode-less', async () => {
    const { result } = renderReviewActions();
    const requestReview = result.current.all.find((view) => view.action.key === 'requestReview');

    act(() => requestReview?.submenu?.find((option) => option.key === 'full')?.invoke());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('PAN-3340: review requested (full mode)'));
    await waitFor(() => expect(result.current.isActionPending('requestReview')).toBe(false));

    vi.mocked(toast.success).mockClear();
    act(() => requestReview?.invoke());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('PAN-3340: review requested'));
  });
});

describe('getPhasePrimaryActions', () => {
  const cases: Array<[PipelinePhase, IssueActionState, IssueActionKey[]]> = [
    ['QUEUED_FOR_PLAN', { ...baseState, workspace: { exists: false }, hasPlan: false, issueCanonicalState: 'todo' }, ['plan', 'startAgent']],
    ['PLANNING', { ...baseState, agent: { status: 'running', role: 'plan' }, issueCanonicalState: 'in_progress' }, ['watchPlanning', 'donePlanning']],
    ['PLANNED_IDLE', { ...baseState, hasPlan: true, issueCanonicalState: 'todo' }, ['startAgent']],
    ['WORK_RUNNING', { ...baseState, agent: { status: 'running', role: 'work' }, issueCanonicalState: 'in_progress' }, ['tell', 'doneWork']],
    ['INPUT', { ...baseState, agent: { status: 'running', role: 'work' }, hasPendingInput: true }, ['open', 'tell']],
    ['REVIEW_RUNNING', { ...baseState, agent: { status: 'running', role: 'review' }, reviewStatus: reviewStatus({ reviewStatus: 'reviewing' }) }, ['tell', 'recoverAgent']],
    ['SHIP_RUNNING', { ...baseState, agent: { status: 'running', role: 'ship' }, reviewStatus: reviewStatus({ mergeStatus: 'merging' }) }, ['tell', 'recoverAgent']],
    ['CHANGES_REQUESTED', { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'blocked' }) }, ['open', 'requestReview']],
    ['STUCK', { ...baseState, agent: { status: 'failed', role: 'work' }, reviewStatus: reviewStatus({ testStatus: 'failed' }) }, ['recoverAgent', 'tell']],
    ['READY_TO_MERGE', { ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true }), hasPr: true }, ['merge', 'viewPr']],
    ['MERGED', { ...baseState, isMerged: true, reviewStatus: reviewStatus({ mergeStatus: 'merged' }) }, ['closeOut']],
  ];

  it.each(cases)('returns the ordered %s primary action set', (phase, state, expected) => {
    expect(keys(getPhasePrimaryActions(state, phase))).toEqual(expected);
  });

  it('derives the selector phase from the shared pipeline classifier', () => {
    expect(deriveIssueActionPhase({ ...baseState, hasPlan: false, issueCanonicalState: 'todo' })).toBe('QUEUED_FOR_PLAN');
    expect(deriveIssueActionPhase({ ...baseState, agent: { status: 'running', role: 'plan' }, issueCanonicalState: 'in_progress' })).toBe('PLANNING');
    expect(deriveIssueActionPhase({ ...baseState, agent: { status: 'running', role: 'work' }, issueCanonicalState: 'in_progress' })).toBe('WORK_RUNNING');
    expect(deriveIssueActionPhase({ ...baseState, reviewStatus: reviewStatus({ reviewStatus: 'blocked' }) })).toBe('CHANGES_REQUESTED');
    expect(deriveIssueActionPhase({ ...baseState, reviewStatus: reviewStatus({ testStatus: 'failed' }) })).toBe('STUCK');
    expect(deriveIssueActionPhase({ ...baseState, reviewStatus: reviewStatus({ readyForMerge: true }) })).toBe('READY_TO_MERGE');
    expect(deriveIssueActionPhase({ ...baseState, isMerged: true })).toBe('MERGED');
  });
});
