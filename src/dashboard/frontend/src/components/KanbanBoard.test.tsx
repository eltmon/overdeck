import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Issue, Agent } from '../types';
// PAN-1048 — SpecialistAgent retired; specialist-style indicators now come
// from role-tagged AgentSnapshots passed through the `specialists` prop.
import { applyReviewStateToIssue, getPipelineCallToAction, groupByCanceledType, groupByLabels, groupByStatus, IssueCard, ListIssueRow, shouldShowAgentDoneBadge, shouldShowReviewReadyBadge, DivergedBadge, FeatureCard, CompactChildCard } from './KanbanBoard';
import { useDashboardStore } from '../lib/store';
import { DialogProvider } from './DialogProvider';

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
    runtime: 'claude-code',
    model: 'test-model',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  });

  // PAN-1048 — specialist-style agents are now role-tagged AgentSnapshots
  // (review / test / ship) keyed off the `role` primitive.
  const createMockRoleAgent = (overrides: Partial<Agent> = {}): Agent => ({
    id: 'review-1',
    issueId: 'TEST-123',
    runtime: 'claude-code',
    model: 'test-model',
    status: 'running',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    role: 'review',
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

  it('should show specialist indicators (PAN-1048 role primitive)', () => {
    const issue = createMockIssue();
    const specialists = [
      createMockRoleAgent({ id: 'review-1', role: 'review', issueId: 'TEST-123' }),
      createMockRoleAgent({ id: 'test-1', role: 'test', issueId: 'TEST-123' }),
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

    // Title is now `${role} agent` — derived from AgentSnapshot.role.
    expect(screen.getByTitle('review agent')).toBeDefined();
    expect(screen.getByTitle('test agent')).toBeDefined();
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

describe('IssueCard', () => {
  const createMockIssue = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: '',
    status: 'In Progress',
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
    id: 'planning-test-123',
    issueId: 'TEST-123',
    runtime: 'claude-code',
    model: 'test-model',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  });

  function renderIssueCard(props: Partial<ComponentProps<typeof IssueCard>> = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const defaultProps: ComponentProps<typeof IssueCard> = {
      issue: createMockIssue(),
      isSelected: false,
      onSelect: vi.fn(),
      onPlan: vi.fn(),
      ...props,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <IssueCard {...defaultProps} />
        </DialogProvider>
      </QueryClientProvider>,
    );

    return defaultProps;
  }

  it('opens the inspector rather than the planning dialog for planning-only input', () => {
    const onSelect = vi.fn();
    const onPlan = vi.fn();
    renderIssueCard({
      onSelect,
      onPlan,
      planningAgent: createMockAgent({
        hasPendingQuestion: true,
        pendingQuestionCount: 1,
        pendingQuestionPrompt: 'Planning finalized — click Done in the dashboard',
        pendingQuestionReason: 'planning_done',
        agentPhase: 'planning',
      }),
    });

    fireEvent.click(screen.getByTestId('card-input-TEST-123'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onPlan).not.toHaveBeenCalled();
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

// ─── FeatureCard ──────────────────────────────────────────────────────────────

describe('FeatureCard', () => {
  const createMockFeature = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'feature-1',
    identifier: 'F123',
    title: 'Test Feature',
    description: 'A test feature',
    status: 'In Progress',
    priority: 3,
    labels: [],
    url: 'https://rally.com/F123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'rally',
    ...overrides,
  });

  it('renders Plan button when feature is not done', () => {
    const feature = createMockFeature();
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onPlan={vi.fn()}
      />
    );
    expect(screen.getByTestId('action-plan-F123')).toBeDefined();
    expect(screen.getByText('Plan')).toBeDefined();
  });

  it('renders See Plan button when planned label exists', () => {
    const feature = createMockFeature({ labels: ['planned'] });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onPlan={vi.fn()}
      />
    );
    expect(screen.getByText('See Plan')).toBeDefined();
  });

  it('renders See Plan button when hasPlan is true', () => {
    const feature = createMockFeature({ hasPlan: true });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onPlan={vi.fn()}
      />
    );
    expect(screen.getByText('See Plan')).toBeDefined();
  });

  it('renders Tasks button when feature has beads', () => {
    const feature = createMockFeature({ hasBeads: true });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onViewBeads={vi.fn()}
      />
    );
    expect(screen.getByTestId('action-tasks-F123')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
  });

  it('renders vBRIEF button when feature has a plan', () => {
    const feature = createMockFeature({ hasPlan: true });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onViewVBrief={vi.fn()}
      />
    );
    expect(screen.getByTestId('action-vbrief-F123')).toBeDefined();
    expect(screen.getByText('vBRIEF')).toBeDefined();
  });

  it('hides Plan button when feature is done', () => {
    const feature = createMockFeature({ status: 'Done' });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
      />
    );
    expect(screen.queryByTestId('action-plan-F123')).toBeNull();
  });

  it('calls onPlan when Plan button is clicked', () => {
    const onPlan = vi.fn();
    const feature = createMockFeature();
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onPlan={onPlan}
      />
    );
    fireEvent.click(screen.getByTestId('action-plan-F123'));
    expect(onPlan).toHaveBeenCalled();
  });

  it('calls onViewBeads when Tasks button is clicked', () => {
    const onViewBeads = vi.fn();
    const feature = createMockFeature({ hasBeads: true });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onViewBeads={onViewBeads}
      />
    );
    fireEvent.click(screen.getByTestId('action-tasks-F123'));
    expect(onViewBeads).toHaveBeenCalled();
  });

  it('applies selection ring when isSelected is true', () => {
    const feature = createMockFeature();
    const { container } = render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        isSelected={true}
      />
    );
    const card = container.querySelector('.ring-2');
    expect(card).toBeTruthy();
  });

  it('does not apply selection ring when isSelected is false', () => {
    const feature = createMockFeature();
    const { container } = render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        isSelected={false}
      />
    );
    const card = container.querySelector('.ring-2');
    expect(card).toBeFalsy();
  });

  it('calls onSelect when clicking the title/content area', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const feature = createMockFeature();
    const { container } = render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    );
    // Click on the content div (title area)
    const contentDiv = container.querySelector('.flex-1.min-w-0');
    expect(contentDiv).toBeTruthy();
    fireEvent.click(contentDiv!);
    expect(onSelect).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('calls onToggle but not onSelect when clicking the chevron', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const feature = createMockFeature();
    const { container } = render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    );
    const chevronDiv = container.querySelector('[class*="shrink-0"]');
    expect(chevronDiv).toBeTruthy();
    fireEvent.click(chevronDiv!);
    expect(onToggle).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does NOT render Start Agent button', () => {
    const feature = createMockFeature();
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
      />
    );
    expect(screen.queryByText(/Start Agent/i)).toBeNull();
  });

  it('shows Plan button when derivedStatus is in_progress but status is Todo', () => {
    const feature = createMockFeature({ status: 'Todo', derivedStatus: 'in_progress' });
    render(
      <FeatureCard
        feature={feature}
        childCount={2}
        isExpanded={false}
        onToggle={vi.fn()}
        onPlan={vi.fn()}
      />
    );
    expect(screen.getByTestId('action-plan-F123')).toBeDefined();
  });
});

