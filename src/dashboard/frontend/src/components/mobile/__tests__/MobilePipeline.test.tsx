import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionState } from '../../../lib/connectionState';
import { useDashboardStore } from '../../../lib/store';
import type { DerivedIssueState, Issue } from '../../../types';
import { MobilePipeline } from '../MobilePipeline';

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

describe('MobilePipeline', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      issuesRaw: [],
      derivedIssueStateByIssueId: {},
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    useConnectionState.setState({ hasSnapshot: false });
  });

  it('renders "Loading pipeline…" when hasSnapshot is false', () => {
    render(<MobilePipeline onOpen={vi.fn()} />);
    expect(screen.getByText('Loading pipeline…')).toBeInTheDocument();
  });

  it('renders "No active issues." when hasSnapshot is true and there are no active issues', () => {
    useConnectionState.setState({ hasSnapshot: true });
    render(<MobilePipeline onOpen={vi.fn()} />);
    expect(screen.getByText('No active issues.')).toBeInTheDocument();
  });

  it('renders non-empty board phases in order and omits the closed issue and the empty ready section', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [
        issue({ identifier: 'PAN-1', title: 'Active work' }),
        issue({ identifier: 'PAN-2', title: 'In review' }),
        issue({ identifier: 'PAN-3', title: 'Ready to ship' }),
        issue({ identifier: 'PAN-4', title: 'Planned work' }),
        issue({ identifier: 'PAN-5', title: 'Closed work', stateType: 'completed' }),
      ],
      derivedIssueStateByIssueId: {
        'PAN-1': { issueId: 'PAN-1', state: 'working' },
        'PAN-2': { issueId: 'PAN-2', state: 'in-review' },
        'PAN-3': { issueId: 'PAN-3', state: 'ready' },
        'PAN-4': { issueId: 'PAN-4', state: 'planned' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<MobilePipeline onOpen={vi.fn()} />);

    const phaseSections = Array.from(document.querySelectorAll('section[data-phase]'));
    expect(phaseSections.map((el) => el.getAttribute('data-phase'))).toEqual(['ship', 'review', 'work', 'plan']);
    expect(screen.queryByText('Closed work')).not.toBeInTheDocument();
  });

  it('renders "Needs you" on a needs-attention row and an agent-pending row, not on a plain working row', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [
        issue({ identifier: 'PAN-10', title: 'Needs attention' }),
        issue({ identifier: 'PAN-11', title: 'Agent waiting' }),
        issue({ identifier: 'PAN-12', title: 'Plain working' }),
      ],
      derivedIssueStateByIssueId: {
        'PAN-10': { issueId: 'PAN-10', state: 'working', attention: 'needs-you' },
        'PAN-11': { issueId: 'PAN-11', state: 'working' },
        'PAN-12': { issueId: 'PAN-12', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {
        'agent-11': {
          id: 'agent-11',
          issueId: 'PAN-11',
          role: 'work',
          status: 'running',
          model: 'opus',
          runtime: 'claude-code',
          startedAt: '2026-05-18T01:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
          hasPendingQuestion: true,
          pendingQuestionCount: 1,
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<MobilePipeline onOpen={vi.fn()} />);

    const row10 = document.querySelector('[data-issue-id="PAN-10"]') as HTMLElement;
    const row11 = document.querySelector('[data-issue-id="PAN-11"]') as HTMLElement;
    const row12 = document.querySelector('[data-issue-id="PAN-12"]') as HTMLElement;
    expect(within(row10).getByText('Needs you')).toBeInTheDocument();
    expect(within(row11).getByText('Needs you')).toBeInTheDocument();
    expect(within(row12).queryByText('Needs you')).not.toBeInTheDocument();
  });

  it('calls onOpen with the tapped issue identifier', () => {
    useConnectionState.setState({ hasSnapshot: true });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-20', title: 'Tap me' })],
      derivedIssueStateByIssueId: {
        'PAN-20': { issueId: 'PAN-20', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    const onOpen = vi.fn();
    render(<MobilePipeline onOpen={onOpen} />);

    fireEvent.click(screen.getByText('Tap me'));
    expect(onOpen).toHaveBeenCalledWith('PAN-20');
  });
});
