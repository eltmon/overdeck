import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { DialogProvider } from '../../DialogProvider';
import { FeatureItem } from './FeatureItem';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers } from './ProjectNode';
import { useDashboardStore } from '../../../lib/store';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('../../shared/ModelPicker/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [] }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('../../../lib/refresh-dashboard-state', () => ({
  refreshDashboardState: vi.fn(),
}));

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf-token',
  })),
}));

vi.mock('../styles/command-deck.module.css', () => ({ default: {} }));

function makeFeature(overrides?: Partial<ProjectFeature>): ProjectFeature {
  return {
    issueId: 'PAN-1',
    title: 'Test Feature',
    projectName: 'test-project',
    branch: 'feature/pan-1',
    status: 'has_state',
    stateLabel: 'In Review',
    agentStatus: null,
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    isRally: false,
    resourceSources: [],
    resourceDetails: {
      hasWorkspace: false,
      workspacePaths: [],
      localBranchCount: 0,
      localBranchNames: [],
      remoteBranchCount: 0,
      remoteBranchNames: [],
      tmuxSessionCount: 0,
      tmuxSessionNames: [],
      prs: [],
      hasXbrief: false,
      hasTasks: false,
      hasPrd: false,
      dockerContainerCount: 0,
      dockerContainerNames: [],
      conversations: [],
    },
    ...overrides,
  };
}

function renderFeature(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

describe('FeatureItem pull request badge', () => {
  beforeEach(() => {
    localStorage.clear();
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      tasksViewerIssueId: null,
      prdViewerIssueId: null,
      xbriefViewerIssueId: null,
      derivedIssueStateByIssueId: {},
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspacePaths: [],
        localBranchNames: [],
        remoteBranchNames: [],
        tmuxSessionNames: [],
        prs: [],
        dockerContainerNames: [],
      } satisfies ProjectFeatureResourceIdentifiers),
    })));
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the PR badge from derived issue state and omits the duplicate resource-strip chip', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          state: 'in-review',
          pr: {
            url: 'https://github.com/eltmon/overdeck/pull/42',
            number: 42,
            reviewState: 'approved',
            checks: 'green',
            mergeable: true,
          },
        },
      },
    });

    const { container } = renderFeature(
      <FeatureItem
        feature={makeFeature({
          resourceSources: ['pr'],
          resourceDetails: {
            hasWorkspace: false,
            localBranchCount: 0,
            remoteBranchCount: 0,
            tmuxSessionCount: 0,
            prs: [{ number: 42, title: 'Fix the thing', state: 'OPEN', isDraft: false }],
            hasXbrief: false,
            hasTasks: false,
            dockerContainerCount: 0,
            conversations: [],
          },
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    const badge = screen.getByTestId('feature-pr');
    expect(within(badge).getByText('#42')).toBeInTheDocument();

    const strip = container.querySelector('[data-section="ResourceStrip"]');
    expect(strip).not.toBeNull();
    expect(within(strip as HTMLElement).queryByText('#42')).toBeNull();
  });

  it('renders no PR badge without a derived PR, and the resource strip still shows the neutral chip', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          resourceSources: ['pr'],
          resourceDetails: {
            hasWorkspace: false,
            localBranchCount: 0,
            remoteBranchCount: 0,
            tmuxSessionCount: 0,
            prs: [{ number: 7, title: 't', state: 'OPEN', isDraft: false }],
            hasXbrief: false,
            hasTasks: false,
            dockerContainerCount: 0,
            conversations: [],
          },
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    expect(screen.queryByTestId('feature-pr')).toBeNull();
    expect(screen.getByTitle('PR: #7 (open)')).toBeInTheDocument();
  });

  it('clicking the badge opens the PR and does not select the row', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSelect = vi.fn();
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          state: 'in-review',
          pr: {
            url: 'https://github.com/eltmon/overdeck/pull/42',
            number: 42,
            reviewState: 'approved',
            checks: 'green',
            mergeable: true,
          },
        },
      },
    });

    renderFeature(
      <FeatureItem
        feature={makeFeature({ resourceSources: ['pr'] })}
        isSelected={false}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(within(screen.getByTestId('feature-pr')).getByRole('link'));
    expect(openSpy).toHaveBeenCalledWith('https://github.com/eltmon/overdeck/pull/42', '_blank', 'noopener,noreferrer');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
