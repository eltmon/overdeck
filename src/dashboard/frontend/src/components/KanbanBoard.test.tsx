import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Issue } from '../types';
import type { SpecialistAgent } from './SpecialistAgentCard';
import { DialogProvider } from './DialogProvider';
import { applyReviewStateToIssue, FeatureCard, getPipelineCallToAction, groupByCanceledType, groupByLabels, groupByStatus, IssueCard, ListIssueRow, shouldShowAgentDoneBadge, shouldShowReviewReadyBadge, DivergedBadge } from './KanbanBoard';
import { PlanChip, TasksChip, VBriefChip } from './PlanningChips';
import { useDashboardStore } from '../lib/store';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

describe('groupByLabels', () => {
  const createMockIssue = (id: string, labels: string[]): Issue => ({
    id,
    identifier: `TEST-${id}`,
    title: `Test Issue ${id}`,
    description: '',
    status: 'Todo',
    priority: 3,
    labels,
    url: `https://test.com/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
  });

  it('should group issues by single labels', () => {
    const issues: Issue[] = [
      createMockIssue('1', ['bug']),
      createMockIssue('2', ['feature']),
      createMockIssue('3', ['bug']),
    ];

    const result = groupByLabels(issues);

    expect(result['bug']).toHaveLength(2);
    expect(result['feature']).toHaveLength(1);
    expect(result['bug'].map(i => i.id)).toContain('1');
    expect(result['bug'].map(i => i.id)).toContain('3');
    expect(result['feature'].map(i => i.id)).toContain('2');
  });

  it('should group issues with multiple labels into each label group', () => {
    const issues: Issue[] = [
      createMockIssue('1', ['bug', 'urgent']),
      createMockIssue('2', ['feature']),
    ];

    const result = groupByLabels(issues);

    expect(result['bug']).toHaveLength(1);
    expect(result['urgent']).toHaveLength(1);
    expect(result['bug'][0].id).toBe('1');
    expect(result['urgent'][0].id).toBe('1');
    expect(result['feature']).toHaveLength(1);
  });

  it('should put issues with no labels into Uncategorized', () => {
    const issues: Issue[] = [
      createMockIssue('1', []),
      createMockIssue('2', ['bug']),
      createMockIssue('3', []),
    ];

    const result = groupByLabels(issues);

    expect(result['Uncategorized']).toHaveLength(2);
    expect(result['Uncategorized'].map(i => i.id)).toContain('1');
    expect(result['Uncategorized'].map(i => i.id)).toContain('3');
    expect(result['bug']).toHaveLength(1);
  });

  it('should sort groups alphabetically', () => {
    const issues: Issue[] = [
      createMockIssue('1', ['zebra']),
      createMockIssue('2', ['alpha']),
      createMockIssue('3', ['beta']),
    ];

    const result = groupByLabels(issues);
    const keys = Object.keys(result);

    expect(keys[0]).toBe('alpha');
    expect(keys[1]).toBe('beta');
    expect(keys[2]).toBe('zebra');
  });

  it('should handle empty issues array', () => {
    const result = groupByLabels([]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should handle undefined labels as empty', () => {
    const issue: Issue = {
      ...createMockIssue('1', []),
      labels: undefined as unknown as string[],
    };

    const result = groupByLabels([issue]);
    expect(result['Uncategorized']).toHaveLength(1);
  });

  it('should put Uncategorized at the end when sorting', () => {
    const issues: Issue[] = [
      createMockIssue('1', []),
      createMockIssue('2', ['alpha']),
    ];

    const result = groupByLabels(issues);
    const keys = Object.keys(result);

    expect(keys[keys.length - 1]).toBe('Uncategorized');
  });
});

describe('applyReviewStateToIssue', () => {
  const createMockIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'In Review',
    priority: 3,
    labels: ['in-review', 'Review Ready'],
    url: 'https://test.com/TEST-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  it('maps merged review status to a done issue immediately', () => {
    const issue = createMockIssue();

    const result = applyReviewStateToIssue(issue, {
      mergeStatus: 'merged',
      readyForMerge: false,
    });

    expect(result.status).toBe('Done');
    expect(result.mergeStatus).toBe('merged');
    expect(result.targetCanonicalState).toBe('done');
    expect(result.labels).toContain('merged');
    expect(result.labels.map((label) => label.toLowerCase())).not.toContain('in-review');
    expect(result.labels.map((label) => label.toLowerCase())).not.toContain('review ready');
  });
});

describe('shouldShowReviewReadyBadge', () => {
  const createMockIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'In Review',
    priority: 3,
    labels: ['review ready'],
    url: 'https://test.com/TEST-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  it('uses review status as the source of truth when present', () => {
    const issue = createMockIssue();

    expect(shouldShowReviewReadyBadge(issue, { readyForMerge: false, mergeStatus: 'failed' })).toBe(false);
    expect(shouldShowReviewReadyBadge(issue, { readyForMerge: true, mergeStatus: 'failed' })).toBe(true);
  });

  it('falls back to the review ready label when no review status exists', () => {
    const issue = createMockIssue();
    expect(shouldShowReviewReadyBadge(issue)).toBe(true);
  });
});

describe('shouldShowAgentDoneBadge', () => {
  it('shows the done badge while work is still in progress', () => {
    expect(shouldShowAgentDoneBadge({
      issueStatus: 'In Progress',
      isTerminal: false,
      isPipelineStuck: false,
      resolution: 'done',
      hasPendingQuestion: false,
    })).toBe(true);
  });

  it('hides the done badge once the issue is in review', () => {
    expect(shouldShowAgentDoneBadge({
      issueStatus: 'In Review',
      isTerminal: false,
      isPipelineStuck: false,
      resolution: 'done',
      hasPendingQuestion: false,
    })).toBe(false);
  });
});

describe('getPipelineCallToAction', () => {
  it('surfaces Review & Test as the next step after verification failure', () => {
    expect(getPipelineCallToAction({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'failed',
      verificationNotes: 'frontend-typecheck failed',
    })).toEqual({
      label: 'Next: Review & Test',
      detail: 'frontend-typecheck failed',
      title: 'Verification failed — rerun Review & Test to send the failure back through the pipeline.',
    });
  });

  it('surfaces Re-Review as the next step after merge failure', () => {
    expect(getPipelineCallToAction({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'failed',
    })).toEqual({
      label: 'Next: Re-Review',
      detail: 'Merge did not complete.',
      title: 'Merge failed after a prior pass — rerun the pipeline before merging again.',
    });
  });
});

describe('groupByStatus', () => {
  const createMockIssue = (id: string, status: string, overrides: Partial<Issue> = {}): Issue => ({
    id,
    identifier: `TEST-${id}`,
    title: `Test Issue ${id}`,
    description: '',
    status,
    priority: 3,
    labels: [],
    url: `https://test.com/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  it('places merged issues into the done column', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'Done', { mergeStatus: 'merged', labels: ['merged'] }),
      createMockIssue('2', 'In Review'),
    ];

    const result = groupByStatus(issues);

    expect(result.done.map((issue) => issue.identifier)).toContain('TEST-1');
    expect(result.in_review.map((issue) => issue.identifier)).toContain('TEST-2');
  });
});

