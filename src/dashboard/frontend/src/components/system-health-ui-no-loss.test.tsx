import type {
  AgentHealthSnapshot,
  HealthState,
  SystemHealthSnapshot,
} from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from './DialogProvider';
import { HealthDashboard } from './HealthDashboard';
import { SystemHealthPill } from './SystemHealthPill';

const {
  hookState,
  mockConfirmAndKill,
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
  });

  it('keeps every header metric and diagnostic visible by name', () => {
    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    const dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(within(dialog).getByText('CPU')).toBeInTheDocument();
    expect(within(dialog).getByText('12.5%')).toBeInTheDocument();
    expect(within(dialog).getByText('Load/core 0.20')).toBeInTheDocument();
    expect(within(dialog).getByText('23 GB / 64 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('Avail 41 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('Overdeck')).toBeInTheDocument();
    expect(within(dialog).getByText('3 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('4.7% of host RAM')).toBeInTheDocument();
    expect(within(dialog).getByText('Swap')).toBeInTheDocument();
    expect(within(dialog).getByText('50.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('Overcommit 125.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('Admitted work agents')).toBeInTheDocument();
    expect(within(dialog).getByText('2')).toBeInTheDocument();
    expect(within(dialog).getByText('Containers')).toBeInTheDocument();
    expect(within(dialog).getByText('Webhook relay')).toBeInTheDocument();
    expect(within(dialog).getByText('Running')).toBeInTheDocument();
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
