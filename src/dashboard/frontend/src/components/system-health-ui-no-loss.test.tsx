import type {
  AgentHealthSnapshot,
  HealthState,
  SystemHealthSnapshot,
} from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import { DialogProvider } from './DialogProvider';
import { HealthDashboard } from './HealthDashboard';
import { SystemHealthPill } from './SystemHealthPill';

const {
  hookState,
  mockConfirmAndKill,
  mockOpenIssue,
  mockRefreshDashboardState,
  mockToastError,
} = vi.hoisted(() => ({
  hookState: {
    current: undefined as {
      data: SystemHealthSnapshot | undefined;
      isLoading: boolean;
      error: Error | null;
    } | undefined,
  },
  mockConfirmAndKill: vi.fn(),
  mockOpenIssue: vi.fn(),
  mockRefreshDashboardState: vi.fn().mockResolvedValue(undefined),
  mockToastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}));

vi.mock('../hooks/useSystemHealth', () => ({
  useSystemHealth: () => hookState.current,
}));

vi.mock('../hooks/useKillAgent', () => ({
  useKillAgent: () => ({
    confirmAndKill: mockConfirmAndKill,
    isPending: false,
  }),
}));

vi.mock('../lib/refresh-dashboard-state', () => ({
  refreshDashboardState: mockRefreshDashboardState,
}));

vi.mock('./CommandDeck/DeaconStatus', () => ({
  DeaconStatus: () => <section aria-label="Deacon status">Deacon</section>,
}));

const GIB = 1024 ** 3;