describe('ListIssueRow', () => {
  const createMockIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'Todo',
    priority: 3,
    labels: [],
    url: 'https://test.com/TEST-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
    id: 'agent-1',
    issueId: 'TEST-123',
    runtime: 'claude',
    model: 'test-model',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  });

  const createMockSpecialist = (overrides: Partial<SpecialistAgent> = {}): SpecialistAgent => ({
    name: 'review-agent',
    displayName: 'Review Agent',
    description: 'Code review',
    enabled: true,
    autoWake: true,
    state: 'active',
    isRunning: true,
    tmuxSession: 'specialist-review-agent',
    ...overrides,
  });

  it('should render issue identifier and title', () => {
    const issue = createMockIssue();
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByText('TEST-123')).toBeDefined();
    expect(screen.getByText('Test Issue')).toBeDefined();
  });

  it('should show urgent priority for priority 1', () => {
    const issue = createMockIssue({ priority: 1 });
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByText('Urgent')).toBeDefined();
  });

  it('should show high priority for priority 2', () => {
    const issue = createMockIssue({ priority: 2 });
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByText('High')).toBeDefined();
  });

  it('should show agent running indicator when agent is active', () => {
    const issue = createMockIssue();
    const agents = [createMockAgent({ issueId: 'TEST-123', status: 'healthy' })];
    render(
      <ListIssueRow
        issue={issue}
        agents={agents}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByTitle('Agent running')).toBeDefined();
  });

  it('should not show running indicator for dead agents', () => {
    const issue = createMockIssue();
    const agents = [createMockAgent({ issueId: 'TEST-123', status: 'dead' })];
    render(
      <ListIssueRow
        issue={issue}
        agents={agents}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.queryByTitle('Agent running')).toBeNull();
  });

  it('should show specialist indicators', () => {
    const issue = createMockIssue();
    const specialists = [
      createMockSpecialist({ name: 'review-agent', displayName: 'Review Agent', currentIssue: 'TEST-123' }),
      createMockSpecialist({ name: 'test-agent', displayName: 'Test Agent', currentIssue: 'TEST-123' }),
    ];
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={specialists}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByTitle('Review Agent specialist')).toBeDefined();
    expect(screen.getByTitle('Test Agent specialist')).toBeDefined();
  });

  it('should call onSelectIssue when clicked', () => {
    const issue = createMockIssue();
    const onSelectIssue = vi.fn();
    const { container } = render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={onSelectIssue}
        onPlan={vi.fn()}
      />
    );

    fireEvent.click(container.firstChild!);
    expect(onSelectIssue).toHaveBeenCalledWith('TEST-123');
  });

  it('should deselect when clicking already selected issue', () => {
    const issue = createMockIssue();
    const onSelectIssue = vi.fn();
    const { container } = render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue="TEST-123"
        onSelectIssue={onSelectIssue}
        onPlan={vi.fn()}
      />
    );

    fireEvent.click(container.firstChild!);
    expect(onSelectIssue).toHaveBeenCalledWith(null);
  });

  it('should have correct external link to tracker', () => {
    const issue = createMockIssue({ url: 'https://github.com/test/repo/issues/123' });
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    // The identifier is shown as a span; the ExternalLink icon button links to the tracker
    const identifier = screen.getByText('TEST-123');
    expect(identifier.tagName).toBe('SPAN');

    const links = screen.getAllByRole('link');
    const trackerLink = links.find(l => l.getAttribute('href') === 'https://github.com/test/repo/issues/123');
    expect(trackerLink).toBeDefined();
    expect(trackerLink!.getAttribute('target')).toBe('_blank');
  });
});

