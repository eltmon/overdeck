import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { PipelineView } from './PipelineView';

function renderPipelineView() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <PipelineView />
    </QueryClientProvider>,
  );
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-0',
    identifier: overrides.identifier ?? 'PAN-0',
    title: overrides.title ?? 'Issue title',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 4,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('PipelineView', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/costs/stream')) {
        return new Response(JSON.stringify({
          events: [],
          byIssue: {
            'PAN-1': [{ ts: '2026-05-18T00:00:00.000Z', model: 'opus', provider: 'anthropic', cost: 1.25, tokens: 1000 }],
            'PAN-2': [{ ts: '2026-05-18T00:00:00.000Z', model: 'opus', provider: 'anthropic', cost: 0.5, tokens: 500 }],
          },
          count: 2,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [
        issue({ identifier: 'PAN-1', title: 'Ready to ship', priority: 1, labels: ['ship'], project: { id: 'pan', name: 'Panopticon', color: '#fff' } }),
        issue({ identifier: 'PAN-2', title: 'Active work', priority: 2, status: 'In Progress', state: 'in_progress', project: { id: 'ops', name: 'Operations', color: '#fff' }, updatedAt: '2026-05-18T02:00:00.000Z' }),
        issue({ identifier: 'PAN-6', title: 'Urgent active work', priority: 1, status: 'In Progress', state: 'in_progress', project: { id: 'ops', name: 'Operations', color: '#fff' }, updatedAt: '2026-05-18T00:30:00.000Z' }),
        issue({ identifier: 'PAN-7', title: 'Newer active work', priority: 2, status: 'In Progress', state: 'in_progress', project: { id: 'ops', name: 'Operations', color: '#fff' }, updatedAt: '2026-05-18T03:00:00.000Z' }),
        issue({ identifier: 'PAN-3', title: 'Planned work', priority: 3, hasPlan: true, project: { id: 'pan', name: 'Panopticon', color: '#fff' } }),
        issue({ identifier: 'PAN-4', title: 'Blocked merge', priority: 2, project: { id: 'ops', name: 'Operations', color: '#fff' } }),
        issue({ identifier: 'PAN-5', title: 'Open PR', priority: 2, project: { id: 'ops', name: 'Operations', color: '#fff' } }),
      ],
      reviewStatusByIssueId: {
        'PAN-1': { issueId: 'PAN-1', readyForMerge: true, mergeStatus: 'pending', updatedAt: '2026-05-18T01:00:00.000Z' },
        'PAN-4': {
          issueId: 'PAN-4',
          readyForMerge: false,
          mergeStatus: 'pending',
          reviewStatus: 'passed',
          testStatus: 'passed',
          blockerReasons: ['github-checks'],
          updatedAt: '2026-05-18T01:00:00.000Z',
        },
        'PAN-5': {
          issueId: 'PAN-5',
          readyForMerge: false,
          mergeStatus: 'pending',
          prUrl: 'https://example.com/pr/5',
          updatedAt: '2026-05-18T01:00:00.000Z',
        },
      },
      agentsById: {
        'agent-pan-2': {
          id: 'agent-pan-2',
          issueId: 'PAN-2',
          role: 'work',
          status: 'running',
          model: 'opus',
          runtime: 'claude-code',
          startedAt: '2026-05-18T01:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
        'review-pan-4': {
          id: 'review-pan-4',
          issueId: 'PAN-4',
          role: 'review',
          status: 'running',
          model: 'opus',
          runtime: 'claude-code',
          startedAt: '2026-05-18T01:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('renders the Pipeline shell from existing store state and groups issues by pipeline-state helpers', () => {
    const { container } = renderPipelineView();

    const topBar = container.querySelector('[data-component="top-bar"]');
    const strip = container.querySelector('[data-component="metric-strip"]');
    const shipPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="ship"]') as HTMLElement;
    const workPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="work"]') as HTMLElement;
    const planPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="plan"]') as HTMLElement;

    expect(topBar).toHaveClass('h-[52px]');
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(strip).toHaveAttribute('data-columns', '5');

    expect(within(shipPhase).getByText('Ready to ship')).toBeInTheDocument();
    expect(within(workPhase).getByText('Active work')).toBeInTheDocument();
    expect(within(workPhase).getByText('agent-pan-2')).toBeInTheDocument();
    expect(within(planPhase).getByText('Planned work')).toBeInTheDocument();
    expect(container.querySelector('[data-component="phase-header"]')).toHaveClass('sticky', 'top-0');
    expect(container.querySelectorAll('[data-component="phase-header"]')).toHaveLength(5);
  });

  it('sorts rows within each phase by priority rank then updatedAt descending', () => {
    const { container } = renderPipelineView();
    const workPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="work"]') as HTMLElement;

    expect(
      within(workPhase)
        .getAllByRole('button')
        .filter((row) => row.getAttribute('data-component') === 'issue-row')
        .map((row) => row.getAttribute('data-issue-id')),
    ).toEqual(['PAN-6', 'PAN-7', 'PAN-2']);
  });

  it('renders reactive metric tiles from store state and the cost event stream', async () => {
    renderPipelineView();

    const strip = screen.getByText('Active issues').closest('[data-component="metric-strip"]') as HTMLElement;

    expect(within(strip).getByText('Active issues')).toBeInTheDocument();
    expect(within(strip).getByText('Work running')).toBeInTheDocument();
    expect(within(strip).getByText('Review running')).toBeInTheDocument();
    expect(within(strip).getByText('Ship')).toBeInTheDocument();
    expect(within(strip).getByText('Spend')).toBeInTheDocument();
    expect(await within(strip).findByText('$1.75')).toBeInTheDocument();

    const tiles = Array.from(strip.querySelectorAll('[data-component="metric-tile"]'));
    expect(tiles.map((tile) => tile.getAttribute('data-signal'))).toEqual(['info', 'warning', 'review', 'success', 'cost']);
    expect(tiles.map((tile) => tile.querySelector('[data-component="metric-tile-value"]')?.textContent)).toEqual([
      '7',
      '1',
      '1',
      '1',
      '$1.75',
    ]);
    expect(fetch).toHaveBeenCalledWith('/api/costs/stream?limit=500');
  });

  it('does not classify error or unknown work agents as running work', () => {
    useDashboardStore.setState({
      issuesRaw: [
        issue({ identifier: 'PAN-8', title: 'Errored agent work', hasPlan: true }),
        issue({ identifier: 'PAN-9', title: 'Unknown agent work', hasPlan: true }),
      ],
      agentsById: {
        'agent-pan-8': {
          id: 'agent-pan-8',
          issueId: 'PAN-8',
          role: 'work',
          status: 'error',
          model: 'opus',
          runtime: 'claude-code',
          startedAt: '2026-05-18T01:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
        'agent-pan-9': {
          id: 'agent-pan-9',
          issueId: 'PAN-9',
          role: 'work',
          status: 'unknown',
          model: 'opus',
          runtime: 'claude-code',
          startedAt: '2026-05-18T01:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
      reviewStatusByIssueId: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    const { container } = renderPipelineView();
    const workPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="work"]') as HTMLElement;
    const planPhase = container.querySelector('[data-component="pipeline-phase"][data-phase="plan"]') as HTMLElement;

    expect(within(workPhase).queryByText('Errored agent work')).toBeNull();
    expect(within(workPhase).queryByText('Unknown agent work')).toBeNull();
    expect(within(planPhase).getByText('Errored agent work')).toBeInTheDocument();
    expect(within(planPhase).getByText('Unknown agent work')).toBeInTheDocument();
  });

  it('opens the issue drawer from a Pipeline row without disturbing scroll position', () => {
    const { container } = renderPipelineView();
    const scroller = container.querySelector('[data-component="pipeline-view"] > .flex-1') as HTMLElement;
    scroller.scrollTop = 160;

    fireEvent.click(screen.getByText('Ready to ship'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-1&tab=overview');

    useDashboardStore.getState().closeIssue();

    expect(scroller.scrollTop).toBe(160);
  });

  it('syncs phase and project filters to the URL', () => {
    renderPipelineView();

    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(window.location.search).toBe('?phase=work');
    expect(screen.getByText('Active work')).toBeInTheDocument();
    expect(screen.queryByText('Ready to ship')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Panopticon' }));
    expect(window.location.search).toBe('?projects=pan');
    expect(screen.getByText('Ready to ship')).toBeInTheDocument();
    expect(screen.getByText('Planned work')).toBeInTheDocument();
    expect(screen.queryByText('Active work')).toBeNull();
    const reviewPhase = document.querySelector('[data-component="pipeline-phase"][data-phase="review"]') as HTMLElement;
    expect(within(reviewPhase).getByText('0')).toBeInTheDocument();
    expect(within(reviewPhase).queryByRole('button')).toBeNull();
  });

  it('maps ship modifiers to the legacy merge subviews', () => {
    const { unmount } = renderPipelineView();

    fireEvent.click(screen.getByRole('button', { name: 'Blocked' }));
    expect(new URLSearchParams(window.location.search).get('phase')).toBe('ship');
    expect(new URLSearchParams(window.location.search).has('blocked')).toBe(true);
    expect(screen.getByText('Blocked merge')).toBeInTheDocument();
    expect(screen.queryByText('Ready to ship')).toBeNull();

    unmount();
    window.history.replaceState(null, '', '/');
    renderPipelineView();

    fireEvent.click(screen.getByRole('button', { name: 'No PR' }));
    expect(new URLSearchParams(window.location.search).get('phase')).toBe('ship');
    expect(new URLSearchParams(window.location.search).has('noPr')).toBe(true);
    expect(screen.getByText('Open PR')).toBeInTheDocument();
    expect(screen.queryByText('Ready to ship')).toBeNull();
  });

  it('renders ledger runtime for rows with an active agent', () => {
    const { container } = renderPipelineView();
    const pan2Row = container.querySelector('[data-component="issue-row"][data-issue-id="PAN-2"]') as HTMLElement;
    const ledger = pan2Row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;
    const runtime = within(ledger).getByText(/\d+h? \d+m/);
    expect(runtime).toBeInTheDocument();
    expect(ledger).not.toHaveClass('opacity-55');
  });

  it('renders ledger cost for rows with cost events in the byIssue stream', () => {
    const { container } = renderPipelineView();
    const pan1Row = container.querySelector('[data-component="issue-row"][data-issue-id="PAN-1"]') as HTMLElement;
    const pan1Ledger = pan1Row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;
    expect(within(pan1Ledger).getByText('$1.25')).toBeInTheDocument();
    expect(pan1Ledger).not.toHaveClass('opacity-55');

    const pan2Row = container.querySelector('[data-component="issue-row"][data-issue-id="PAN-2"]') as HTMLElement;
    const pan2Ledger = pan2Row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;
    expect(within(pan2Ledger).getByText('$0.50')).toBeInTheDocument();
  });

  it('shows empty ledger styling for rows with no agent and no cost events', () => {
    const { container } = renderPipelineView();
    const pan6Row = container.querySelector('[data-component="issue-row"][data-issue-id="PAN-6"]') as HTMLElement;
    const ledger = pan6Row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;
    expect(ledger).toHaveClass('opacity-55');
    expect(within(ledger).getAllByText('—')).toHaveLength(2);
  });
});
