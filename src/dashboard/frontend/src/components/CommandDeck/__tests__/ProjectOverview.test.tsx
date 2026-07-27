import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewStatusSnapshot } from '@overdeck/contracts';
import { bucketFeaturePhase, ProjectOverview } from '../ProjectOverview';
import type { PipelineIssuePhase } from '../../../lib/pipeline-state';
import { useDashboardStore } from '../../../lib/store';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';

let fetchControl: ReturnType<typeof installStrictFetchMock>;

// ProjectOverview now fetches recent spend via react-query (PAN-1597), so every
// render must sit under a QueryClientProvider. Shadow render() with a wrapper so
// existing call sites (and their rerender()) work unchanged.
function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...rtlRender(ui, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    }),
    queryClient: client,
  };
}

function makeFeature(overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId: 'PAN-1044',
    title: 'Project overview panel',
    projectName: 'overdeck',
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

function rowFor(issueId: string): HTMLElement {
  const row = screen
    .getAllByTestId('pipeline-row')
    .find((element) => element.getAttribute('data-issue-id') === issueId);
  expect(row).toBeTruthy();
  return row!;
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
});

describe('ProjectOverview', () => {
  beforeEach(() => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/costs/summary?project=PAN') {
        return Response.json({ totalCost: 0 });
      }
      if (method === 'GET' && url === '/api/projects/overdeck/auto-merge-default') {
        return Response.json({ autoMerge: false });
      }
      // PAN-1696: the settings panel also reads the per-project merge-train
      // override and the aggregate endpoints behind its summary line.
      if (method === 'GET' && url === '/api/projects/overdeck/merge-train') {
        return Response.json({ value: null, effective: true });
      }
      if (method === 'GET' && (url === '/api/merge-train/queues' || url === '/api/merge-train/generations')) {
        return Response.json([]);
      }
      if (method === 'GET' && url === '/api/projects/overdeck/swarm-policy') {
        return Response.json({});
      }
      return undefined;
    });
    useDashboardStore.setState({ reviewStatusByIssueId: {} });
  });

  afterEach(async () => {
    cleanup();
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
  });

  // PAN-3156 moved the project name + rename pencil onto the `# <project>`
  // title (WorkspaceHeader variant="project"); this card keeps only its label.
  it('labels the card "pipeline overview" without duplicating the project name or pencil', () => {
    render(
      <ProjectOverview
        projectName="Overdeck"
        projectKey="overdeck"
        features={[]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('pipeline overview')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overdeck' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Overdeck' })).not.toBeInTheDocument();
  });

  it('renders a project-scoped five-tile hero billboard that updates with feature state', () => {
    const { rerender } = render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2' }),
        ]}
        issueCosts={{ 'PAN-1': 1.25, 'PAN-2': 2 }}
        onSelectFeature={() => {}}
      />,
    );

    for (const label of ['Active issues', 'Stuck', 'Agents', 'Ship-ready', 'Spend']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Active issues').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Agents').parentElement).toHaveTextContent('1');
    // No recent-spend query data in tests → Spend falls back to the project total.
    expect(screen.getByText('Spend').parentElement).toHaveTextContent('$3.25');

    rerender(
      <ProjectOverview
        projectName="overdeck"
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

  it('counts only active work agents in the hero summary', () => {
    render(
      <ProjectOverview
        projectName="overdeck"
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

  it('renders pipeline rows with issue id, title, cost and session count', () => {
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'First issue' }),
          makeFeature({
            issueId: 'PAN-2',
            title: 'Second issue',
            sessions: [{ type: 'work', presence: 'active', model: 'claude-sonnet-4-6' }] as ProjectFeature['sessions'],
          }),
        ]}
        issueCosts={{ 'PAN-1': 1.25, 'PAN-2': 12.5 }}
        onSelectFeature={() => {}}
      />,
    );

    const row1 = rowFor('PAN-1');
    expect(row1).toHaveTextContent('First issue');
    expect(row1).toHaveTextContent('$1.25');
    expect(row1).toHaveTextContent('0 sessions');

    const row2 = rowFor('PAN-2');
    expect(row2).toHaveTextContent('Second issue');
    expect(row2).toHaveTextContent('$12.50');
    expect(row2).toHaveTextContent('1 sessions');
  });

  it('calls onSelectFeature when a pipeline row is clicked', () => {
    const onSelectFeature = vi.fn();
    const feature = makeFeature({ issueId: 'PAN-1', title: 'Click me' });
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[feature]}
        issueCosts={{}}
        onSelectFeature={onSelectFeature}
      />,
    );

    fireEvent.click(rowFor('PAN-1'));
    expect(onSelectFeature).toHaveBeenCalledTimes(1);
    expect(onSelectFeature).toHaveBeenCalledWith(feature);
  });

  it('pins needs-you issues first and labels them waiting on you', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', reviewStatus: 'reviewing' }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', readyForMerge: true }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Reviewing' }),
          makeFeature({ issueId: 'PAN-2', title: 'Ready', readyForMerge: true }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByRole('region', { name: /needs you pipeline stage/i })).toHaveTextContent('PAN-2');
    expect(rowFor('PAN-2')).toHaveTextContent('waiting on you');
    expect(screen.getByRole('region', { name: /being reviewed pipeline stage/i })).toHaveTextContent('PAN-1');
  });

  it('pins plan-approval-pending issues first with an amber waiting-on-you chip', () => {
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'In progress', agentStatus: 'running', hasPlanning: true, hasPrd: true, hasState: true }),
          makeFeature({
            issueId: 'PAN-2',
            title: 'Plan approval pending',
            status: 'open',
            stateLabel: 'Todo',
            agentStatus: null,
            hasPlanning: true,
            hasPrd: true,
            hasState: false,
          }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByRole('region', { name: /needs you pipeline stage/i })).toHaveTextContent('PAN-2');
    expect(rowFor('PAN-2')).toHaveTextContent('waiting on you');
    expect(rowFor('PAN-2')).toHaveTextContent('plan approval pending');
    expect(screen.getByRole('region', { name: /being built pipeline stage/i })).toHaveTextContent('PAN-1');
  });

  it('does not treat an active planning session as waiting on you', () => {
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({
            issueId: 'PAN-1',
            title: 'Planning',
            status: 'open',
            stateLabel: 'Todo',
            agentStatus: null,
            hasPlanning: true,
            hasPrd: true,
            hasState: false,
            sessions: [{ type: 'planning', presence: 'active', model: 'claude-sonnet-4-6' }] as ProjectFeature['sessions'],
          }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.queryByRole('region', { name: /needs you pipeline stage/i })).not.toBeInTheDocument();
    expect(rowFor('PAN-1')).toHaveTextContent('planning');
  });

  it('shows stuck reasons as the row subline for blocked issues', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', reviewStatus: 'blocked' }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', testStatus: 'dispatch_failed' }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Blocked review' }),
          makeFeature({ issueId: 'PAN-2', title: 'Dispatch failed' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(rowFor('PAN-1')).toHaveTextContent('Review blocked');
    expect(rowFor('PAN-2')).toHaveTextContent('Test dispatch failed');
  });

  it('summarizes current CI health from project review state', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', blockerReasons: [{ type: 'failing_checks', summary: 'Checks failing', details: 'test job failed on main', detectedAt: '2026-06-14T00:00:00Z' }] }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', blockerReasons: [{ type: 'merge_conflict', summary: 'Merge conflict', details: 'src/app.ts conflicts', detectedAt: '2026-06-14T00:00:00Z' }] }),
        'PAN-3': reviewStatus({ issueId: 'PAN-3', readyForMerge: true }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'CI red' }),
          makeFeature({ issueId: 'PAN-2', title: 'Conflict' }),
          makeFeature({ issueId: 'PAN-3', title: 'Ready', readyForMerge: true }),
          makeFeature({ issueId: 'PAN-4', title: 'Work', agentStatus: 'running' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    const ciHealth = screen.getByRole('region', { name: 'Current CI health' });
    expect(ciHealth).toHaveTextContent('1 failing checks');
    expect(within(ciHealth).getByText('Required checks').parentElement).toHaveTextContent('1 failing');
    expect(within(ciHealth).getByText('Mergeability').parentElement).toHaveTextContent('1 blocked');
    expect(within(ciHealth).getByText('Ship-ready').parentElement).toHaveTextContent('1 clear');
    expect(within(ciHealth).getByText('Work agents').parentElement).toHaveTextContent('1 running');
    expect(ciHealth).toHaveTextContent('Blocking details');
    expect(ciHealth).toHaveTextContent('PAN-1');
    expect(ciHealth).toHaveTextContent('Checks failing');
    expect(ciHealth).toHaveTextContent('test job failed on main');
    expect(ciHealth).toHaveTextContent('PAN-2');
    expect(ciHealth).toHaveTextContent('Merge conflict');
    expect(ciHealth).toHaveTextContent('src/app.ts conflicts');
  });

  it('wires hero stat cards to their optional callbacks', () => {
    const onOpenCosts = vi.fn();
    const onOpenAgents = vi.fn();
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[makeFeature({ issueId: 'PAN-1', agentStatus: 'running' })]}
        issueCosts={{ 'PAN-1': 5 }}
        onSelectFeature={() => {}}
        onOpenCosts={onOpenCosts}
        onOpenAgents={onOpenAgents}
      />,
    );

    fireEvent.click(screen.getByText('Spend').parentElement!);
    expect(onOpenCosts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Agents').parentElement!);
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });
});
