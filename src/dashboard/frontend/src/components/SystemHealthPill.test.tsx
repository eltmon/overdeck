import type { HealthState, SystemHealthSnapshot } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from './DialogProvider';
import { SystemHealthPill } from './SystemHealthPill';

const { mockToastError, mockUseSystemHealth, hookState } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUseSystemHealth: vi.fn(),
  hookState: {
    current: undefined as { data: SystemHealthSnapshot; isLoading: boolean; error: null } | undefined,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
  },
}));

vi.mock('../hooks/useSystemHealth', () => ({
  useSystemHealth: () => {
    mockUseSystemHealth();
    return hookState.current;
  },
}));

const { mockConfirmAndKill, mockRefreshDashboardState } = vi.hoisted(() => ({
  mockConfirmAndKill: vi.fn(),
  mockRefreshDashboardState: vi.fn().mockResolvedValue(undefined),
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

const GIB = 1024 ** 3;

function createSnapshot(state: HealthState): SystemHealthSnapshot {
  const hostReason = state === 'critical'
    ? [{
        code: 'host.linux.psi_full.critical',
        domain: 'host' as const,
        severity: 'critical' as const,
        message: 'Current memory pressure is critical.',
      }]
    : state === 'unavailable'
      ? [{
          code: 'host.current_pressure.unavailable',
          domain: 'host' as const,
          severity: 'critical' as const,
          message: 'Current pressure is unavailable.',
        }]
      : [];
  const admissionReason = state === 'warning'
    ? [{
        code: 'admission.memory_available.soft',
        domain: 'admission' as const,
        severity: 'warning' as const,
        message: 'Available memory is below the warning admission reserve.',
      }]
    : [];

  return {
    version: 2,
    state,
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state,
      platform: state === 'unavailable' ? 'unsupported' : 'linux',
      reasons: hostReason,
      metrics: {
        cpuPercent: state === 'unavailable' ? null : 12.5,
        loadAverage1m: state === 'unavailable' ? null : 1.2,
        loadPerCore1m: state === 'unavailable' ? null : 0.2,
        totalMemoryBytes: state === 'unavailable' ? null : 64 * GIB,
        usedMemoryBytes: state === 'unavailable' ? null : 23 * GIB,
        availableMemoryBytes: state === 'unavailable' ? null : 41 * GIB,
        memoryUsedPercent: state === 'unavailable' ? null : 35.9,
        memoryPressureSomeAvg10: state === 'unavailable' ? null : 0,
        memoryPressureFullAvg10: state === 'unavailable' ? null : 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: state === 'unavailable' ? null : 8 * GIB,
        swapUsedBytes: state === 'unavailable' ? null : 0,
        swapUsedPercent: state === 'unavailable' ? null : 0,
        swapActivityBytesPerMinute: state === 'unavailable' ? null : 0,
        committedMemoryBytes: state === 'unavailable' ? null : 24 * GIB,
        commitLimitBytes: state === 'unavailable' ? null : 72 * GIB,
        virtualCommitmentPercent: state === 'unavailable' ? null : 33.3,
      },
    },
    admission: {
      state: state === 'warning' ? 'soft' : state === 'critical' ? 'blocked' : state === 'unavailable' ? 'unavailable' : 'open',
      availableMemoryBytes: state === 'unavailable' ? null : state === 'critical' ? Math.floor(1.5 * GIB) : 41 * GIB,
      admittedWorkAgentCount: 2,
      reasons: admissionReason,
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
    topConsumers: state === 'critical'
      ? [
          {
            id: 'agent-pan-1',
            label: 'agent-pan-1',
            type: 'agent',
            memoryBytes: GIB,
            memoryGb: 1,
            issueId: 'PAN-1',
            killTarget: {
              kind: 'agent',
              agentId: 'agent-pan-1',
            },
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
            memoryBytes: 512 * 1024 * 1024,
            memoryGb: 0.5,
            cpuPercent: 12,
            killTarget: {
              kind: 'container',
              containerId: 'abcdef123456',
            },
          },
        ]
      : [],
    summary: {
      cpuPercent: state === 'unavailable' ? 0 : 12.5,
      loadAverage1m: state === 'unavailable' ? 0 : 1.2,
      loadPerCore1m: state === 'unavailable' ? 0 : 0.2,
      totalMemoryBytes: state === 'unavailable' ? 0 : 64 * GIB,
      usedMemoryBytes: state === 'unavailable' ? 0 : 23 * GIB,
      availableMemoryBytes: state === 'unavailable' ? 0 : 41 * GIB,
      memoryUsedPercent: state === 'unavailable' ? 0 : 35.9,
      swapTotalBytes: state === 'unavailable' ? 0 : 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      committedMemoryBytes: state === 'unavailable' ? 0 : 24 * GIB,
      commitLimitBytes: state === 'unavailable' ? 0 : 72 * GIB,
      overcommitPercent: state === 'unavailable' ? 0 : 33.3,
      agentCount: 3,
      workAgentCount: 2,
      planningAgentCount: 1,
      specialistSessionCount: 1,
      leakedSpecialistCount: state === 'critical' ? 1 : 0,
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

function renderPill(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    ),
  };
}

function setSnapshot(state: HealthState) {
  hookState.current = { data: createSnapshot(state), isLoading: false, error: null };
}

describe('SystemHealthPill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.current = undefined;
  });

  it.each([
    ['healthy', 'Healthy · 41 GB available', 'healthy'],
    ['measuring', 'Measuring system health…', 'measuring'],
    ['warning', 'Warning · spawn headroom tight', 'warning'],
    ['critical', 'Critical · memory pressure detected', 'critical'],
    ['unavailable', 'Health unavailable · Retry', 'unavailable'],
  ] as const)('renders distinct %s copy and icon', (state, copy, icon) => {
    setSnapshot(state);

    renderPill();

    const pill = screen.getByTestId('system-health-pill');
    expect(pill).toHaveAccessibleName(copy);
    expect(pill.querySelector(`[data-health-icon="${icon}"]`)).toBeInTheDocument();
    if (state === 'healthy' || state === 'measuring') {
      expect(pill.querySelector('[data-health-icon="warning"]')).not.toBeInTheDocument();
    }
  });

  it('selects the primary label by structured reason code, not message text', () => {
    const snapshot = createSnapshot('critical');
    snapshot.host.reasons = [{
      code: 'host.linux.swap_activity.critical',
      domain: 'host',
      severity: 'critical',
      message: 'This wording is deliberately unrelated to swap.',
      observed: 2 * GIB,
    }];
    hookState.current = { data: snapshot, isLoading: false, error: null };

    renderPill();

    expect(screen.getByTestId('system-health-pill')).toHaveAccessibleName('Critical · 2 GB swap activity/min');
    expect(screen.getByTestId('system-health-pill')).not.toHaveTextContent(snapshot.host.reasons[0]!.message);
  });

  it('shows one critical transition toast and opens leaked consumers from its action', () => {
    setSnapshot('warning');
    const { rerender, queryClient } = renderPill();
    setSnapshot('critical');
    rerender(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith('System health is critical', expect.objectContaining({
      description: 'Current memory pressure is critical.',
      duration: 10000,
      action: expect.objectContaining({ label: 'Open', onClick: expect.any(Function) }),
    }));

    const toastCall = mockToastError.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    act(() => toastCall.action.onClick());

    expect(screen.getByRole('dialog', { name: 'System health' })).toBeInTheDocument();
    expect(screen.getByText('Show all')).toBeInTheDocument();
    expect(screen.getByText('specialist-review-agent · PAN-1')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('exposes dialog relationships and restores trigger focus after Escape', async () => {
    setSnapshot('healthy');
    renderPill();
    const trigger = screen.getByTestId('system-health-pill');

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'System health' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', dialog.id);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'System health' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('dismisses on an outside pointer and restores trigger focus', async () => {
    setSnapshot('healthy');
    renderPill();
    const trigger = screen.getByTestId('system-health-pill');

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('dialog', { name: 'System health' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps critical semantics without forcing animation under reduced motion', () => {
    setSnapshot('critical');

    renderPill();

    const classes = screen.getByTestId('system-health-pill').className.split(' ');
    expect(classes).toContain('motion-safe:animate-pulse');
    expect(classes).not.toContain('animate-pulse');
    expect(screen.getByTestId('system-health-pill')).toHaveAccessibleName(/Critical/);
  });

  it('preserves agent kill confirmation and container removal invalidation', async () => {
    setSnapshot('critical');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = renderPill();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByTestId('system-health-pill'));
    fireEvent.click(screen.getByTitle('Kill agent-pan-1'));
    expect(mockConfirmAndKill).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Remove container container-1'));
    const confirmation = await screen.findByRole('alertdialog');
    expect(within(confirmation).getByText('Remove Container')).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/resources/docker/container/abcdef123456',
      { method: 'DELETE' },
    ));
    await waitFor(() => expect(mockRefreshDashboardState).toHaveBeenCalledWith(queryClient));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['system-health'] }));

    vi.unstubAllGlobals();
  });
});
