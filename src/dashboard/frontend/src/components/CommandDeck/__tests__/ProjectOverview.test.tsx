import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bucketFeaturePhase, ProjectOverview } from '../ProjectOverview';
import type { PipelineIssuePhase } from '../../../lib/pipeline-state';
import { useDashboardStore } from '../../../lib/store';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import type { DerivedIssueState } from '../../../types';
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

function derived(overrides: Partial<DerivedIssueState> & Pick<DerivedIssueState, 'state'>): DerivedIssueState {
  return { issueId: 'PAN-1044', ...overrides };
}

function expectPhase(
  expected: PipelineIssuePhase,
  featureOverrides: Partial<ProjectFeature>,
  state?: Partial<DerivedIssueState> & Pick<DerivedIssueState, 'state'>,
) {
  expect(
    bucketFeaturePhase(makeFeature(featureOverrides), state ? derived(state) : undefined),
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
    useDashboardStore.setState({ derivedIssueStateByIssueId: {} });
  });

  it('maps every derived state onto its lane', () => {
    expectPhase('todo', {}, { state: 'backlog' });
    expectPhase('todo', {}, { state: 'parked' });
    expectPhase('plan', {}, { state: 'planned' });
    expectPhase('work', {}, { state: 'working' });
    expectPhase('review', {}, { state: 'in-review' });
    expectPhase('review', {}, { state: 'changes-requested' });
    expectPhase('ship', {}, { state: 'ready' });
    expectPhase('ship', {}, { state: 'merged' });
    expectPhase('ship', {}, { state: 'closed' });
  });

  it('ignores the tracker label once the issue has a derived state', () => {
    expectPhase('work', { stateLabel: 'Done' }, { state: 'working' });
  });

  it('falls back to the tracker state when nothing is derived yet', () => {
    expectPhase('work', { agentStatus: 'running' });
    expectPhase('work', {
      agentStatus: 'stopped',
      sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
    });
    expectPhase('ship', { stateLabel: 'Merged — Needs Close-Out' });
    expectPhase('review', { stateLabel: 'In Review' });
    expectPhase('plan', { hasPlanning: true });
    expectPhase('todo', { agentStatus: 'stopped' });
    expectPhase('todo', {});
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
      if (method === 'GET' && url.startsWith('/api/merge-train/board')) {
        return Response.json({ masterEnabled: true, projects: [] });
      }
      if (method === 'GET' && url === '/api/merge-train/merge-backend') {
        return Response.json({ available: true, mode: 'gh-cli', detail: 'ok' });
      }
      if (method === 'GET' && url === '/api/projects/overdeck/swarm-policy') {
        return Response.json({});
      }
      if (method === 'GET' && url === '/api/projects/overdeck/version-sync') {
        return Response.json({ config: null, lastOutcome: null });
      }
      return undefined;
    });
    useDashboardStore.setState({ derivedIssueStateByIssueId: {} });
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

  // PAN-5294 G-D8: full-width rows — id, full title, stage tag, who, age; no
  // avatar, cost or session columns (per-issue spend moved to the tooltip).
  it('renders pipeline rows with issue id, full title, stage tag, who and age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({ issueId: 'PAN-1', state: 'working' }),
        'PAN-2': derived({
          issueId: 'PAN-2',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/5127', number: 5127, reviewState: 'approved', checks: 'green', mergeable: true },
        }),
      },
    });
    try {
      render(
        <ProjectOverview
          projectName="overdeck"
          features={[
            makeFeature({
              issueId: 'PAN-1',
              title: 'First issue with a long full title',
              taskTotals: { total: 7, closed: 4, inProgress: 1, lastUpdated: '2026-11-15T11:00:00Z' },
              sessions: [{
                type: 'work',
                presence: 'active',
                model: 'claude-sonnet-4-6',
                startedAt: '2026-11-15T10:00:00Z',
              }] as ProjectFeature['sessions'],
            }),
            makeFeature({ issueId: 'PAN-2', title: 'Second issue' }),
          ]}
          issueCosts={{ 'PAN-1': 1.25 }}
          onSelectFeature={() => {}}
        />,
      );

      const row1 = rowFor('PAN-1');
      expect(row1).toHaveAttribute('data-lane', 'building');
      expect(within(row1).getByText('PAN-1')).toBeInTheDocument();
      expect(within(row1).getByText('First issue with a long full title')).toBeInTheDocument();
      expect(within(row1).getByText('building')).toBeInTheDocument();
      expect(within(row1).getByText('sonnet-4-6 · 4 of 7 items')).toBeInTheDocument();
      expect(within(row1).getByText('1 h')).toBeInTheDocument();
      expect(row1.getAttribute('title')).toContain('spent $1.25');
      expect(row1).not.toHaveTextContent('$1.25');
      expect(row1).not.toHaveTextContent('sessions');

      const row2 = rowFor('PAN-2');
      expect(row2).toHaveAttribute('data-lane', 'review');
      expect(within(row2).getByText('in review')).toBeInTheDocument();
      expect(within(row2).getByText('PR #5127 · checks green')).toBeInTheDocument();
      expect(within(row2).getByText('—')).toBeInTheDocument();
      expect(row2.getAttribute('title')).not.toContain('spent');
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onSelectFeature when a pipeline row is clicked', () => {
    const onSelectFeature = vi.fn();
    const feature = makeFeature({ issueId: 'PAN-1', title: 'Click me', agentStatus: 'running' });
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
      derivedIssueStateByIssueId: {
        'PAN-1': derived({ issueId: 'PAN-1', state: 'in-review' }),
        'PAN-2': derived({ issueId: 'PAN-2', state: 'ready' }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Reviewing' }),
          makeFeature({ issueId: 'PAN-2', title: 'Ready' }),
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
            pipelineBucket: 'planned_backlog',
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

    const row = rowFor('PAN-1');
    expect(row).toHaveAttribute('data-needs-you', 'false');
    expect(row).not.toHaveTextContent('needs you');
    expect(row).toHaveTextContent('planning');
  });

  // PAN-5294 G-D6/G-D8: the blocked tag is the row's one signal; the stuck
  // reason stays one hover away in the row tooltip.
  it('shows a blocked tag and the stuck reason in the row tooltip', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({
          issueId: 'PAN-1',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'approved', checks: 'red', mergeable: true },
        }),
        'PAN-2': derived({ issueId: 'PAN-2', state: 'working', attention: 'api-error' }),
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

    expect(within(rowFor('PAN-1')).getByText('blocked')).toBeInTheDocument();
    expect(rowFor('PAN-1').getAttribute('title')).toBe('Checks failing on the pull request');
    expect(within(rowFor('PAN-2')).getByText('blocked')).toBeInTheDocument();
    expect(rowFor('PAN-2').getAttribute('title')).toBe('Provider errors — the agent cannot make a call');
  });

  it('summarizes current CI health from the forge', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({
          issueId: 'PAN-1',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'approved', checks: 'red', mergeable: true },
        }),
        'PAN-2': derived({
          issueId: 'PAN-2',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/2', number: 2, reviewState: 'approved', checks: 'green', mergeable: false },
        }),
        'PAN-3': derived({ issueId: 'PAN-3', state: 'ready' }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'CI red' }),
          makeFeature({ issueId: 'PAN-2', title: 'Conflict' }),
          makeFeature({ issueId: 'PAN-3', title: 'Ready' }),
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
    expect(ciHealth).toHaveTextContent('Checks failing on PR #1');
    expect(ciHealth).toHaveTextContent('PAN-2');
    expect(ciHealth).toHaveTextContent('The pull request conflicts with main');
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

