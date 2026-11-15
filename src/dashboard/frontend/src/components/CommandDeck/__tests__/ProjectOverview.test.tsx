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

  // PAN-5294 §5a: the panel is "Pipeline" with the listed issue count; the
  // project name and rename pencil live in the Home header.
  it('labels the panel "Pipeline" with the listed issue count', () => {
    render(
      <ProjectOverview
        projectName="Overdeck"
        projectKey="overdeck"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2', stateLabel: 'In Review' }),
          makeFeature({ issueId: 'PAN-3' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(panel).getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('2 issues');
    expect(screen.queryByRole('heading', { name: 'Overdeck' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Overdeck' })).not.toBeInTheDocument();
  });

  it('renders Building, In review and Ready to merge lanes whose counts follow feature state', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({ issueId: 'PAN-1', state: 'working' }),
        'PAN-2': derived({ issueId: 'PAN-2', state: 'working' }),
        'PAN-3': derived({ issueId: 'PAN-3', state: 'in-review' }),
        'PAN-4': derived({ issueId: 'PAN-4', state: 'ready' }),
      },
    });
    const features = ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4'].map(issueId => makeFeature({ issueId }));
    const { rerender } = render(
      <ProjectOverview
        projectName="overdeck"
        features={features}
        issueCosts={{}}
        onSelectFeature={() => {}}
        needsYouIssueIds={new Set(['PAN-3'])}
      />,
    );

    expect(screen.getByRole('region', { name: 'Pipeline' })).toHaveTextContent('4 issues');
    expect(screen.getByRole('region', { name: 'Building lane' })).toHaveTextContent('Building · 2');
    expect(screen.getByRole('region', { name: 'In review lane' })).toHaveTextContent('In review · 1');
    expect(screen.getByRole('region', { name: 'Ready to merge lane' })).toHaveTextContent('Ready to merge · 1');
    expect(within(rowFor('PAN-3')).getByText('needs you')).toBeInTheDocument();
    expect(rowFor('PAN-1')).not.toHaveTextContent('needs you');

    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({ issueId: 'PAN-1', state: 'in-review' }),
        'PAN-2': derived({ issueId: 'PAN-2', state: 'in-review' }),
        'PAN-3': derived({ issueId: 'PAN-3', state: 'ready' }),
        'PAN-4': derived({ issueId: 'PAN-4', state: 'merged' }),
      },
    });
    rerender(
      <ProjectOverview projectName="overdeck" features={features} issueCosts={{}} onSelectFeature={() => {}} />,
    );

    expect(screen.getByRole('region', { name: 'Pipeline' })).toHaveTextContent('3 issues');
    expect(screen.getByRole('region', { name: 'Building lane' })).toHaveTextContent('Building · 0');
    expect(screen.getByRole('region', { name: 'In review lane' })).toHaveTextContent('In review · 2');
    expect(screen.getByRole('region', { name: 'Ready to merge lane' })).toHaveTextContent('Ready to merge · 1');
  });

  it('shows the Stalled lane only when a stalled issue exists', () => {
    const fresh = makeFeature({ issueId: 'PAN-1', agentStatus: 'running' });
    const stalled = makeFeature({
      issueId: 'PAN-2',
      stateLabel: 'In Progress',
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2020-01-01T00:00:00Z' },
    });
    const { rerender } = render(
      <ProjectOverview projectName="overdeck" features={[fresh]} issueCosts={{}} onSelectFeature={() => {}} />,
    );
    expect(screen.queryByRole('region', { name: 'Stalled lane' })).not.toBeInTheDocument();

    rerender(
      <ProjectOverview projectName="overdeck" features={[fresh, stalled]} issueCosts={{}} onSelectFeature={() => {}} />,
    );
    const lane = screen.getByRole('region', { name: 'Stalled lane' });
    expect(lane).toHaveTextContent('Stalled · 1');
    expect(lane).toHaveTextContent('PAN-2');
    expect(rowFor('PAN-2')).toHaveAttribute('data-lane', 'stalled');
    expect(screen.getByRole('region', { name: 'Building lane' })).not.toHaveTextContent('PAN-2');
  });

  it('omits todo, queued-for-pickup and merged issues from every lane', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({ issueId: 'PAN-1', state: 'backlog' }),
        'PAN-2': derived({ issueId: 'PAN-2', state: 'merged' }),
        'PAN-3': derived({ issueId: 'PAN-3', state: 'closed' }),
      },
    });
    render(
      <ProjectOverview
        projectName="overdeck"
        features={['PAN-1', 'PAN-2', 'PAN-3'].map(issueId => makeFeature({ issueId }))}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.queryAllByTestId('pipeline-row')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Pipeline' })).toHaveTextContent('0 issues');
  });

  it('renders the three lane bars at zero for a project with no listed issues', () => {
    render(
      <ProjectOverview projectName="overdeck" features={[]} issueCosts={{}} onSelectFeature={() => {}} />,
    );

    expect(screen.getByTestId('pipeline-section')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Building lane' })).toHaveTextContent('Building · 0');
    expect(screen.getByRole('region', { name: 'In review lane' })).toHaveTextContent('In review · 0');
    expect(screen.getByRole('region', { name: 'Ready to merge lane' })).toHaveTextContent('Ready to merge · 0');
  });

  it('attaches inReviewRef to the In review lane', () => {
    const inReviewRef = { current: null as HTMLDivElement | null };
    render(
      <ProjectOverview
        projectName="overdeck"
        features={[]}
        issueCosts={{}}
        onSelectFeature={() => {}}
        inReviewRef={inReviewRef}
      />,
    );

    expect(inReviewRef.current).toBe(screen.getByRole('region', { name: 'In review lane' }));
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

  // PAN-5294 G-D6: needs-you issues stay in their lane with a "needs you" tag;
  // the Needs you panel (not the pipeline) lists them.
  it('tags an issue named by needsYouIssueIds "needs you" inside its lane', () => {
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
        needsYouIssueIds={new Set(['PAN-2'])}
      />,
    );

    expect(screen.queryByRole('region', { name: /needs you/i })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ready to merge lane' })).toHaveTextContent('PAN-2');
    expect(rowFor('PAN-2')).toHaveAttribute('data-needs-you', 'true');
    expect(within(rowFor('PAN-2')).getByText('needs you')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In review lane' })).toHaveTextContent('PAN-1');
    expect(rowFor('PAN-1')).toHaveAttribute('data-needs-you', 'false');
  });

  it('lists a plan-approval-pending issue in Building without a needs-you tag when needsYouIssueIds does not name it', () => {
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
        needsYouIssueIds={new Set()}
      />,
    );

    const building = screen.getByRole('region', { name: 'Building lane' });
    expect(building).toHaveTextContent('PAN-1');
    expect(building).toHaveTextContent('PAN-2');
    expect(rowFor('PAN-2')).not.toHaveTextContent('needs you');
    expect(within(rowFor('PAN-2')).getByText('planning')).toBeInTheDocument();
    expect(rowFor('PAN-2').getAttribute('title')).toBe('plan approval pending');
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

  // PAN-5294 G-D14: per-PR CI problems show in the row's who cell and tag.
  it('shows PR #n · checks failing for a review row with red checks', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': derived({
          issueId: 'PAN-1',
          state: 'in-review',
          pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'approved', checks: 'red', mergeable: true },
        }),
      },
    });

    render(
      <ProjectOverview
        projectName="overdeck"
        features={[makeFeature({ issueId: 'PAN-1', title: 'CI red' })]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(within(rowFor('PAN-1')).getByText('PR #1 · checks failing')).toBeInTheDocument();
    expect(within(rowFor('PAN-1')).getByText('blocked')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current CI health' })).not.toBeInTheDocument();
  });

  it('Open the board navigates to /board', () => {
    window.history.replaceState(null, '', '/command-deck/overdeck');
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    try {
      render(
        <ProjectOverview projectName="overdeck" features={[]} issueCosts={{}} onSelectFeature={() => {}} />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Open the board' }));

      expect(window.location.pathname).toBe('/board');
      expect(window.history.state).toEqual({ tab: 'kanban' });
      expect(onPopState).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('popstate', onPopState);
    }
  });
});
