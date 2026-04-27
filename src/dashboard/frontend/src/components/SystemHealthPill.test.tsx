import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from '../App';
import { DialogProvider } from './DialogProvider';
import { SystemHealthPill } from './SystemHealthPill';
import type { SystemHealthSnapshot } from '../types';

const { mockToastError, mockUseSystemHealth, hookState } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockUseSystemHealth: vi.fn(),
  hookState: {
    current: undefined as { data: SystemHealthSnapshot; isLoading: boolean; error: null } | undefined,
  },
}));

vi.mock('../App', () => ({
  default: () => null,
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

function createSnapshot(severity: SystemHealthSnapshot['severity']): SystemHealthSnapshot {
  return {
    severity,
    updatedAt: '2026-04-27T00:00:00.000Z',
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.2,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 32 * GIB,
      availableMemoryBytes: severity === 'critical' ? Math.floor(1.5 * GIB) : 16 * GIB,
      memoryUsedPercent: 50,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 40,
      agentCount: 3,
      workAgentCount: 2,
      planningAgentCount: 1,
      specialistSessionCount: 1,
      leakedSpecialistCount: severity === 'critical' ? 1 : 0,
      containerCount: 1,
      containerMemoryBytes: 2 * GIB,
      panopticonMemoryBytes: 3 * GIB,
      panopticonMemoryPercent: 4.7,
    },
    thresholds: {
      memoryAvailableWarningBytes: 4 * GIB,
      memoryAvailableCriticalBytes: 2 * GIB,
      swapUsedWarningPercent: 20,
      swapUsedCriticalPercent: 50,
      cpuLoadWarningPerCore: 1,
      cpuLoadCriticalPerCore: 1.5,
      overcommitWarningPercent: 90,
      overcommitCriticalPercent: 100,
    },
    reasons: severity === 'critical' ? ['Available RAM below critical threshold'] : [],
    agents: [],
    leakedSpecialists: severity === 'critical' ? [{ name: 'specialist-pan-1', currentIssue: 'PAN-1', reason: 'parent agent missing' }] : [],
    topConsumers: severity === 'critical'
      ? [
          {
            id: 'specialist-review-agent',
            label: 'specialist-review-agent',
            type: 'specialist',
            memoryBytes: 1 * GIB,
            memoryGb: 1,
            currentIssue: 'PAN-1',
            leaked: true,
            killTarget: {
              kind: 'specialist',
              projectKey: 'panopticon-cli',
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

describe('SystemHealthPill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.current = undefined;
  });

  it('shows a critical toast when severity crosses into critical and opens the panel from the toast action', () => {
    hookState.current = { data: createSnapshot('warning'), isLoading: false, error: null };

    const { rerender, queryClient } = renderPill();
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };
    rerender(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    expect(mockToastError).toHaveBeenCalledWith('System health is critical', expect.objectContaining({
      description: 'Available RAM below critical threshold',
      duration: 10000,
      action: expect.objectContaining({ label: 'Open', onClick: expect.any(Function) }),
    }));

    const toastCall = mockToastError.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    act(() => {
      toastCall.action.onClick();
    });

    expect(screen.getByText('System health')).toBeInTheDocument();
    expect(screen.getByText('Show all')).toBeInTheDocument();
    expect(screen.getByText('specialist-review-agent · PAN-1')).toBeInTheDocument();
  });

  it('does not repeat the toast while severity remains critical', () => {
    const critical = { data: createSnapshot('critical'), isLoading: false, error: null };
    hookState.current = critical;

    const { rerender, queryClient } = renderPill();
    rerender(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('does not toast on warning transitions', () => {
    hookState.current = { data: createSnapshot('normal'), isLoading: false, error: null };

    const { rerender, queryClient } = renderPill();
    hookState.current = { data: createSnapshot('warning'), isLoading: false, error: null };
    rerender(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <SystemHealthPill />
        </DialogProvider>
      </QueryClientProvider>,
    );

    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('renders the dropdown when the pill button is clicked', () => {
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };

    renderPill();
    fireEvent.click(screen.getByTestId('system-health-pill'));

    expect(screen.getByText('System health')).toBeInTheDocument();
    expect(screen.getByText('Top consumers')).toBeInTheDocument();
    expect(screen.getByText('Panopticon')).toBeInTheDocument();
    expect(screen.getByText(/Overcommit 40.0%/)).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
    expect(screen.getAllByText('Kill').length).toBeGreaterThan(0);
  });

  it('adds a pulse class when severity is critical', () => {
    hookState.current = { data: createSnapshot('critical'), isLoading: false, error: null };

    renderPill();

    expect(screen.getByTestId('system-health-pill').className).toContain('animate-pulse');
  });
});
