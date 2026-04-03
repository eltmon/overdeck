import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Issue, Agent } from '../types';
import type { SpecialistAgent } from './SpecialistAgentCard';
import { groupByLabels, groupByCanceledType, ListIssueRow } from './KanbanBoard';

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
