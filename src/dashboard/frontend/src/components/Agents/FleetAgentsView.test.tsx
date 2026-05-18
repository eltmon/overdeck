import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function renderFleetView() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(['agents-cost-trends'], { trends: [{ totalCost: 12.34, totalTokens: 456_000 }] });

  return render(
    <QueryClientProvider client={client}>
      <FleetAgentsView />
    </QueryClientProvider>,
  );
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/costs/trends?days=1') {
        return new Response(JSON.stringify({ trends: [{ totalCost: 12.34, totalTokens: 456_000 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders running, stuck, and idle AgentCard primitives in the fleet grid', () => {
    renderFleetView();

    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.getByText('agent-stuck')).toBeInTheDocument();
    expect(screen.getByText('agent-idle')).toBeInTheDocument();
    expect(screen.queryByText('agent-dead')).not.toBeInTheDocument();
    expect(screen.getByText('working on PAN-1')).toBeInTheDocument();
  });

  it('renders the six Agents metric tiles in order with live cost totals', () => {
    renderFleetView();

    const tiles = Array.from(document.querySelectorAll('[data-component="metric-tile"]'));

    expect(tiles).toHaveLength(6);
    expect(tiles.map((tile) => within(tile as HTMLElement).getByText(/Running|Stuck|Cost 24h|Tokens 24h|Avg runtime|Queue/).textContent)).toEqual([
      'Running',
      'Stuck',
      'Cost 24h',
      'Tokens 24h',
      'Avg runtime',
      'Queue',
    ]);
    expect(tiles.map((tile) => tile.getAttribute('data-signal'))).toEqual(['info', 'destructive', 'cost', 'muted', 'review', 'warning']);
    expect(within(tiles[0] as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(tiles[1] as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(tiles[2] as HTMLElement).getByText('$12.3')).toBeInTheDocument();
    expect(within(tiles[3] as HTMLElement).getByText('456K')).toBeInTheDocument();
    expect(within(tiles[4] as HTMLElement).getByText('3h 0m')).toBeInTheDocument();
    expect(tiles[2]).toHaveAttribute('title', 'Open /costs for canonical 24h spend numbers');
  });

  it('renders stuck agents with the destructive override and stuck verb badge', () => {
    renderFleetView();

    expect(screen.getByText('STUCK · 2h')).toBeInTheDocument();
    expect(screen.getByText('No response from agent')).toBeInTheDocument();
    expect(screen.getByText('agent-stuck').closest('[data-component="agent-card"]')).toHaveAttribute('data-stuck', 'true');
  });

  it('opens the drawer from a fleet card issue action', () => {
    renderFleetView();

    fireEvent.click(screen.getAllByText('Open issue')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-1&tab=overview');
  });

  it('filters the fleet grid with multi-select phase pills and syncs the URL', () => {
    renderFleetView();

    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(window.location.search).toBe('?phase=work');
    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.queryByText('agent-idle')).not.toBeInTheDocument();
    expect(screen.queryByText('agent-stuck')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ship' }));
    expect(new URLSearchParams(window.location.search).get('phase')).toBe('work,ship');
    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.getByText('agent-idle')).toBeInTheDocument();
    expect(screen.queryByText('agent-stuck')).not.toBeInTheDocument();
  });

  it('filters additively by project and model dropdowns and syncs the URL', () => {
    useDashboardStore.setState({
      issuesRaw: [
        issue({ identifier: 'PAN-1', title: 'Fleet drawer issue', project: { id: 'pan', name: 'Panopticon', color: '#333' } }),
        issue({ identifier: 'PAN-2', title: 'Stuck issue', project: { id: 'ops', name: 'Ops', color: '#444' } }),
        issue({ identifier: 'PAN-3', title: 'Ship issue', project: { id: 'pan', name: 'Panopticon', color: '#333' } }),
      ],
      agentsById: {
        'agent-running': agent({ id: 'agent-running', issueId: 'PAN-1', status: 'running', role: 'work', model: 'claude-opus-4-7' }),
        'agent-stuck': agent({ id: 'agent-stuck', issueId: 'PAN-2', status: 'stuck', role: 'review', model: 'claude-sonnet-4-6' }),
        'agent-idle': agent({ id: 'agent-idle', issueId: 'PAN-3', status: 'stopped', role: 'ship', model: 'claude-haiku-4-5-20251001' }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderFleetView();

    fireEvent.click(screen.getByLabelText('Panopticon'));
    expect(window.location.search).toBe('?projects=pan');
    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.getByText('agent-idle')).toBeInTheDocument();
    expect(screen.queryByText('agent-stuck')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('haiku-4-5'));
    expect(window.location.search).toBe('?projects=pan&models=claude-haiku-4-5-20251001');
    expect(screen.queryByText('agent-running')).not.toBeInTheDocument();
    expect(screen.getByText('agent-idle')).toBeInTheDocument();
    expect(screen.queryByText('agent-stuck')).not.toBeInTheDocument();
  });
});