vi.mock('../lib/refresh-dashboard-state', () => ({
  refreshDashboardState: vi.fn(async () => {}),
}));

describe('FeatureCard', () => {
  const originalFetch = global.fetch;

  const createFeature = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'feature-1',
    identifier: 'F1234',
    title: 'Feature title',
    description: '',
    status: 'Todo',
    priority: 3,
    labels: [],
    url: 'https://test.com/F1234',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'rally',
    artifactType: 'PortfolioItem/Feature',
    totalChildCount: 3,
    completedChildCount: 1,
    inProgressChildCount: 1,
    ...overrides,
  });

  const renderFeatureCard = ({
    feature = createFeature(),
    onToggle = vi.fn(),
    registeredProjects = [],
  }: {
    feature?: Issue;
    onToggle?: ReturnType<typeof vi.fn>;
    registeredProjects?: Array<{ issuePattern: string | null }>;
  } = {}) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <FeatureCard
            feature={feature}
            childCount={feature.totalChildCount ?? 0}
            isExpanded={false}
            onToggle={onToggle}
            agents={[]}
            onPlan={vi.fn()}
            onViewBeads={vi.fn()}
            onViewVBrief={vi.fn()}
            registeredProjects={registeredProjects}
          />
        </DialogProvider>
      </QueryClientProvider>
    );

    return { feature, onToggle };
  };

  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      throw new Error('Feature cards must not call planning routes for Rally feature identifiers');
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not render workspace-backed planning actions for Rally feature identifiers like F1234', () => {
    renderFeatureCard();

    expect(screen.queryByRole('button', { name: /plan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /tasks/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /vbrief/i })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders workspace-backed planning actions for custom-format feature identifiers that match a registered project pattern', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: false, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    renderFeatureCard({
      feature: createFeature({
        identifier: 'BUG-123',
        source: 'github',
        artifactType: 'Grouping',
      }),
      registeredProjects: [{ issuePattern: '^(BUG)-(\\d+)$' }],
    });

    expect(await screen.findByRole('button', { name: /plan/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /tasks/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /vbrief/i })).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/BUG-123/planning-state');
    });
  });

  it('still toggles the feature card open without attempting workspace lookups', () => {
    const { onToggle } = renderFeatureCard();

    fireEvent.click(screen.getByText('Feature title'));
    expect(onToggle).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('IssueCard', () => {
  const originalFetch = global.fetch;

  const createIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'Todo',
    priority: 3,
    labels: [],
    url: 'https://test.com/TEST-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  const renderIssueCard = (issue: Issue) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <IssueCard
            issue={issue}
            specialists={[]}
            isSelected={false}
            onSelect={vi.fn()}
            onPlan={vi.fn()}
            onViewBeads={vi.fn()}
            onViewVBrief={vi.fn()}
          />
        </DialogProvider>
      </QueryClientProvider>
    );
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('keeps Tasks, vBRIEF, and Start Agent visible for planned-label-only todo issues before planning state catches up', async () => {
    const issue = createIssue({ labels: ['planned'] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: false, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    renderIssueCard(issue);

    expect(await screen.findByRole('button', { name: /see plan/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /tasks/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /vbrief/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDefined();
  });
});

describe('PlanningChips', () => {
  const originalFetch = global.fetch;

  const createIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'Todo',
    priority: 3,
    labels: [],
    url: 'https://test.com/TEST-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
    ...overrides,
  });

  const renderWithProviders = (ui: React.ReactNode, queryClient?: QueryClient) => {
    const client = queryClient ?? new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <DialogProvider>{ui}</DialogProvider>
      </QueryClientProvider>
    );

    return client;
  };

  const renderPlanChip = ({
    issue = createIssue(),
    onPlan = vi.fn(),
    isPlanningActive = false,
    queryClient,
  }: {
    issue?: Issue;
    onPlan?: ReturnType<typeof vi.fn>;
    isPlanningActive?: boolean;
    queryClient?: QueryClient;
  } = {}) => {
    const client = renderWithProviders(
      <PlanChip issue={issue} onPlan={onPlan} isPlanningActive={isPlanningActive} />,
      queryClient,
    );
    return { issue, onPlan, queryClient: client };
  };

  const renderVBriefChip = ({
    issue = createIssue(),
    onViewVBrief = vi.fn(),
    queryClient,
  }: {
    issue?: Issue;
    onViewVBrief?: ReturnType<typeof vi.fn>;
    queryClient?: QueryClient;
  } = {}) => {
    const client = renderWithProviders(
      <VBriefChip issue={issue} onViewVBrief={onViewVBrief} />,
      queryClient,
    );
    return { issue, onViewVBrief, queryClient: client };
  };

  const renderTasksChip = ({
    issue = createIssue(),
    onViewBeads = vi.fn(),
    queryClient,
  }: {
    issue?: Issue;
    onViewBeads?: ReturnType<typeof vi.fn>;
    queryClient?: QueryClient;
  } = {}) => {
    const client = renderWithProviders(
      <TasksChip issue={issue} onViewBeads={onViewBeads} />,
      queryClient,
    );

    return { issue, onViewBeads, queryClient: client };
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders Plan when no plan exists and calls onPlan', async () => {
    const issue = createIssue();
    const onPlan = vi.fn();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: false, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as typeof fetch;

    renderPlanChip({ issue, onPlan });

    const button = await screen.findByTestId(`action-plan-${issue.identifier}`);
    expect(button.textContent).toContain('Plan');

    fireEvent.click(button);
    expect(onPlan).toHaveBeenCalledWith(issue);
  });

  it('renders See Plan when planning-state reports an existing plan', async () => {
    const issue = createIssue();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: true, hasBeads: true, beadsCount: 2 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as typeof fetch;

    renderPlanChip({ issue });

    expect(await screen.findByText('See Plan')).toBeDefined();
  });

  it('renders Watch Planning when planning is active and bypasses planning-state rendering', async () => {
    const issue = createIssue();
    const onPlan = vi.fn();
    global.fetch = vi.fn(async () => {
      throw new Error('Watch Planning state should not need planning-state fetch to render correctly');
    }) as typeof fetch;

    renderPlanChip({ issue, onPlan, isPlanningActive: true });

    const button = screen.getByTestId(`action-watch-planning-${issue.identifier}`);
    expect(button.textContent).toContain('Watch Planning');
    fireEvent.click(button);
    expect(onPlan).toHaveBeenCalledWith(issue);
  });

  it('renders vBRIEF with success styling when a plan exists and calls onViewVBrief', async () => {
    const issue = createIssue();
    const onViewVBrief = vi.fn();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: true, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as typeof fetch;

    renderVBriefChip({ issue, onViewVBrief });

    const button = await screen.findByRole('button', { name: 'vBRIEF' });
    await waitFor(() => {
      expect(button.className).toContain('text-success');
    });
    fireEvent.click(button);
    expect(onViewVBrief).toHaveBeenCalledWith(issue);
  });

  it('renders vBRIEF muted when no plan exists', async () => {
    const issue = createIssue();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: false, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    }) as typeof fetch;

    renderVBriefChip({ issue });

    const button = await screen.findByRole('button', { name: 'vBRIEF' });
    expect(button.className).toContain('text-muted-foreground');
  });

  it('generates tasks when a plan exists but beads have not been created yet', async () => {
    const issue = createIssue();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: true, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      if (url.endsWith('/generate-tasks')) {
        return {
          ok: true,
          json: async () => ({ success: true, created: ['bead-1'], count: 1 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    global.fetch = fetchMock as typeof fetch;

    renderTasksChip({ issue });

    const button = await screen.findByRole('button', { name: 'Generate Tasks' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/issues/${issue.identifier}/generate-tasks`, { method: 'POST' });
    });
    expect(await screen.findByText('Tasks generated')).toBeDefined();
    expect(screen.getByText('Created 1 bead from the vBRIEF plan.')).toBeDefined();
  });

  it('refreshes planning state and dashboard state after generating tasks', async () => {
    const issue = createIssue();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: true, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      if (url.endsWith('/generate-tasks')) {
        return {
          ok: true,
          json: async () => ({ success: true, created: ['bead-1', 'bead-2'], count: 2 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    global.fetch = fetchMock as typeof fetch;
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

    renderTasksChip({ issue });

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Tasks' }));

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planning-state', issue.identifier] });
      expect(refreshDashboardState).toHaveBeenCalled();
    });
    expect(await screen.findByText('Tasks generated')).toBeDefined();
    expect(screen.getByText('Created 2 beads from the vBRIEF plan.')).toBeDefined();
  });

  it('shows an error alert when task generation fails', async () => {
    const issue = createIssue();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/planning-state')) {
        return {
          ok: true,
          json: async () => ({ hasPlan: true, hasBeads: false, beadsCount: 0 }),
        } as Response;
      }
      if (url.endsWith('/generate-tasks')) {
        return {
          ok: false,
          json: async () => ({ success: false, error: 'Planner exploded' }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    global.fetch = fetchMock as typeof fetch;

    renderTasksChip({ issue });

    fireEvent.click(await screen.findByRole('button', { name: 'Generate Tasks' }));

    expect(await screen.findByText('Generate tasks failed')).toBeDefined();
    expect(screen.getByText('Planner exploded')).toBeDefined();
  });
});

describe('groupByCanceledType', () => {
  const createMockIssue = (id: string, status: string): Issue => ({
    id,
    identifier: `TEST-${id}`,
    title: `Test Issue ${id}`,
    description: '',
    status,
    priority: 3,
    labels: [],
    url: `https://test.com/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'github',
  });

  it('should group canceled status into Canceled group', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'canceled'),
      createMockIssue('2', 'Canceled'),
      createMockIssue('3', 'cancelled'),
      createMockIssue('4', 'Cancelled'),
    ];

    const result = groupByCanceledType(issues);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Canceled');
    expect(result[0].issues).toHaveLength(4);
  });

  it('should group duplicate status into Duplicate group', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'duplicate'),
      createMockIssue('2', 'Duplicate'),
    ];

    const result = groupByCanceledType(issues);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Duplicate');
    expect(result[0].issues).toHaveLength(2);
  });

  it("should group won't do/wontfix status into Won't Do group", () => {
    const issues: Issue[] = [
      createMockIssue('1', "won't do"),
      createMockIssue('2', "Won't Do"),
      createMockIssue('3', 'wontfix'),
      createMockIssue('4', 'WontFix'),
    ];

    const result = groupByCanceledType(issues);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Won't Do");
    expect(result[0].issues).toHaveLength(4);
  });

  it('should group unknown canceled status into Other group', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'some-unknown-status'),
      createMockIssue('2', 'invalid'),
    ];

    const result = groupByCanceledType(issues);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Other');
    expect(result[0].issues).toHaveLength(2);
  });

  it('should filter out empty groups', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'canceled'),
      createMockIssue('2', 'duplicate'),
    ];

    const result = groupByCanceledType(issues);

    // Should only have Canceled and Duplicate groups, no Won't Do or Other
    expect(result).toHaveLength(2);
    expect(result.map(g => g.name)).toContain('Canceled');
    expect(result.map(g => g.name)).toContain('Duplicate');
    expect(result.map(g => g.name)).not.toContain("Won't Do");
    expect(result.map(g => g.name)).not.toContain('Other');
  });

  it('should handle empty issues array', () => {
    const result = groupByCanceledType([]);
    expect(result).toHaveLength(0);
  });

  it('should group mixed canceled types correctly', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'canceled'),
      createMockIssue('2', 'canceled'),
      createMockIssue('3', 'duplicate'),
      createMockIssue('4', "won't do"),
      createMockIssue('5', "won't do"),
      createMockIssue('6', "won't do"),
      createMockIssue('7', 'unknown-status'),
    ];

    const result = groupByCanceledType(issues);

    expect(result).toHaveLength(4);

    const canceledGroup = result.find(g => g.name === 'Canceled');
    const duplicateGroup = result.find(g => g.name === 'Duplicate');
    const wontDoGroup = result.find(g => g.name === "Won't Do");
    const otherGroup = result.find(g => g.name === 'Other');

    expect(canceledGroup?.issues).toHaveLength(2);
    expect(duplicateGroup?.issues).toHaveLength(1);
    expect(wontDoGroup?.issues).toHaveLength(3);
    expect(otherGroup?.issues).toHaveLength(1);
  });

  it('should return groups in consistent order', () => {
    const issues: Issue[] = [
      createMockIssue('1', 'other-status'),
      createMockIssue('2', "won't do"),
      createMockIssue('3', 'duplicate'),
      createMockIssue('4', 'canceled'),
    ];

    const result = groupByCanceledType(issues);

    // Order should be: Canceled, Duplicate, Won't Do, Other
    expect(result[0].name).toBe('Canceled');
    expect(result[1].name).toBe('Duplicate');
    expect(result[2].name).toBe("Won't Do");
    expect(result[3].name).toBe('Other');
  });
});

