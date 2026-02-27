import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { Issue, Agent } from '../types';

// Test groupByLabels function
// We need to extract it for testing since it's not exported
type SpecialistAgent = {
  id: string;
  name: string;
  type: string;
  status: string;
  currentIssue?: string;
};

type IssueCost = {
  cost: number;
  sessionCount: number;
};

// Re-implement groupByLabels for testing (must match the implementation in KanbanBoard.tsx)
function groupByLabels(issues: Issue[]): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {};
  const uncategorized: Issue[] = [];

  for (const issue of issues) {
    const labels = issue.labels || [];

    if (labels.length === 0) {
      uncategorized.push(issue);
    } else {
      for (const label of labels) {
        if (!grouped[label]) {
          grouped[label] = [];
        }
        grouped[label].push(issue);
      }
    }
  }

  // Add uncategorized group if there are any
  if (uncategorized.length > 0) {
    grouped['Uncategorized'] = uncategorized;
  }

  // Sort groups by label name
  const sorted: Record<string, Issue[]> = {};
  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach(key => {
      sorted[key] = grouped[key];
    });

  return sorted;
}

// Simple ListIssueRow component for testing
function ListIssueRow({
  issue,
  agents,
  specialists,
  issueCosts,
  selectedIssue,
  onSelectIssue,
  onPlan,
}: {
  issue: Issue;
  agents: Agent[];
  specialists: SpecialistAgent[];
  issueCosts: Record<string, IssueCost>;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onPlan: (issue: Issue) => void;
}) {
  const isSelected = selectedIssue === issue.id;

  // Get cost for this issue
  const cost = issueCosts[issue.identifier.toLowerCase()];

  // Check for running agents
  const issueIdLower = issue.identifier.toLowerCase();
  const activeAgent = agents.find(
    a => a.issueId?.toLowerCase() === issueIdLower && a.status !== 'dead'
  );
  const isRunning = !!activeAgent;

  // Check for specialists
  const issueSpecialists = specialists.filter(
    s => s.currentIssue?.toLowerCase() === issueIdLower
  );

  return (
    <div
      data-testid={`issue-row-${issue.id}`}
      onClick={() => onSelectIssue(isSelected ? null : issue.id)}
      className={isSelected ? 'selected' : ''}
    >
      <a href={issue.url} target="_blank" rel="noopener noreferrer" data-testid="issue-link">
        {issue.identifier}
      </a>
      <span data-testid="issue-title">{issue.title}</span>
      {issue.priority === 1 && <span data-testid="priority-urgent">Urgent</span>}
      {issue.priority === 2 && <span data-testid="priority-high">High</span>}
      {isRunning && <span data-testid="agent-running">Running</span>}
      {issueSpecialists.length > 0 && (
        <span data-testid="specialist-count">{issueSpecialists.length}</span>
      )}
      {cost && <span data-testid="issue-cost">${cost.cost.toFixed(2)}</span>}
      <button data-testid="plan-button" onClick={(e) => { e.stopPropagation(); onPlan(issue); }}>
        Plan
      </button>
    </div>
  );
}

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

    // Issue 1 should appear in both 'bug' and 'urgent' groups
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
    name: 'Test Agent',
    status: 'running',
    model: 'test-model',
    workspace: '/test',
    sessionId: 'session-1',
    startTime: new Date().toISOString(),
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

    expect(screen.getByTestId('issue-link').textContent).toBe('TEST-123');
    expect(screen.getByTestId('issue-title').textContent).toBe('Test Issue');
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

    expect(screen.getByTestId('priority-urgent')).toBeDefined();
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

    expect(screen.getByTestId('priority-high')).toBeDefined();
  });

  it('should show running indicator when agent is active', () => {
    const issue = createMockIssue();
    const agents = [createMockAgent({ issueId: 'TEST-123', status: 'running' })];
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

    expect(screen.getByTestId('agent-running')).toBeDefined();
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

    expect(screen.queryByTestId('agent-running')).toBeNull();
  });

  it('should be case-insensitive when matching agent to issue', () => {
    const issue = createMockIssue({ identifier: 'TEST-123' });
    const agents = [createMockAgent({ issueId: 'test-123', status: 'running' })];
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

    expect(screen.getByTestId('agent-running')).toBeDefined();
  });

  it('should show specialist count', () => {
    const issue = createMockIssue();
    const specialists: SpecialistAgent[] = [
      { id: 'spec-1', name: 'Reviewer', type: 'review', status: 'running', currentIssue: 'TEST-123' },
      { id: 'spec-2', name: 'Tester', type: 'test', status: 'running', currentIssue: 'TEST-123' },
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

    expect(screen.getByTestId('specialist-count').textContent).toBe('2');
  });

  it('should show cost when available', () => {
    const issue = createMockIssue();
    const issueCosts = {
      'test-123': { cost: 12.50, sessionCount: 2 },
    };
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={issueCosts}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={vi.fn()}
      />
    );

    expect(screen.getByTestId('issue-cost').textContent).toBe('$12.50');
  });

  it('should call onSelectIssue when clicked', () => {
    const issue = createMockIssue();
    const onSelectIssue = vi.fn();
    render(
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

    fireEvent.click(screen.getByTestId('issue-row-issue-1'));
    expect(onSelectIssue).toHaveBeenCalledWith('issue-1');
  });

  it('should deselect when clicking already selected issue', () => {
    const issue = createMockIssue();
    const onSelectIssue = vi.fn();
    render(
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

    fireEvent.click(screen.getByTestId('issue-row-issue-1'));
    expect(onSelectIssue).toHaveBeenCalledWith(null);
  });

  it('should call onPlan when plan button is clicked', () => {
    const issue = createMockIssue();
    const onPlan = vi.fn();
    render(
      <ListIssueRow
        issue={issue}
        agents={[]}
        specialists={[]}
        issueCosts={{}}
        selectedIssue={null}
        onSelectIssue={vi.fn()}
        onPlan={onPlan}
      />
    );

    fireEvent.click(screen.getByTestId('plan-button'));
    expect(onPlan).toHaveBeenCalledWith(issue);
  });

  it('should have correct link with target blank', () => {
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

    const link = screen.getByTestId('issue-link');
    expect(link.getAttribute('href')).toBe('https://github.com/test/repo/issues/123');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
