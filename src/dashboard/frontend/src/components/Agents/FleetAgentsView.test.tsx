import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { FleetAgentsView } from './FleetAgentsView';
import { IssueDrawer } from '../drawer/IssueDrawer';
import { DialogProvider } from '../DialogProvider';

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

function renderFleetView(props: { onNavigateToIssues?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(['cost-stream', undefined, 500], {
    events: [],
    byIssue: {
      'pan-1': [{ ts: '2026-05-18T00:00:00.000Z', model: 'opus', provider: 'anthropic', cost: 12.34, tokens: 456_000 }],
    },
    count: 1,
  });

  return render(
    <QueryClientProvider client={client}>
      <FleetAgentsView {...props} />
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
      if (url.startsWith('/api/costs/stream')) {
        return new Response(JSON.stringify({
          events: [],
          byIssue: {
            'pan-1': [{ ts: '2026-05-18T00:00:00.000Z', model: 'opus', provider: 'anthropic', cost: 12.34, tokens: 456_000 }],
          },
          count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders running and stuck AgentCard primitives in the fleet grid', () => {
    renderFleetView();

    expect(screen.getByText('agent-running')).toBeInTheDocument();
    expect(screen.getByText('agent-stuck')).toBeInTheDocument();
    expect(screen.queryByText('agent-idle')).not.toBeInTheDocument();
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

  it('treats error and unknown contract statuses as non-running stuck fleet agents', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-error': agent({ id: 'agent-error', issueId: 'PAN-1', status: 'error', role: 'work', lastFailureReason: 'Process exited' }),
        'agent-unknown': agent({ id: 'agent-unknown', issueId: 'PAN-2', status: 'unknown', role: 'review' }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderFleetView();

    expect(screen.getByText('agent-error')).toBeInTheDocument();
    expect(screen.getByText('agent-unknown')).toBeInTheDocument();
    expect(screen.getAllByText(/STUCK ·/)).toHaveLength(2);
    expect(screen.queryByText('WORK RUNNING')).not.toBeInTheDocument();
    expect(screen.queryByText('REVIEW RUNNING')).not.toBeInTheDocument();
    expect(within(screen.getByText('Running').closest('[data-component="metric-tile"]') as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(within(screen.getByText('Stuck').closest('[data-component="metric-tile"]') as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  it('opens the drawer from a fleet card and scrolls to the active-agent element', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(['cost-stream', undefined, 500], {
      events: [],
      byIssue: {
        'pan-1': [{ ts: '2026-05-18T00:00:00.000Z', model: 'opus', provider: 'anthropic', cost: 12.34, tokens: 456_000 }],
      },
      count: 1,
    });

    render(
      <QueryClientProvider client={client}>
        <DialogProvider>
          <FleetAgentsView />
          <IssueDrawer />
        </DialogProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getAllByText('Open issue')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1', tab: 'overview' });
    expect(window.location.search).toBe('?issue=PAN-1&tab=overview');
    expect(window.location.hash).toBe('#active-agent');

    const activeAgent = document.getElementById('active-agent');
    expect(activeAgent).toBeTruthy();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: 'start' });

    scrollSpy.mockRestore();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
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
    expect(screen.queryByText('agent-idle')).not.toBeInTheDocument();
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
    expect(screen.queryByText('agent-idle')).not.toBeInTheDocument();
    expect(screen.queryByText('agent-stuck')).not.toBeInTheDocument();

    expect(screen.queryByLabelText('haiku-4-5')).not.toBeInTheDocument();
  });

  it('avg runtime tile uses only finite startedAt values (all valid)', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-a': agent({ id: 'agent-a', issueId: 'PAN-1', status: 'running', startedAt: '2026-05-18T00:00:00.000Z' }),
        'agent-b': agent({ id: 'agent-b', issueId: 'PAN-2', status: 'running', startedAt: '2026-05-18T01:00:00.000Z' }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderFleetView();

    const tiles = Array.from(document.querySelectorAll('[data-component="metric-tile"]'));
    expect(within(tiles[4] as HTMLElement).getByText('2h 30m')).toBeInTheDocument();
  });

  it('avg runtime tile skips invalid startedAt and averages only valid entries (mixed)', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-valid': agent({ id: 'agent-valid', issueId: 'PAN-1', status: 'running', startedAt: '2026-05-18T00:00:00.000Z' }),
        'agent-invalid': agent({ id: 'agent-invalid', issueId: 'PAN-2', status: 'running', startedAt: undefined as any }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderFleetView();

    const tiles = Array.from(document.querySelectorAll('[data-component="metric-tile"]'));
    expect(within(tiles[4] as HTMLElement).getByText('3h 0m')).toBeInTheDocument();
  });

  it('avg runtime tile renders 0m when all running agents have invalid startedAt', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-bad-1': agent({ id: 'agent-bad-1', issueId: 'PAN-1', status: 'running', startedAt: undefined as any }),
        'agent-bad-2': agent({ id: 'agent-bad-2', issueId: 'PAN-2', status: 'running', startedAt: '' as any }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderFleetView();

    const tiles = Array.from(document.querySelectorAll('[data-component="metric-tile"]'));
    expect(within(tiles[4] as HTMLElement).getByText('0m')).toBeInTheDocument();
  });

  it('renders TopBar with breadcrumb, meta, search placeholder, segmented control, and Start agent button', () => {
    renderFleetView({ onNavigateToIssues: vi.fn() });

    expect(screen.getByText('Eltmon / Agents')).toBeInTheDocument();
    expect(screen.getByText(/1 active · 1 stuck · 3h 0m cumulative runtime/)).toBeInTheDocument();
    expect(screen.getByText('Search agents by name, issue, model…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start agent' })).toBeInTheDocument();
  });

  it('defaults to grid view and renders the existing card grid', () => {
    renderFleetView();

    expect(screen.getByRole('button', { name: 'grid', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('agent-running')).toBeInTheDocument();
  });

  it('switches to table view with Coming soon placeholder and updates URL', () => {
    renderFleetView();

    fireEvent.click(screen.getByRole('button', { name: 'table' }));
    expect(screen.getByRole('button', { name: 'table', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('table');
    expect(screen.queryByText('agent-running')).not.toBeInTheDocument();
  });

  it('switches to timeline view with Coming soon placeholder and updates URL', () => {
    renderFleetView();

    fireEvent.click(screen.getByRole('button', { name: 'timeline' }));
    expect(screen.getByRole('button', { name: 'timeline', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('timeline');
  });

  it('preserves existing filters when switching view mode', () => {
    renderFleetView();

    fireEvent.click(screen.getByRole('button', { name: 'work' }));
    expect(window.location.search).toBe('?phase=work');

    fireEvent.click(screen.getByRole('button', { name: 'table' }));
    expect(new URLSearchParams(window.location.search).get('phase')).toBe('work');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('table');
  });

  it('calls onNavigateToIssues when Start agent is clicked', () => {
    const onNavigateToIssues = vi.fn();
    renderFleetView({ onNavigateToIssues });

    fireEvent.click(screen.getByRole('button', { name: 'Start agent' }));
    expect(onNavigateToIssues).toHaveBeenCalledTimes(1);
  });

  it('does not render Start agent button when onNavigateToIssues is omitted', () => {
    renderFleetView();

    expect(screen.queryByRole('button', { name: 'Start agent' })).not.toBeInTheDocument();
  });
});