// ─── DivergedBadge ────────────────────────────────────────────────────────────

describe('DivergedBadge', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('alert', vi.fn());
  });

  it('renders "Diverged" text', () => {
    render(<DivergedBadge issueIdentifier="PAN-1" />);
    expect(screen.getByText('Diverged')).toBeTruthy();
  });

  it('renders an "Unstick" button', () => {
    render(<DivergedBadge issueIdentifier="PAN-1" />);
    expect(screen.getByRole('button', { name: 'Unstick' })).toBeTruthy();
  });

  it('shows generic title when no stuckReason', () => {
    const { container } = render(<DivergedBadge issueIdentifier="PAN-1" />);
    const span = container.querySelector('span[title]');
    expect(span?.getAttribute('title')).toContain('divergence from origin/main');
  });

  it('shows stuckReason in title when provided', () => {
    const { container } = render(<DivergedBadge issueIdentifier="PAN-1" stuckReason="main advanced by 3 commits" />);
    const span = container.querySelector('span[title]');
    expect(span?.getAttribute('title')).toContain('main advanced by 3 commits');
  });

  it('shows abbreviated localSha and remoteSha from stuckDetails in title', () => {
    const details = JSON.stringify({ localSha: 'aaa1111aaaa', remoteSha: 'bbb2222bbbb' });
    const { container } = render(<DivergedBadge issueIdentifier="PAN-1" stuckDetails={details} />);
    const title = container.querySelector('span[title]')?.getAttribute('title') ?? '';
    expect(title).toContain('aaa1111'); // first 7 chars of localSha
    expect(title).toContain('bbb2222'); // first 7 chars of remoteSha
  });

  it('includes recovery instructions in title', () => {
    const { container } = render(<DivergedBadge issueIdentifier="PAN-1" />);
    const title = container.querySelector('span[title]')?.getAttribute('title') ?? '';
    expect(title).toContain('git reset --hard origin/main');
  });

  it('handles malformed stuckDetails gracefully without throwing', () => {
    const { container } = render(<DivergedBadge issueIdentifier="PAN-1" stuckDetails="not-json" />);
    const span = container.querySelector('span[title]');
    // Falls back to the generic message without SHA info
    expect(span?.getAttribute('title')).toContain('divergence from origin/main');
  });

  it('POSTs to /api/workspaces/:issueId/unstick when Unstick is clicked', async () => {
    render(<DivergedBadge issueIdentifier="PAN-42" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unstick' }));
    await Promise.resolve(); // flush microtasks
    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/PAN-42/unstick',
      { method: 'POST' }
    );
  });

  it('URL-encodes the issueIdentifier in the unstick request', async () => {
    render(<DivergedBadge issueIdentifier="PAN 99" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unstick' }));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      '/api/workspaces/PAN%2099/unstick',
      { method: 'POST' }
    );
  });

  it('clears stuck flag in store immediately on successful unstick', async () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-42': { issueId: 'PAN-42', reviewStatus: 'passed', testStatus: 'passed', stuck: true, stuckReason: 'main_diverged' },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<DivergedBadge issueIdentifier="PAN-42" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unstick' }));

    await waitFor(() => {
      expect(useDashboardStore.getState().reviewStatusByIssueId['PAN-42']?.stuck).toBeFalsy();
    });
  });

  it('resets reviewStatus/testStatus to pending in store after unstick (lifecycle invalidated)', async () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-43': { issueId: 'PAN-43', reviewStatus: 'passed', testStatus: 'passed', stuck: true, stuckReason: 'main_diverged' },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<DivergedBadge issueIdentifier="PAN-43" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unstick' }));

    await waitFor(() => {
      const s = useDashboardStore.getState().reviewStatusByIssueId['PAN-43'];
      expect(s?.stuck).toBeFalsy();
      // Lifecycle reset — prior results invalid after `git reset --hard origin/main`
      expect(s?.reviewStatus).toBe('pending');
      expect(s?.testStatus).toBe('pending');
      expect(s?.readyForMerge).toBe(false);
    });
  });

  afterEach(() => {
    useDashboardStore.setState({ reviewStatusByIssueId: {} } as Parameters<typeof useDashboardStore.setState>[0]);
  });
});
