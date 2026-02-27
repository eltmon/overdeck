import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Issue, Agent } from '../types';
import type { SpecialistAgent } from './SpecialistAgentCard';
import { groupByLabels, ListIssueRow } from './KanbanBoard';

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
    expect(onSelectIssue).toHaveBeenCalledWith('issue-1');
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
        selectedIssue="issue-1"
        onSelectIssue={onSelectIssue}
        onPlan={vi.fn()}
      />
    );

    fireEvent.click(container.firstChild!);
    expect(onSelectIssue).toHaveBeenCalledWith(null);
  });

  it('should have correct link', () => {
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

    const links = screen.getAllByRole('link');
    const issueLink = links.find(l => l.textContent === 'TEST-123');
    expect(issueLink).toBeDefined();
    expect(issueLink!.getAttribute('href')).toBe('https://github.com/test/repo/issues/123');
    expect(issueLink!.getAttribute('target')).toBe('_blank');
  });
});
