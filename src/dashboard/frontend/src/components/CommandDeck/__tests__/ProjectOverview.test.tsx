import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { bucketFeaturePhase, ProjectOverview } from '../ProjectOverview';

// ProjectOverview now fetches recent spend via react-query (PAN-1597), so every
// render must sit under a QueryClientProvider. Shadow render() with a wrapper so
// existing call sites (and their rerender()) work unchanged.
function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}
import type { PipelineIssuePhase } from '../../../lib/pipeline-state';
import { useDashboardStore } from '../../../lib/store';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-panopticon-csrf-token': 'test-csrf',
  })),
}));

const fetchMock = vi.fn();
let mergeTrainSetting: { value: 'enabled' | 'disabled' | null; effective: boolean };

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function installDefaultFetchMock() {
  mergeTrainSetting = { value: null, effective: true };
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/costs/summary')) {
      return jsonResponse({ week: {} });
    }
    if (url.endsWith('/auto-merge-default')) {
      return jsonResponse({ value: null });
    }
    if (url.endsWith('/merge-train')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { value: 'enabled' | 'disabled' | null };
        mergeTrainSetting = {
          value: body.value,
          effective: body.value === null ? true : body.value === 'enabled',
        };
      }
      return jsonResponse(mergeTrainSetting);
    }
    if (url === '/api/merge-train/queues') {
      return jsonResponse([]);
    }
    if (url === '/api/merge-train/generations') {
      return jsonResponse([]);
    }
    return jsonResponse({}, false);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function makeFeature(overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId: 'PAN-1044',
    title: 'Project overview panel',
    projectName: 'panopticon-cli',
    branch: 'feature/pan-1044',
    status: 'open',
    stateLabel: 'Todo',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    sessions: [],
    ...overrides,
  };
}

function reviewStatus(overrides: Partial<ReviewStatusSnapshot>): ReviewStatusSnapshot {
  return {
    issueId: 'PAN-1044',
    ...overrides,
  } as ReviewStatusSnapshot;
}

function expectPhase(
  expected: PipelineIssuePhase,
  featureOverrides: Partial<ProjectFeature>,
  status?: Partial<ReviewStatusSnapshot>,
) {
  expect(
    bucketFeaturePhase(
      makeFeature(featureOverrides),
      status ? reviewStatus(status) : undefined,
    ),
  ).toBe(expected);
}