function createSnapshot(state: HealthState = 'healthy'): SystemHealthSnapshot {
  const critical = state === 'critical';
  return {
    version: 2,
    state,
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state,
      platform: 'linux',
      reasons: critical
        ? [{
            code: 'host.linux.psi_full.critical',
            domain: 'host',
            severity: 'critical',
            message: 'Current memory pressure is critical.',
          }]
        : [],
      metrics: {
        cpuPercent: 12.5,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.2,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 23 * GIB,
        availableMemoryBytes: 41 * GIB,
        memoryUsedPercent: 35.9,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: critical ? 1 : 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 4 * GIB,
        swapUsedPercent: 50,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 80 * GIB,
        commitLimitBytes: 64 * GIB,
        virtualCommitmentPercent: 125,
      },
    },
    admission: {
      state: critical ? 'blocked' : 'open',
      availableMemoryBytes: 41 * GIB,
      admittedWorkAgentCount: 2,
      reasons: [],
    },
    agents: [],
    services: [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'running',
      message: 'Running',
      reasons: [],
    }],
    topConsumers: critical
      ? [
          {
            id: 'agent-pan-1',
            label: 'agent-pan-1',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-1',
            killTarget: { kind: 'agent', agentId: 'agent-pan-1' },
          },
          {
            id: 'specialist-review-agent',
            label: 'specialist-review-agent',
            type: 'specialist',
            memoryBytes: GIB,
            memoryGb: 1,
            currentIssue: 'PAN-1',
            leaked: true,
            killTarget: {
              kind: 'specialist',
              projectKey: 'overdeck',
              issueId: 'PAN-1',
              specialistType: 'review-agent',
            },
          },
          {
            id: 'container-1',
            label: 'container-1',
            type: 'container',
            memoryBytes: GIB / 2,
            memoryGb: 0.5,
            cpuPercent: 12,
            killTarget: { kind: 'container', containerId: 'abcdef123456' },
          },
        ]
      : [],
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.2,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 23 * GIB,
      availableMemoryBytes: 41 * GIB,
      memoryUsedPercent: 35.9,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 4 * GIB,
      swapUsedPercent: 50,
      committedMemoryBytes: 80 * GIB,
      commitLimitBytes: 64 * GIB,
      overcommitPercent: 125,
      agentCount: 3,
      workAgentCount: 2,
      planningAgentCount: 1,
      specialistSessionCount: 1,
      leakedSpecialistCount: critical ? 1 : 0,
      containerCount: 1,
      containerMemoryBytes: 2 * GIB,
      overdeckMemoryBytes: 3 * GIB,
      overdeckMemoryPercent: 4.7,
      smeeRelay: {
        configured: true,
        running: true,
        status: 'running',
        message: 'Running',
      },
    },
  };
}

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPill() {
  return render(
    <QueryClientProvider client={queryClient()}>
      <DialogProvider>
        <SystemHealthPill />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('system health UI no-loss audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    hookState.current = {
      data: createSnapshot(),
      isLoading: false,
      error: null,
    };
    useDashboardStore.setState({ openIssue: mockOpenIssue });
  });

  it('keeps every header metric and diagnostic visible by name in redesigned layout', () => {
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });

    expect(within(dialog).getByText(
      'All clear · memory at 35.9% · 41 GB spawn headroom · relay running · 0 stalled agents · 0 idle agents · 0 context notes',
    )).toBeInTheDocument();

    const stateBadge = within(dialog).getByRole('status', { name: 'healthy system health' });
    expect(stateBadge).toHaveTextContent('healthy');
    expect(dialog).toHaveClass('w-[min(22rem,calc(100vw-1rem))]');

    // Chip row (new top status row, replaces old 8-tile status grid)
    expect(within(dialog).getByRole('group', { name: 'Admitted work agents: 2' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Containers: 1' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Webhook relay: Running' })).toBeInTheDocument();

    // Vitals tiles (2x2 grid with meter bars, replaces old 8-tile grid)
    expect(within(dialog).getByText('CPU')).toBeInTheDocument();
    expect(within(dialog).getByText('12.5%')).toBeInTheDocument();
    expect(within(dialog).getByText('Load/core 0.20')).toBeInTheDocument();
    expect(within(dialog).getByText('Memory')).toBeInTheDocument();
    expect(within(dialog).getByText('23 GB / 64 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('Avail 41 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('Overdeck')).toBeInTheDocument();
    expect(within(dialog).getByText('3 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('4.7% of host RAM')).toBeInTheDocument();
    expect(within(dialog).getByText('Swap')).toBeInTheDocument();
    expect(within(dialog).getByText('50.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('Overcommit 125.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('No leaks')).toBeInTheDocument();
  });

  it.each([
    {
      label: 'Running',
      status: 'running' as const,
      configured: true,
      running: true,
      groupClass: 'bg-success/10',
      dotClass: 'bg-success',
    },
    {
      label: 'Unavailable',
      status: 'unavailable' as const,
      configured: true,
      running: false,
      groupClass: 'bg-destructive/10',
      dotClass: 'bg-destructive',
    },
    {
      label: 'Not configured',
      status: 'not_configured' as const,
      configured: false,
      running: false,
      groupClass: 'bg-muted/40',
      dotClass: 'bg-muted-foreground',
    },
  ])('distinguishes the relay $label state', ({ label, status, configured, running, groupClass, dotClass }) => {
    const snapshot = createSnapshot();
    hookState.current = {
      data: {
        ...snapshot,
        services: status === 'not_configured'
          ? []
          : [{
              ...snapshot.services[0]!,
              status,
              message: label,
            }],
        summary: {
          ...snapshot.summary,
          smeeRelay: {
            configured,
            running,
            status: status === 'unavailable' ? 'unknown' : status,
            message: label,
          },
        },
      },
      isLoading: false,
      error: null,
    };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const relay = screen.getByRole('group', { name: `Webhook relay: ${label}` });
    expect(relay).toHaveClass(groupClass);
    expect(relay.querySelector('span[aria-hidden="true"]')).toHaveClass(dotClass);
  });

  it('maps vital meter boundaries and distinguishes zero from unavailable', () => {
    const snapshot = createSnapshot();
    hookState.current = {
      data: {
        ...snapshot,
        host: {
          ...snapshot.host,
          metrics: {
            ...snapshot.host.metrics,
            cpuPercent: 59.9,
            memoryUsedPercent: 60,
            swapUsedPercent: 85,
          },
        },
        summary: {
          ...snapshot.summary,
          overdeckMemoryPercent: 0,
        },
      },
      isLoading: false,
      error: null,
    };
    const rendered = renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    let dialog = screen.getByRole('dialog', { name: 'System health' });
    const cpuMeter = within(dialog).getByRole('meter', { name: 'CPU usage' });
    const memoryMeter = within(dialog).getByRole('meter', { name: 'Memory usage' });
    const swapMeter = within(dialog).getByRole('meter', { name: 'Swap usage' });
    const overdeckMeter = within(dialog).getByRole('meter', { name: 'Overdeck memory share' });
    expect(cpuMeter).toHaveClass('bg-success');
    expect(cpuMeter).toHaveStyle({ width: '59.9%' });
    expect(memoryMeter).toHaveClass('bg-warning');
    expect(memoryMeter).toHaveStyle({ width: '60%' });
    expect(swapMeter).toHaveClass('bg-warning');
    expect(swapMeter).toHaveStyle({ width: '85%' });
    expect(overdeckMeter).toHaveStyle({ width: '0%' });

    hookState.current = {
      data: {
        ...snapshot,
        host: {
          ...snapshot.host,
          metrics: {
            ...snapshot.host.metrics,
            cpuPercent: null,
            memoryUsedPercent: 85.1,
          },
        },
      },
      isLoading: false,
      error: null,
    };
    rendered.rerender(
      <QueryClientProvider client={queryClient()}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(within(dialog).queryByRole('meter', { name: 'CPU usage' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Unavailable')).toBeInTheDocument();
    expect(within(dialog).getByRole('meter', { name: 'Memory usage' })).toHaveClass('bg-destructive');
    expect(within(dialog).getByRole('meter', { name: 'Memory usage' })).toHaveStyle({ width: '85.1%' });
  });

  it('retains agent kill, specialist kill, and container remove actions', async () => {
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    fireEvent.click(screen.getByTitle('Kill agent-pan-1'));
    expect(mockConfirmAndKill).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Remove container container-1'));
    let confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/resources/docker/container/abcdef123456',
        { method: 'DELETE' },
      );
    });

    fireEvent.click(screen.getByTitle('Kill specialist specialist-review-agent'));
    confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Kill' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/specialists/overdeck/PAN-1/review-agent/kill',
        { method: 'POST' },
      );
    });
    await waitFor(() => {
      expect(mockRefreshDashboardState).toHaveBeenCalled();
    });
  });

  it('groups top consumers by kind badge and displays proportional memory bars', () => {
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    // Every consumer kind and label stays visible even when a label appears in
    // more than one location, while the leaked-state diagnosis remains present.
    for (const kind of ['Agent', 'Specialist', 'Container']) {
      expect(within(dialog).getAllByText(kind).length).toBeGreaterThan(0);
    }
    for (const label of ['agent-pan-1', 'specialist-review-agent', 'container-1']) {
      expect(within(dialog).getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByText('LEAKED')).toBeInTheDocument();
    expect(within(dialog).getByText('⚠ 1 leaked specialist')).toBeInTheDocument();
  });

  it('exposes each consumer kind badge and proportional memory meter accessibly', () => {
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(within(dialog).getByRole('note', { name: 'Consumer kind: Agent' })).toBeInTheDocument();
    expect(within(dialog).getByRole('note', { name: 'Consumer kind: Specialist' })).toBeInTheDocument();
    expect(within(dialog).getByRole('note', { name: 'Consumer kind: Container' })).toBeInTheDocument();
    expect(within(dialog).getByText('agent-pan-1 · PAN-1')).toBeInTheDocument();
    expect(within(dialog).getByText('specialist-review-agent · PAN-1')).toBeInTheDocument();
    expect(within(dialog).getByText('container-1')).toBeInTheDocument();
    expect(within(dialog).getByRole('meter', { name: 'agent-pan-1 memory share: 100.0%' })).toBeInTheDocument();
    expect(within(dialog).getByRole('meter', { name: 'specialist-review-agent memory share: 100.0%' })).toBeInTheDocument();
    expect(within(dialog).getByRole('meter', { name: 'container-1 memory share: 50.0%' })).toBeInTheDocument();
  });

  it('keeps grouped agent attention rows informational without Open or Kill actions', () => {
    const snapshot = createSnapshot('critical');
    hookState.current = {
      data: {
        ...snapshot,
        agents: [
          {
            id: 'agent-stalled-1',
            issueId: 'PAN-1',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'agent-stalled-1 has produced no activity for 35 min.',
            }],
          },
          {
            id: 'agent-stalled-2',
            issueId: 'PAN-2',
            status: 'stalled',
            reasons: [{
              code: 'agent.runtime.inactive.stalled',
              domain: 'agent',
              severity: 'warning',
              message: 'agent-stalled-2 has produced no activity for 40 min.',
            }],
          },
        ],
        topConsumers: [
          ...snapshot.topConsumers,
          {
            id: 'agent-stalled-1',
            label: 'agent-stalled-1',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-1',
            killTarget: { kind: 'agent', agentId: 'agent-stalled-1' },
          },
          {
            id: 'agent-stalled-2',
            label: 'agent-stalled-2',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-2',
            killTarget: { kind: 'agent', agentId: 'agent-stalled-2' },
          },
        ],
      },
      isLoading: false,
      error: null,
    };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(within(dialog).getAllByRole('img', { name: 'critical attention' }).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('agent activity stalled')).toBeInTheDocument();
    expect(within(dialog).getByText('×2')).toBeInTheDocument();
    expect(within(dialog).getByText('2× agents: agent-stalled-1, agent-stalled-2')).toBeInTheDocument();

    const groupedRow = within(dialog)
      .getByText('2× agents: agent-stalled-1, agent-stalled-2')
      .closest('.text-xs')!;
    expect(within(groupedRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(groupedRow).queryByText('Actions for 2 agents')).not.toBeInTheDocument();
    expect(mockConfirmAndKill).not.toHaveBeenCalled();
    expect(mockOpenIssue).not.toHaveBeenCalled();
  });

  it('keeps context notes visible when no active attention items exist', () => {
    const snapshot = createSnapshot();
    hookState.current = {
      data: {
        ...snapshot,
        host: {
          ...snapshot.host,
          reasons: [{
            code: 'host.current_pressure.unavailable',
            domain: 'host',
            severity: 'info',
            message: 'Current pressure sampling unavailable.',
          }],
        },
      },
      isLoading: false,
      error: null,
    };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    const disclosure = within(dialog).getByText('1 context note — background, not pressure signals').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    expect(within(dialog).getByText('No active pressure signals.')).toBeInTheDocument();
  });

  it('shows singleton identity, duration, Open, and Kill actions when critical', () => {
    const snapshot = createSnapshot('critical');
    hookState.current = {
      data: {
        ...snapshot,
        agents: [{
          id: 'agent-stalled',
          issueId: 'PAN-1',
          status: 'stalled',
          reasons: [{
            code: 'agent.runtime.inactive.stalled',
            domain: 'agent',
            severity: 'warning',
            message: 'agent-stalled has produced no activity for 35 min.',
          }],
        }],
        topConsumers: [
          ...snapshot.topConsumers,
          {
            id: 'agent-stalled',
            label: 'agent-stalled',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-1',
            killTarget: { kind: 'agent', agentId: 'agent-stalled' },
          },
        ],
      },
      isLoading: false,
      error: null,
    };
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    // The row keeps the reason and subject, then exposes actions only when the
    // grouped reason resolves to one concrete agent target.
    expect(within(dialog).getAllByText(/activity stalled/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/agent-stalled/).length).toBeGreaterThan(0);
    const attentionRow = within(dialog).getByText('no activity for 35 min.').closest('.text-xs')!;
    expect(within(attentionRow).getByText('agent-stalled · PAN-1')).toBeInTheDocument();
    expect(within(attentionRow).getByRole('button', { name: 'Open PAN-1' })).toBeInTheDocument();
    expect(within(attentionRow).getByTitle('Kill agent-stalled')).toBeInTheDocument();
  });

  it('emits one critical transition event and makes leaked-first focus reversible', () => {
    const rendered = renderPill();
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };
    rendered.rerender(
      <QueryClientProvider client={queryClient()}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    expect(mockToastError).toHaveBeenCalledTimes(1);
    const toastOptions = mockToastError.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    act(() => toastOptions.action.onClick());

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(within(dialog).getByText(/specialist-review-agent/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/agent-pan-1/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/container-1/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show all' }));
    expect(within(dialog).getByText(/agent-pan-1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/container-1/)).toBeInTheDocument();
  });

  it('keeps agent summary cards, Deacon, and optional TLDR visible on the Health page', async () => {
    const agents: AgentHealthSnapshot[] = [{
      id: 'agent-wedged',
      status: 'wedged',
      reasons: [],
      lifecycle: 'active',
    }];
    hookState.current = {
      data: { ...createSnapshot(), agents },
      isLoading: false,
      error: null,
    };
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/health/agents') return Promise.resolve(jsonResponse(agents));
      if (url === '/api/services/tldr/status') return Promise.resolve(jsonResponse({ daemons: [] }));
      if (url === '/api/specialists/projects') return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }));

    render(
      <QueryClientProvider client={queryClient()}>
        <HealthDashboard />
      </QueryClientProvider>,
    );

    for (const label of [
      'Healthy agents: 0',
      'Idle agents: 0',
      'Waiting agents: 0',
      'Warning agents: 0',
      'Stalled agents: 0',
      'Wedged agents: 1',
      'Dead agents: 0',
      'Unavailable agents: 0',
    ]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Deacon status')).toBeInTheDocument();
    expect(await screen.findByText('TLDR · Not configured (optional)')).toBeInTheDocument();
  });
});
