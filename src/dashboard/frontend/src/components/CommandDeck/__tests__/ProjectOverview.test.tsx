import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
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

function expectBadgeVariant(issueId: string, variant: string) {
  const row = screen.getByText(issueId).closest('[data-component="issue-row"]') as HTMLElement;
  expect(row.querySelector('[data-component="verb-badge"]')).toHaveAttribute('data-variant', variant);
}

describe('bucketFeaturePhase', () => {
  beforeEach(() => {
    useDashboardStore.setState({ reviewStatusByIssueId: {} });
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

  it('labels structural merge blockers as merge blocked', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', blockerReasons: [{ type: 'merge_conflict', summary: 'Merge conflict', detectedAt: '2026-06-14T00:00:00Z' }] }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', blockerReasons: [{ type: 'not_mergeable', summary: 'Not mergeable', detectedAt: '2026-06-14T00:00:00Z' }] }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Conflict' }),
          makeFeature({ issueId: 'PAN-2', title: 'Not mergeable' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expectBadgeVariant('PAN-1', 'MERGE BLOCKED');
    expectBadgeVariant('PAN-2', 'MERGE BLOCKED');
  });

  it('labels failing checks as CI blocked', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', blockerReasons: [{ type: 'failing_checks', summary: 'Checks failing', detectedAt: '2026-06-14T00:00:00Z' }] }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1', title: 'CI red' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expectBadgeVariant('PAN-1', 'CI BLOCKED');
  });

  it('keeps review feedback blockers as changes requested', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', reviewStatus: 'failed' }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', reviewStatus: 'blocked' }),
        'PAN-3': reviewStatus({ issueId: 'PAN-3', blockerReasons: [{ type: 'changes_requested', summary: 'Changes requested', detectedAt: '2026-06-14T00:00:00Z' }] }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Review failed' }),
          makeFeature({ issueId: 'PAN-2', title: 'Review blocked' }),
          makeFeature({ issueId: 'PAN-3', title: 'Changes requested' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expectBadgeVariant('PAN-1', 'CHANGES REQUESTED');
    expectBadgeVariant('PAN-2', 'CHANGES REQUESTED');
    expectBadgeVariant('PAN-3', 'CHANGES REQUESTED');
  });

  it('gives structural merge blockers precedence over failing checks', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({
          issueId: 'PAN-1',
          blockerReasons: [
            { type: 'failing_checks', summary: 'Checks failing', detectedAt: '2026-06-14T00:00:00Z' },
            { type: 'merge_conflict', summary: 'Merge conflict', detectedAt: '2026-06-14T00:00:00Z' },
          ],
        }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1', title: 'Conflict and CI red' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expectBadgeVariant('PAN-1', 'MERGE BLOCKED');
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
});
