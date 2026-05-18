import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectLens, type ProjectLensTab } from '../ProjectLens';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import type { Issue } from '../../../types';

vi.mock('../../../lib/store', () => ({
  useDashboardStore: vi.fn((selector: any) =>
    selector({ reviewStatusByIssueId: {} }),
  ),
}));

vi.mock('../ZoneCOverviewTabs/OverviewTab', () => ({
  OverviewTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="overview-tab" data-issue={issueId} />
  ),
}));

vi.mock('../ZoneCOverviewTabs/BeadsTab', () => ({
  BeadsTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="beads-tab" data-issue={issueId} />
  ),
}));

vi.mock('../ZoneCOverviewTabs/ActivityTab', () => ({
  ActivityTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="activity-tab" data-issue={issueId} />
  ),
}));

vi.mock('../ZoneCOverviewTabs/CostsTab', () => ({
  CostsTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="costs-tab" data-issue={issueId} />
  ),
}));

vi.mock('../ZoneCOverviewTabs/DiscussionsTab', () => ({
  DiscussionsTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="discussions-tab" data-issue={issueId} />
  ),
}));

function renderLens(props: Partial<React.ComponentProps<typeof ProjectLens>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultFeatures: ProjectFeature[] = [
    {
      issueId: 'PAN-1',
      title: 'Feature One',
      projectName: 'test-project',
      branch: 'feature/pan-1',
      status: 'open',
      stateLabel: 'In Progress',
      agentStatus: 'running',
      hasPlanning: true,
      hasPrd: true,
      hasState: false,
      isShadow: false,
      sessions: [{ type: 'work', presence: 'active', sessionId: 'agent-1', model: 'claude-sonnet', startedAt: '2026-05-18T00:00:00Z', status: 'running', duration: null }],
    },
    {
      issueId: 'PAN-2',
      title: 'Feature Two',
      projectName: 'test-project',
      branch: 'feature/pan-2',
      status: 'open',
      stateLabel: 'Planning',
      agentStatus: null,
      hasPlanning: true,
      hasPrd: false,
      hasState: false,
      isShadow: false,
      sessions: [],
    },
    {
      issueId: 'PAN-3',
      title: 'Feature Three',
      projectName: 'test-project',
      branch: 'feature/pan-3',
      status: 'open',
      stateLabel: 'Done',
      agentStatus: null,
      hasPlanning: false,
      hasPrd: false,
      hasState: false,
      isShadow: false,
      sessions: [],
      readyForMerge: true,
    },
  ];

  const defaultIssues: Issue[] = [
    {
      id: '1',
      identifier: 'PAN-1',
      title: 'Feature One',
      status: 'open',
      priority: 1,
      labels: ['bug'],
      url: '',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T10:00:00Z',
    },
    {
      id: '2',
      identifier: 'PAN-2',
      title: 'Feature Two',
      status: 'open',
      priority: 3,
      labels: [],
      url: '',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T08:00:00Z',
    },
    {
      id: '3',
      identifier: 'PAN-3',
      title: 'Feature Three',
      status: 'open',
      priority: 2,
      labels: ['enhancement'],
      url: '',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T09:00:00Z',
    },
  ];

  return render(
    <QueryClientProvider client={client}>
      <ProjectLens
        projectName="test-project"
        features={defaultFeatures}
        issueCosts={{ 'PAN-1': 1.23 }}
        issues={defaultIssues}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectLens', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the tab strip with all 6 tabs', () => {
    renderLens();
    expect(screen.getByRole('tab', { name: /Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Plans/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Beads/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Conversations/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Activity/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Settings/i })).toBeInTheDocument();
  });

  it('defaults to Pipeline tab', () => {
    renderLens();
    expect(screen.getByTestId('project-lens-panel-pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('project-lens-phase-work')).toBeInTheDocument();
    expect(screen.getByTestId('project-lens-phase-ship')).toBeInTheDocument();
    expect(screen.getByTestId('project-lens-phase-plan')).toBeInTheDocument();
    expect(screen.getByTestId('project-lens-phase-todo')).toBeInTheDocument();
  });

  it('renders IssueRow components in Pipeline tab grouped by phase', () => {
    renderLens();

    // PAN-1 has active work agent → work phase
    const workRows = screen.getAllByTestId('project-lens-panel-pipeline')[0]?.querySelector('[data-phase="work"]');
    expect(workRows).toBeTruthy();
    expect(screen.getByText('Feature One')).toBeInTheDocument();

    // PAN-3 is readyForMerge → ship phase
    expect(screen.getByText('Feature Three')).toBeInTheDocument();

    // PAN-2 has planning, no work session → plan phase
    expect(screen.getByText('Feature Two')).toBeInTheDocument();
  });

  it('switches to Plans tab and renders OverviewTab for the default active issue', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Plans/i }));

    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    // First feature (PAN-1) is default active issue
    expect(screen.getByTestId('overview-tab')).toHaveAttribute('data-issue', 'PAN-1');
  });

  it('switches to Beads tab and renders BeadsTab', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Beads/i }));
    expect(screen.getByTestId('beads-tab')).toBeInTheDocument();
  });

  it('switches to Conversations tab and renders DiscussionsTab', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Conversations/i }));
    expect(screen.getByTestId('discussions-tab')).toBeInTheDocument();
  });

  it('switches to Activity tab and renders ActivityTab', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Activity/i }));
    expect(screen.getByTestId('activity-tab')).toBeInTheDocument();
  });

  it('switches to Settings tab and renders CostsTab', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Settings/i }));
    expect(screen.getByTestId('costs-tab')).toBeInTheDocument();
  });

  it('persists tab selection in localStorage per-project', () => {
    renderLens();
    fireEvent.click(screen.getByRole('tab', { name: /Activity/i }));

    expect(localStorage.getItem('project-lens-tab-test-project')).toBe('activity');
  });

  it('restores tab from localStorage on mount', () => {
    localStorage.setItem('project-lens-tab-test-project', 'settings');
    renderLens();

    expect(screen.getByTestId('costs-tab')).toBeInTheDocument();
  });

  it('clicking an IssueRow sets active issue and switches to Plans tab', () => {
    renderLens();

    // Find and click PAN-2 issue row
    const pan2Row = screen.getAllByText('Feature Two')[0]?.closest('button');
    expect(pan2Row).toBeTruthy();
    fireEvent.click(pan2Row!);

    // Should switch to Plans tab
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(screen.getByTestId('overview-tab')).toHaveAttribute('data-issue', 'PAN-2');

    // Should persist active issue
    expect(localStorage.getItem('project-lens-issue-test-project')).toBe('PAN-2');
  });

  it('restores active issue from localStorage on mount', () => {
    localStorage.setItem('project-lens-issue-test-project', 'PAN-3');
    renderLens();

    fireEvent.click(screen.getByRole('tab', { name: /Plans/i }));
    expect(screen.getByTestId('overview-tab')).toHaveAttribute('data-issue', 'PAN-3');
  });

  it('shows empty state for all phases when no features', () => {
    renderLens({ features: [] });
    PHASE_ORDER.forEach((phase) => {
      expect(screen.getByTestId(`project-lens-phase-${phase}`)).toHaveTextContent(/No issues/i);
    });
  });

  it('shows no-issue placeholder when detail tab has no active issue and project is empty', () => {
    renderLens({ features: [] });
    fireEvent.click(screen.getByRole('tab', { name: /Plans/i }));
    expect(screen.getByTestId('project-lens-no-issue')).toBeInTheDocument();
  });

  it('calls onOpenIssue when IssueRow is clicked and prop is provided', () => {
    const onOpenIssue = vi.fn();
    renderLens({ onOpenIssue });

    const pan2Row = screen.getAllByText('Feature Two')[0]?.closest('button');
    expect(pan2Row).toBeTruthy();
    fireEvent.click(pan2Row!);

    expect(onOpenIssue).toHaveBeenCalledWith('PAN-2');
    // Should NOT switch to Plans tab when onOpenIssue is provided
    expect(screen.queryByTestId('overview-tab')).not.toBeInTheDocument();
  });

  it('falls back to Plans tab when IssueRow is clicked without onOpenIssue', () => {
    renderLens();

    const pan2Row = screen.getAllByText('Feature Two')[0]?.closest('button');
    expect(pan2Row).toBeTruthy();
    fireEvent.click(pan2Row!);

    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });
});

const PHASE_ORDER = ['ship', 'review', 'work', 'plan', 'todo'] as const;
