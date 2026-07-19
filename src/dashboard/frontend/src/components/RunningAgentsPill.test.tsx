import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import type { Agent, Issue } from '../types';
import { isRunningAgentStatus } from './AgentPillPopoverRow';
import { RunningAgentsPill } from './RunningAgentsPill';

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-pan-1',
    issueId: overrides.issueId ?? 'PAN-1',
    role: overrides.role ?? 'work',
    runtime: overrides.runtime ?? 'claude-code',
    model: overrides.model ?? 'claude-sonnet-5',
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt ?? '2026-07-18T11:00:00.000Z',
    lastActivity: overrides.lastActivity ?? '2026-07-18T11:58:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function issue(identifier: string, title: string): Issue {
  return {
    id: identifier,
    identifier,
    title,
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: `https://github.com/eltmon/overdeck/issues/${identifier}`,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T11:00:00.000Z',
  };
}

function setStore(agents: Agent[]) {
  useDashboardStore.setState({
    agentsById: Object.fromEntries(agents.map((entry) => [entry.id, entry])),
    issuesRaw: [
      issue('PAN-1', 'First issue'),
      issue('PAN-2', 'Second issue'),
      issue('PAN-3', 'Third issue'),
    ],
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

describe('RunningAgentsPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    useDashboardStore.setState({ agentsById: {}, issuesRaw: [] } as Parameters<typeof useDashboardStore.setState>[0]);
    vi.useRealTimers();
  });

  it('uses the complete running-family predicate', () => {
    expect(['running', 'active', 'starting', 'thinking', 'working'].every(
      (status) => isRunningAgentStatus(status as Agent['status']),
    )).toBe(true);
    expect(isRunningAgentStatus('stopped')).toBe(false);
    expect(isRunningAgentStatus('failed')).toBe(false);
  });

  it('matches its trigger count to the running rows sorted by latest activity', () => {
    setStore([
      agent({ id: 'agent-1', issueId: 'PAN-1', status: 'running', lastActivity: '2026-07-18T11:58:00.000Z' }),
      agent({ id: 'agent-2', issueId: 'PAN-2', status: 'active' as Agent['status'], lastActivity: '2026-07-18T11:59:00.000Z', model: 'gpt-5.6' }),
      agent({ id: 'agent-3', issueId: 'PAN-3', status: 'thinking' as Agent['status'], lastActivity: '2026-07-18T11:57:00.000Z' }),
      agent({ id: 'agent-4', issueId: 'PAN-4', status: 'stopped' }),
      agent({ id: 'agent-5', issueId: 'PAN-5', status: 'warning' }),
    ]);

    render(<RunningAgentsPill />);
    fireEvent.click(screen.getByTestId('running-agents-pill'));

    expect(screen.getByTestId('running-agents-pill')).toHaveTextContent('3 agents');
    const popover = screen.getByTestId('running-agents-popover');
    expect(within(popover).getByText('3 running now')).toBeInTheDocument();
    const rows = within(popover).getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('PAN-2'),
      expect.stringContaining('PAN-1'),
      expect.stringContaining('PAN-3'),
    ]);
    expect(within(popover).getByText('gpt-5.6 · 1m ago')).toBeInTheDocument();
  });

  it('renders nothing when no agents have a running-family status', () => {
    setStore([
      agent({ id: 'agent-4', issueId: 'PAN-4', status: 'stopped' }),
      agent({ id: 'agent-5', issueId: 'PAN-5', status: 'failed' }),
    ]);

    const { container } = render(<RunningAgentsPill />);

    expect(container).toBeEmptyDOMElement();
  });

  it('navigates to the selected issue and closes the popover', () => {
    setStore([
      agent({ id: 'agent-2', issueId: 'PAN-2', status: 'running', lastActivity: '2026-07-18T11:59:00.000Z' }),
    ]);

    render(<RunningAgentsPill />);
    fireEvent.click(screen.getByTestId('running-agents-pill'));
    fireEvent.click(screen.getByText('Second issue'));

    expect(window.location.pathname).toBe('/issues/PAN-2');
    expect(screen.queryByTestId('running-agents-popover')).not.toBeInTheDocument();
  });

  it('closes the open popover when Escape is pressed', () => {
    setStore([agent({ id: 'agent-1', issueId: 'PAN-1', status: 'running' })]);

    render(<RunningAgentsPill />);
    fireEvent.click(screen.getByTestId('running-agents-pill'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('running-agents-popover')).not.toBeInTheDocument();
  });
});