// ─── CompactChildCard ─────────────────────────────────────────────────────────

describe('CompactChildCard', () => {
  const createMockChild = (overrides: Partial<Issue> = {}): Issue => ({
    id: 'child-1',
    identifier: 'US100',
    title: 'Child Story',
    description: '',
    status: 'In Progress',
    priority: 3,
    labels: [],
    url: 'https://rally.com/US100',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project: {
      id: 'proj-1',
      name: 'Test Project',
      color: '#000',
      icon: 'test',
    },
    source: 'rally',
    ...overrides,
  });

  it('renders child identifier and title', () => {
    const child = createMockChild();
    render(<CompactChildCard issue={child} agents={[]} />);
    expect(screen.getByText('US100')).toBeDefined();
    expect(screen.getByText('Child Story')).toBeDefined();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    const child = createMockChild();
    const { container } = render(<CompactChildCard issue={child} agents={[]} onSelect={onSelect} />);
    fireEvent.click(container.firstChild!);
    expect(onSelect).toHaveBeenCalled();
  });

  it('does not call onSelect when clicking the identifier link', () => {
    const onSelect = vi.fn();
    const child = createMockChild();
    render(<CompactChildCard issue={child} agents={[]} onSelect={onSelect} />);
    const link = screen.getByText('US100');
    fireEvent.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies selected background when isSelected is true', () => {
    const child = createMockChild();
    const { container } = render(<CompactChildCard issue={child} agents={[]} isSelected={true} />);
    const el = container.querySelector('.bg-primary\\/10');
    expect(el).toBeTruthy();
  });

  it('does not apply selected background when isSelected is false', () => {
    const child = createMockChild();
    const { container } = render(<CompactChildCard issue={child} agents={[]} isSelected={false} />);
    const el = container.querySelector('.bg-primary\\/10');
    expect(el).toBeFalsy();
  });

  it('shows agent pulse dot when agent is running', () => {
    const child = createMockChild();
    const agents: Agent[] = [{
      id: 'agent-1',
      issueId: 'US100',
      runtime: 'claude-code',
      model: 'test',
      status: 'healthy',
      startedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      killCount: 0,
    }];
    render(<CompactChildCard issue={child} agents={agents} />);
    expect(screen.getByTitle('Agent running')).toBeDefined();
  });
});