describe('bucketFeaturePhase', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    installDefaultFetchMock();
    useDashboardStore.setState({ reviewStatusByIssueId: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buckets stuck issues by the stuck flag', () => {
    expectPhase('todo', {}, { stuck: true });
  });

  it('buckets non-progress pipeline failures and blockers as stuck', () => {
    expectPhase('review', {}, { reviewStatus: 'failed' });
    expectPhase('review', {}, { reviewStatus: 'blocked' });
    expectPhase('review', {}, { testStatus: 'failed' });
    expectPhase('todo', {}, { testStatus: 'dispatch_failed' });
    expectPhase('ship', {}, { mergeStatus: 'failed' });
    expectPhase('review', {}, { verificationStatus: 'failed' });
  });

  it('buckets blocker reasons as stuck', () => {
    expectPhase('todo', {}, {
      blockerReasons: [
        {
          type: 'merge_conflict',
          summary: 'Merge conflict',
          detectedAt: '2026-05-09T00:00:00Z',
        },
      ],
    });
  });

  it('buckets active merge statuses as merging', () => {
    expectPhase('ship', {}, { mergeStatus: 'queued' });
    expectPhase('ship', {}, { mergeStatus: 'merging' });
    expectPhase('ship', {}, { mergeStatus: 'verifying' });
  });

  it('buckets ready-for-merge issues as awaitingMerge', () => {
    expectPhase('ship', {}, { readyForMerge: true });
  });

  it('buckets verifying issues as awaiting close-out instead of awaiting merge', () => {
    expectPhase('verifying', { stateLabel: 'Verifying' }, { readyForMerge: true });
    expectPhase('verifying', { stateLabel: 'Verifying On Main' }, { mergeStatus: 'merged' });
  });

  it('buckets testing issues as tests', () => {
    expectPhase('review', {}, { testStatus: 'testing' });
  });

  it('buckets active reviews as review', () => {
    expectPhase('review', {}, { reviewStatus: 'reviewing' });
  });

  it('buckets running verification as buildGate', () => {
    expectPhase('review', {}, { verificationStatus: 'running' });
  });

  it('buckets active work-agent issues without review status as working', () => {
    expectPhase('work', { agentStatus: 'running' }, undefined);
    expectPhase('work', { agentStatus: 'active' }, undefined);
    expectPhase('work', {
      agentStatus: 'stopped',
      sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
    }, undefined);
  });

  it('does not bucket stopped or suspended agents as working', () => {
    expectPhase('todo', { agentStatus: 'stopped' }, undefined);
    expectPhase('todo', { agentStatus: 'suspended' }, undefined);
  });

  it('buckets planned issues without work sessions as planning using SessionNode.type', () => {
    expectPhase('plan', {
      hasPlanning: true,
      sessions: [
        { type: 'planning' },
        { type: 'reviewer', role: 'work' },
      ] as ProjectFeature['sessions'],
    });
  });

  it('does not bucket planned issues with a work session as planning', () => {
    expectPhase('plan', {
      hasPlanning: true,
      sessions: [{ type: 'work' }] as ProjectFeature['sessions'],
    });
  });

  it('buckets issues with no active signals as idle', () => {
    expectPhase('todo', {}, undefined);
  });

  it('shows stuck reasons for blocked review and test dispatch failures', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', reviewStatus: 'blocked' }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', testStatus: 'dispatch_failed' }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Blocked review' }),
          makeFeature({ issueId: 'PAN-2', title: 'Dispatch failed' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('Review blocked')).toBeInTheDocument();
    expect(screen.getByText('Test dispatch failed')).toBeInTheDocument();
    expect(screen.queryAllByText('Blocked review')).toHaveLength(1);
    expect(screen.queryAllByText('Dispatch failed')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Stuck / blocked pipeline stage' })).not.toBeInTheDocument();
  });

  it('counts only active work agents in the hero summary', () => {
    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2', agentStatus: 'active' }),
          makeFeature({ issueId: 'PAN-3', agentStatus: 'stopped' }),
          makeFeature({ issueId: 'PAN-4', agentStatus: 'suspended' }),
          makeFeature({
            issueId: 'PAN-5',
            agentStatus: null,
            sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
          }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('Agents').parentElement).toHaveTextContent('3');
  });

  it('renders a project-scoped five-tile hero billboard that updates with feature state', () => {
    const { rerender } = render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2' }),
        ]}
        issueCosts={{ 'PAN-1': 1.25, 'PAN-2': 2 }}
        onSelectFeature={() => {}}
      />,
    );

    // Five project-scoped glance tiles in the hero billboard.
    for (const label of ['Active issues', 'Stuck', 'Agents', 'Ship-ready', 'Spend']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Active issues').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Agents').parentElement).toHaveTextContent('1');
    // No recent-spend query data in tests → Spend falls back to the project total.
    expect(screen.getByText('Spend').parentElement).toHaveTextContent('$3.25');

    rerender(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2', agentStatus: 'active' }),
          makeFeature({ issueId: 'PAN-3', agentStatus: 'running' }),
        ]}
        issueCosts={{ 'PAN-1': 1.25, 'PAN-2': 2, 'PAN-3': 4 }}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('Active issues').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Agents').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Spend').parentElement).toHaveTextContent('$7.25');
  });

  it('renders project issues with shared command-deck IssueRow and VerbBadge primitives', () => {
    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1', agentStatus: 'running' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    const row = screen.getByText('PAN-1').closest('[data-component="issue-row"]') as HTMLElement;
    expect(row).toHaveAttribute('data-variant', 'command-deck');
    expect(row.querySelector('[data-component="verb-badge"]')).toHaveAttribute('data-variant', 'WORK RUNNING');
  });

  it('renders partial cost breakdown details without crashing', () => {
    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1' })]}
        issueCosts={{ 'PAN-1': 1.23 }}
        issueCostDetails={{
          'PAN-1': {
            byModel: undefined as unknown as Record<string, { cost: number; tokens: number }>,
            byStage: undefined as unknown as Record<string, { cost: number; tokens: number }>,
          },
        }}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getAllByText('$1.23')[1]!);

    expect(screen.getAllByText('No cost data')).toHaveLength(2);
  });

  it('renders and persists the project merge-train setting', async () => {
    const { unmount } = render(
      <ProjectOverview
        projectName="panopticon-cli"
        projectKey="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    await screen.findByText('Effective: enabled');
    expect(screen.getAllByRole('button', { name: 'Global default' })[1]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/panopticon-cli/merge-train',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ value: 'enabled' }),
        }),
      );
      expect(screen.getByRole('button', { name: 'Enabled' })).toHaveAttribute('aria-pressed', 'true');
    });

    unmount();

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        projectKey="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enabled' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('links to Awaiting Merge with the project merge-train summary', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/costs/summary')) return jsonResponse({ week: {} });
      if (url.endsWith('/auto-merge-default')) return jsonResponse({ value: null });
      if (url.endsWith('/merge-train')) return jsonResponse(mergeTrainSetting);
      if (url === '/api/merge-train/queues') {
        return jsonResponse([
          { projectKey: 'panopticon-cli', queue: [{ issueId: 'PAN-1' }, { issueId: 'PAN-2' }] },
          { projectKey: 'krux', queue: [{ issueId: 'KRUX-1' }] },
        ]);
      }
      if (url === '/api/merge-train/generations') {
        return jsonResponse([
          { projectKey: 'panopticon-cli', name: 'uat/pan-otter-0612', status: 'ready' },
          { projectKey: 'krux', name: 'uat/krux-fox-0612', status: 'ready' },
        ]);
      }
      return jsonResponse({}, false);
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        projectKey="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    const link = await screen.findByRole('link', { name: /Merge train: 2 ready features .*pan-otter-0612 ready.*Awaiting Merge/ });
    expect(link).toHaveAttribute('href', '/awaiting-merge');
  });
});
