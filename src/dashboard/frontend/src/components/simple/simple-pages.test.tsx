/**
 * PAN-2908 · C-SIMPLE — simple-mode page tests.
 * Proves: sections render from real store state, one primary action per card,
 * pending input surfaces as an answerable question, simple issue page shows
 * the status card + conversation composer.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSnapshot, ReviewStatusSnapshot } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import { DialogProvider } from '../DialogProvider';
import { SimpleHomePage } from './SimpleHomePage';
import { SimpleIssuePage } from './SimpleIssuePage';
import { useDashboardStore } from '../../lib/store';
import { useUiMode } from '../../lib/simple/uiMode';
import type { Issue } from '../../types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.identifier ?? 'PAN-1',
    identifier: 'PAN-1',
    title: 'Set up PostHog product analytics',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://github.com/eltmon/overdeck/issues/1',
    state: 'in_progress',
    ...overrides,
  } as Issue;
}

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work', ...overrides };
}

function seed({ issues = [], agents = {}, review = {} }: {
  issues?: Issue[];
  agents?: Record<string, AgentSnapshot>;
  review?: Record<string, ReviewStatusSnapshot>;
}) {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    issuesRaw: issues,
    agentsById: agents,
    reviewStatusByIssueId: review,
  } as never);
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

describe('SimpleHomePage (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: null });
  });

  it('renders the working section with progress for an in-progress issue', () => {
    seed({
      issues: [makeIssue({ taskCounts: { completed: 4, total: 13 } })],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Working now')).toBeInTheDocument();
    expect(screen.getByText('Set up PostHog product analytics')).toBeInTheDocument();
    expect(screen.getByText(/task 4 of 13/)).toBeInTheDocument();
  });

  it('surfaces a pending question in Needs you with an answer input', () => {
    seed({
      issues: [makeIssue()],
      agents: {
        'agent-pan-1': makeAgent({
          pendingInputCount: 1,
          pendingInputKinds: ['askUserQuestion'],
          pendingAskUserQuestion: {
            toolUseId: 'tu-1',
            askedAt: new Date().toISOString(),
            questions: [{ question: 'Which PostHog project should events go to?', options: [] }],
          },
        }),
      },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText(/Which PostHog project/)).toBeInTheDocument();
  });

  it('shows ready-to-merge with exactly one primary Merge action', () => {
    seed({
      issues: [makeIssue({ state: 'in_review' })],
      review: { 'PAN-1': { issueId: 'PAN-1', readyForMerge: true, reviewStatus: 'passed', mergeStatus: 'pending' } as ReviewStatusSnapshot },
    });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Ready to merge')).toBeInTheDocument();
    const merges = screen.getAllByRole('button', { name: 'Merge to main' });
    expect(merges).toHaveLength(1);
  });

  it('backlog issues do not clutter the home (not-started stays out)', () => {
    seed({ issues: [makeIssue({ state: 'backlog', title: 'Far-future idea' })] });
    renderWithProviders(<SimpleHomePage />);
    expect(screen.queryByText('Far-future idea')).not.toBeInTheDocument();
  });
});

describe('SimpleIssuePage (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: 'PAN-1' });
  });

  it('renders the status card, steps, and the steering composer', () => {
    seed({
      issues: [makeIssue()],
      agents: { 'agent-pan-1': makeAgent() },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByText('The agent is writing the code.')).toBeInTheDocument();
    expect(screen.getByText('What it\'s saying and doing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Say something to the agent/)).toBeInTheDocument();
  });

  it('ready state offers Merge to main as the one primary action', () => {
    seed({
      issues: [makeIssue({ state: 'in_review' })],
      review: { 'PAN-1': { issueId: 'PAN-1', readyForMerge: true, reviewStatus: 'passed', mergeStatus: 'pending' } as ReviewStatusSnapshot },
    });
    renderWithProviders(<SimpleIssuePage issueId="PAN-1" />);
    expect(screen.getByRole('button', { name: 'Merge to main' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stop|Wipe|Reset/i })).not.toBeInTheDocument();
  });
});