describe('ProjectOverview new-workspace affordance (PAN-3330 FR-6c)', () => {
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method !== 'GET') return undefined;
      if (url === '/api/costs/summary?project=PAN') return Response.json({ totalCost: 0 });
      if (url === '/api/projects/overdeck/auto-merge-default') return Response.json({ autoMerge: false });
      if (url === '/api/projects/overdeck/merge-train') return Response.json({ value: null, effective: true });
      if (url.startsWith('/api/merge-train/board')) return Response.json({ masterEnabled: true, projects: [] });
      if (url === '/api/merge-train/merge-backend') return Response.json({ available: true, mode: 'gh-cli', detail: 'ok' });
      if (url === '/api/projects/overdeck/swarm-policy') return Response.json({});
      if (url === '/api/projects/overdeck/version-sync') return Response.json({ config: null, lastOutcome: null });
      return undefined;
    });
  });

  afterEach(async () => {
    cleanup();
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
  });

  it('opens the dialog with that project preselected', () => {
    const onNewWorkspace = vi.fn();
    render(
      <ProjectOverview
        projectName="Overdeck"
        projectKey="overdeck"
        features={[]}
        issueCosts={{}}
        onSelectFeature={() => {}}
        onNewWorkspace={onNewWorkspace}
      />,
    );

    fireEvent.click(screen.getByTestId('project-overview-new-workspace'));

    expect(onNewWorkspace).toHaveBeenCalledWith('overdeck');
  });

  it('falls back to the routed creation page when given no handler', () => {
    window.history.replaceState(null, '', '/command-deck/overdeck');
    render(
      <ProjectOverview
        projectName="Overdeck"
        projectKey="overdeck"
        features={[]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('project-overview-new-workspace'));

    expect(window.location.pathname).toBe('/workspaces/new');
    expect(window.location.search).toBe('?project=overdeck');
  });

  it('renders no affordance for a project with no key', () => {
    render(
      <ProjectOverview
        projectName="Overdeck"
        features={[]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.queryByTestId('project-overview-new-workspace')).toBeNull();
  });
});
