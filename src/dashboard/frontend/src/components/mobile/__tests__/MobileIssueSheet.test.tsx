import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionState } from '../../../lib/connectionState';
import { useDashboardStore } from '../../../lib/store';
import type { DerivedIssueState, Issue } from '../../../types';
import { MobileIssueSheet } from '../MobileIssueSheet';

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

describe('MobileIssueSheet', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      issuesRaw: [],
      derivedIssueStateByIssueId: {},
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useConnectionState.setState({ hasSnapshot: false });
  });

  it('renders the D-4661-10 fields for an in-review issue with a PR, agent, project and labels', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [
        issue({
          identifier: 'PAN-12',
          title: 'Fix the thing',
          project: { id: 'pan', name: 'Overdeck', color: '#fff' },
          labels: ['frontend'],
        }),
      ],
      derivedIssueStateByIssueId: {
        'PAN-12': {
          issueId: 'PAN-12',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/12', number: 12, reviewState: 'approved', checks: 'green', mergeable: true },
        },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {
        'agent-12': {
          id: 'agent-12',
          issueId: 'PAN-12',
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

    render(<MobileIssueSheet issueId="PAN-12" onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Fix the thing' })).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('in-review')).toBeInTheDocument();
    expect(screen.getByText('#12 · checks green · approved')).toBeInTheDocument();
    expect(screen.getByText('work · opus · running')).toBeInTheDocument();
    expect(screen.getByText('Overdeck')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
  });

  it('renders an "Open in tracker" link to the issue URL and finds the issue case-insensitively', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-5', url: 'https://example.com/PAN-5' })],
      derivedIssueStateByIssueId: {
        'PAN-5': { issueId: 'PAN-5', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<MobileIssueSheet issueId="pan-5" onBack={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'Open in tracker' });
    expect(link).toHaveAttribute('href', 'https://example.com/PAN-5');
  });

  it('renders "This issue is not in the pipeline." for an unknown id when hasSnapshot is true', () => {
    useConnectionState.setState({ hasSnapshot: true });
    render(<MobileIssueSheet issueId="PAN-404" onBack={vi.fn()} />);
    expect(screen.getByText('This issue is not in the pipeline.')).toBeInTheDocument();
  });

  it('renders "Loading issue…" when hasSnapshot is false', () => {
    useConnectionState.setState({ hasSnapshot: false });
    render(<MobileIssueSheet issueId="PAN-404" onBack={vi.fn()} />);
    expect(screen.getByText('Loading issue…')).toBeInTheDocument();
  });

  it('renders the Needs you mark only when the issue needs the operator', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-9' })],
      derivedIssueStateByIssueId: {
        'PAN-9': { issueId: 'PAN-9', state: 'working', attention: 'needs-you' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<MobileIssueSheet issueId="PAN-9" onBack={vi.fn()} />);
    expect(screen.getAllByText('Needs you').length).toBeGreaterThan(0);
  });

  it('renders exactly one button (Back), and tapping it calls onBack', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-7' })],
      derivedIssueStateByIssueId: {
        'PAN-7': { issueId: 'PAN-7', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    const onBack = vi.fn();
    render(<MobileIssueSheet issueId="PAN-7" onBack={onBack} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
