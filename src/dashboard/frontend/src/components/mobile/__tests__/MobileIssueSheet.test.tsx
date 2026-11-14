import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function renderSheet(
  issueId: string,
  onBack = vi.fn(),
  event?: Parameters<typeof MobileIssueSheet>[0]['event'],
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MobileIssueSheet issueId={issueId} event={event} onBack={onBack} />
    </QueryClientProvider>,
  );
}

/** Every test's AgentRow fetches the live directory; default it to empty so unrelated tests don't trip the no-unexpected-fetch guard. */
function stubEmptyLiveDirectory() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] })));
}

describe('MobileIssueSheet', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      issuesRaw: [],
      derivedIssueStateByIssueId: {},
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    stubEmptyLiveDirectory();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the D-4661-10 fields for an in-review issue with a PR, agent, project and labels', async () => {
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

    renderSheet('PAN-12');

    expect(screen.getByRole('heading', { name: 'Fix the thing' })).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('in-review')).toBeInTheDocument();
    expect(screen.getByText('#12 · checks green · approved')).toBeInTheDocument();
    expect(await screen.findByText('work · opus · claude-code')).toBeInTheDocument();
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Overdeck')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
  });

  it('renders an "Open in tracker" link to the issue URL and finds the issue case-insensitively', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-5', url: 'https://example.com/PAN-5' })],
      derivedIssueStateByIssueId: {
        'PAN-5': { issueId: 'PAN-5', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('pan-5');

    const link = screen.getByRole('link', { name: 'Open in tracker' });
    expect(link).toHaveAttribute('href', 'https://example.com/PAN-5');
  });

  it('renders the identifier and "not found on tracker" for an unknown id whose read answers 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    renderSheet('PAN-404');

    expect(await screen.findByText('not found on tracker')).toBeInTheDocument();
    expect(screen.getAllByText('PAN-404').length).toBeGreaterThan(0);
  });

  it('renders the skeleton while the per-issue read is unresolved', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})));

    renderSheet('PAN-404');

    expect(screen.getByTestId('issue-title-skeleton')).toBeInTheDocument();
  });

  it('renders the fetched title and D-4661-10 fields for an id absent from issuesRaw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      issue({ identifier: 'PAN-20', title: 'Fetched issue', project: { id: 'pan', name: 'Overdeck', color: '#fff' } }),
    )));
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-20': { issueId: 'PAN-20', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-20');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fetched issue' })).toBeInTheDocument());
    expect(screen.getByText('Overdeck')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('renders the Needs you mark only when the issue needs the operator', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-9' })],
      derivedIssueStateByIssueId: {
        'PAN-9': { issueId: 'PAN-9', state: 'working', attention: 'needs-you' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-9');
    expect(screen.getAllByText('Needs you').length).toBeGreaterThan(0);
  });

  it('renders a What happened line naming the PR for merge.completed', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-6' })],
      derivedIssueStateByIssueId: {
        'PAN-6': {
          issueId: 'PAN-6',
          state: 'ready',
          pr: { url: 'https://example.com/pr/12', number: 12, reviewState: 'approved', checks: 'green', mergeable: true },
        },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-6', vi.fn(), { kind: 'merge.completed', at: '2026-11-13T19:43:00.000Z' });
    expect(screen.getByTestId('mobile-issue-event')).toHaveTextContent('Merged PR #12 at ');
  });

  it('renders no What happened line without an event', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-6' })],
      derivedIssueStateByIssueId: {
        'PAN-6': { issueId: 'PAN-6', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-6');
    expect(screen.queryByTestId('mobile-issue-event')).not.toBeInTheDocument();
  });

  it('renders Phase and State from derived state for a 404 record instead of returning early', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-404': { issueId: 'PAN-404', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-404');

    expect(await screen.findByText('not found on tracker')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('renders the live directory agent as "Live" over a stopped store agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generatedAt: '2026-01-01T00:00:00.000Z',
      windowHours: 0,
      scope: 'live',
      entries: [{
        id: 'a1',
        kind: 'agent',
        label: 'a1',
        location: 'local',
        projectKey: 'pan',
        issueId: 'PAN-12',
        issueTitle: null,
        parentId: null,
        role: 'work',
        harness: 'claude-code',
        model: 'opus',
        state: 'working',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        costUsd: null,
        source: 'overdeck',
        transcript: null,
      }],
    })));
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-12' })],
      derivedIssueStateByIssueId: {
        'PAN-12': { issueId: 'PAN-12', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-12');

    expect(await screen.findByText('work · opus · claude-code')).toBeInTheDocument();
    expect(screen.getByText(/^Live/)).toBeInTheDocument();
  });

  it('renders exactly one button (Back), and tapping it calls onBack', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-7' })],
      derivedIssueStateByIssueId: {
        'PAN-7': { issueId: 'PAN-7', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    const onBack = vi.fn();
    renderSheet('PAN-7', onBack);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
