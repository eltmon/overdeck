import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { PipelineView } from './PipelineView';

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
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [
        issue({ identifier: 'PAN-1', title: 'Ready to ship', priority: 1, labels: ['ship'], project: { id: 'pan', name: 'Panopticon', color: '#fff' } }),
        issue({ identifier: 'PAN-2', title: 'Active work', priority: 2, status: 'In Progress', state: 'in_progress' }),
        issue({ identifier: 'PAN-3', title: 'Planned work', priority: 3, hasPlan: true }),
      ],
      reviewStatusByIssueId: {
        'PAN-1': { issueId: 'PAN-1', readyForMerge: true, mergeStatus: 'pending', updatedAt: '2026-05-18T01:00:00.000Z' },
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
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('renders the Pipeline shell from existing store state and groups issues by pipeline-state helpers', () => {
    const { container } = render(<PipelineView />);

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
    expect(container.querySelectorAll('[data-component="phase-header"]')).toHaveLength(5);
  });

  it('opens the issue drawer from a Pipeline row without disturbing scroll position', () => {
    const { container } = render(<PipelineView />);
    const scroller = container.querySelector('[data-component="pipeline-view"] > .flex-1') as HTMLElement;
    scroller.scrollTop = 160;

    fireEvent.click(screen.getByText('Ready to ship'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-1&tab=overview');

    useDashboardStore.getState().closeIssue();

    expect(scroller.scrollTop).toBe(160);
  });
});
