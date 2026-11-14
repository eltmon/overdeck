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

/** Routes a test's fetch mock by URL substring, falling back to a plain 404. */
function stubFetch(
  handlers: Record<string, () => Response | Promise<Response>>,
  fallback: () => Response | Promise<Response> = () => new Response(null, { status: 404 }),
) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const handler = Object.entries(handlers).find(([key]) => url.includes(key))?.[1];
    return (handler ?? fallback)();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Every test's AgentRow and CostSection fetch; default both to empty/absent so unrelated tests don't trip the no-unexpected-fetch guard. */
function stubDefaultFetch() {
  return stubFetch({
    '/api/agent-directory': () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] }),
  });
}

describe('MobileIssueSheet', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      issuesRaw: [],
      derivedIssueStateByIssueId: {},
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
    stubDefaultFetch();
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
    const prLink = screen.getByRole('link', { name: '#12' });
    expect(prLink).toHaveAttribute('href', 'https://example.com/pr/12');
    expect(prLink.closest('dd')).toHaveTextContent('#12 · Open · Approved');
    expect(await screen.findByText('Checks passed')).toBeInTheDocument();
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

  it('renders the headline and stage split from a costs response', async () => {
    const fetchMock = stubDefaultFetch();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/agent-directory')) {
        return Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] });
      }
      if (url.includes('/costs')) {
        return Response.json({
          issueId: 'PAN-13',
          totalCost: 3.5,
          resolvedTotalCost: 4.25,
          totalTokens: 100,
          sessions: [],
          byModel: {},
          byStage: { work: { cost: 3, tokens: 1 }, review: { cost: 1.25, tokens: 1 } },
        });
      }
      return new Response(null, { status: 404 });
    });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-13' })],
      derivedIssueStateByIssueId: {
        'PAN-13': { issueId: 'PAN-13', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-13');

    expect(await screen.findByText('$4.25')).toBeInTheDocument();
    expect(screen.getByText('work $3.00 · review $1.25')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/costs')).length).toBe(1);
  });

  it('renders "Cost not available" for a 403 costs read, fetched exactly once', async () => {
    const fetchMock = stubFetch({
      '/api/agent-directory': () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] }),
      '/costs': () => new Response(null, { status: 403 }),
    });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-14' })],
      derivedIssueStateByIssueId: {
        'PAN-14': { issueId: 'PAN-14', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-14');

    expect(await screen.findByText('Cost not available')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/costs')).length).toBe(1);
  });

  it('renders "No spend recorded" for a zero headline', async () => {
    stubFetch({
      '/api/agent-directory': () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] }),
      '/costs': () => Response.json({ issueId: 'PAN-15', totalCost: 0, totalTokens: 0, sessions: [], byModel: {} }),
    });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-15' })],
      derivedIssueStateByIssueId: {
        'PAN-15': { issueId: 'PAN-15', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-15');

    expect(await screen.findByText('No spend recorded')).toBeInTheDocument();
  });

  it('links the checks summary from a valid check-runs response', async () => {
    stubFetch({
      '/api/agent-directory': () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] }),
      '/check-runs': () => Response.json({
        issueId: 'PAN-16',
        pr: null,
        checkRuns: [],
        summary: { total: 5, passed: 4, failed: 1, running: 0, skipped: 0, pending: 0, cancelled: 0 },
      }),
    });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-16' })],
      derivedIssueStateByIssueId: {
        'PAN-16': {
          issueId: 'PAN-16',
          state: 'ready',
          pr: { url: 'https://example.com/pr/16', number: 16, reviewState: 'approved', checks: 'green', mergeable: true, merged: true },
        },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-16');

    expect(screen.getByRole('link', { name: '#16' })).toBeInTheDocument();
    expect(screen.getByText('#16').closest('dd')).toHaveTextContent('#16 · Merged · Approved');
    const checksLink = await screen.findByRole('link', { name: '4 passed · 1 failed · 0 running' });
    expect(checksLink).toHaveAttribute('href', 'https://example.com/pr/16/checks');
  });

  it('falls back to derived.pr.checks when check-runs fails', async () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-17' })],
      derivedIssueStateByIssueId: {
        'PAN-17': {
          issueId: 'PAN-17',
          state: 'ready',
          pr: { url: 'https://example.com/pr/17', number: 17, reviewState: 'none', checks: 'red', mergeable: true },
        },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-17');

    expect(await screen.findByText('Checks failed')).toBeInTheDocument();
  });

  it('falls back to derived.pr.checks when check-runs soft-fails with a zeroed summary and an error field (D-8)', async () => {
    stubFetch({
      '/api/agent-directory': () => Response.json({ generatedAt: '2026-01-01T00:00:00.000Z', windowHours: 0, scope: 'live', entries: [] }),
      '/check-runs': () => Response.json({
        issueId: 'PAN-23',
        pr: { number: 23, url: 'https://example.com/pr/23', headRefName: 'x', headRefOid: 'a', mergeable: null, statusCheckRollup: [] },
        checkRuns: [],
        summary: { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
        error: 'gh api check-runs failed: rate limited',
      }),
    });
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-23' })],
      derivedIssueStateByIssueId: {
        'PAN-23': {
          issueId: 'PAN-23',
          state: 'ready',
          pr: { url: 'https://example.com/pr/23', number: 23, reviewState: 'none', checks: 'red', mergeable: true },
        },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-23');

    expect(await screen.findByText('Checks failed')).toBeInTheDocument();
    expect(screen.queryByText('No checks reported')).not.toBeInTheDocument();
  });

  it('renders "No pull request" when neither source knows one', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-18' })],
      derivedIssueStateByIssueId: {
        'PAN-18': { issueId: 'PAN-18', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-18');

    expect(screen.getByText('No pull request')).toBeInTheDocument();
    expect(screen.queryByText(/Checks/)).not.toBeInTheDocument();
  });

  it('renders Markdown inside the description subtree', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-19', description: '## Steps\n\n- one\n- two' })],
      derivedIssueStateByIssueId: {
        'PAN-19': { issueId: 'PAN-19', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-19');

    const description = screen.getByTestId('mobile-issue-description');
    expect(description).toHaveTextContent('Steps');
    expect(description.querySelector('h2, h3')).toBeInTheDocument();
  });

  it('collapses a long description behind Show more / Show less', () => {
    useDashboardStore.setState({
      issuesRaw: [issue({ identifier: 'PAN-20', description: 'x'.repeat(400) })],
      derivedIssueStateByIssueId: {
        'PAN-20': { issueId: 'PAN-20', state: 'working' },
      } satisfies Record<string, DerivedIssueState>,
      agentsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderSheet('PAN-20');

    const description = screen.getByTestId('mobile-issue-description');
    expect(description).toHaveAttribute('data-collapsed', 'true');
    const toggle = screen.getByRole('button', { name: 'Show more' });

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(description).toHaveAttribute('data-collapsed', 'false');
  });

  it('renders exactly one button (Back), no description, one h2, and only GET requests', async () => {
    const fetchMock = stubDefaultFetch();
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
    expect(screen.getByText('No description.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [, init] of fetchMock.mock.calls) {
      const method = (init as RequestInit | undefined)?.method;
      expect(method === undefined || method === 'GET').toBe(true);
    }
  });
});
