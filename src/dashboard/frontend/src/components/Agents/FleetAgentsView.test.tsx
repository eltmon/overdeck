import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { FleetAgentsView } from './FleetAgentsView';

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-pan-1',
    issueId: overrides.issueId ?? 'PAN-1',
    role: overrides.role ?? 'work',
    runtime: overrides.runtime ?? 'claude-code',
    model: overrides.model ?? 'claude-opus-4-7',
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt ?? '2026-05-18T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-1',
    identifier: overrides.identifier ?? 'PAN-1',
    title: overrides.title ?? 'Fleet issue',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 3,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-1'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('FleetAgentsView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T03:00:00.000Z'));
    window.history.replaceState(null, '', '/agents');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue({ identifier: 'PAN-1', title: 'Fleet drawer issue' })],
      agentsById: {
        'agent-running': agent({ id: 'agent-running', issueId: 'PAN-1', status: 'running', role: 'work' }),
        'agent-stuck': agent({
          id: 'agent-stuck',
          issueId: 'PAN-2',
          status: 'stuck',
          role: 'review',
          firstFailureInRunAt: '2026-05-18T01:00:00.000Z',
          lastFailureReason: 'No response from agent',
        }),
        'agent-idle': agent({ id: 'agent-idle', issueId: 'PAN-3', status: 'stopped', role: 'ship' }),
        'agent-dead': agent({ id: 'agent-dead', issueId: 'PAN-4', status: 'dead', role: 'work' }),
      },
      agentOutputById: {
        'agent-running': ['boot', 'working on PAN-1'],
        'agent-stuck': ['review started', 'waiting for output'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders running, stuck, and idle AgentCard primitives in the fleet grid', () => {
    render(<FleetAgentsView />);

    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.getByText('agent-stuck')).toBeInTheDocument();
    expect(screen.getByText('agent-idle')).toBeInTheDocument();
    expect(screen.queryByText('agent-dead')).not.toBeInTheDocument();
    expect(screen.getByText('working on PAN-1')).toBeInTheDocument();
  });

  it('renders stuck agents with the destructive override and stuck verb badge', () => {
    render(<FleetAgentsView />);

    expect(screen.getByText('STUCK · 2h')).toBeInTheDocument();
    expect(screen.getByText('No response from agent')).toBeInTheDocument();
    expect(screen.getByText('agent-stuck').closest('[data-component="agent-card"]')).toHaveAttribute('data-stuck', 'true');
  });

  it('opens the drawer from a fleet card issue action', () => {
    render(<FleetAgentsView />);

    fireEvent.click(screen.getAllByText('Open issue')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-1&tab=overview');
  });
});
