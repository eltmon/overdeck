import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUatStackSummary, resolveUatStackState, UatStackStatus } from './UatStackStatus';
import type { WorkspaceContainerStatus } from './ZoneCOverviewTabs/queries';

function container(overrides: Partial<WorkspaceContainerStatus> = {}): WorkspaceContainerStatus {
  return {
    running: true,
    uptime: '2m',
    status: 'running',
    health: 'healthy',
    ...overrides,
  };
}

describe('UAT stack status semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies the healthy, starting, unhealthy, stopped, and stale matrix', () => {
    expect(resolveUatStackState({
      containers: {
        api: container(),
        frontend: container(),
      },
      stackHealth: { healthy: true, reasons: [], lastObserved: '2026-06-29T12:00:00.000Z' },
    })).toBe('healthy');

    expect(resolveUatStackState({
      containers: {
        api: container({ health: 'starting', uptime: '8s' }),
        frontend: container(),
      },
      stackHealth: { healthy: false, reasons: [], lastObserved: '2026-06-29T12:00:00.000Z' },
      pending: true,
    })).toBe('starting');

    expect(resolveUatStackState({
      containers: {
        api: container({
          running: false,
          uptime: null,
          status: 'exited (1)',
          health: 'unknown',
          lastFailureReason: 'connection refused',
        }),
        frontend: container(),
      },
      stackHealth: { healthy: false, reasons: ['api unhealthy: connection refused'], lastObserved: '2026-06-29T12:00:00.000Z' },
    })).toBe('unhealthy');

    expect(resolveUatStackState({
      containers: {
        api: container({ running: false, uptime: null, status: 'exited (0)', health: 'unhealthy' }),
        frontend: container({ running: false, uptime: null, status: 'exited (255)', health: 'unhealthy' }),
      },
      stackHealth: { healthy: false, reasons: ['api exited'], lastObserved: '2026-06-29T12:00:00.000Z' },
    })).toBe('stopped');

    expect(resolveUatStackState({
      containers: {
        api: container(),
      },
      stackHealth: { healthy: true, reasons: [], lastObserved: '2026-06-29T12:00:00.000Z' },
      lifecycle: 'merged',
    })).toBe('stale');
  });

  it('summarizes a cleanly stopped stack as stopped, inactive, and non-red', () => {
    const summary = getUatStackSummary({
      containers: {
        api: container({
          running: false,
          uptime: null,
          status: 'exited (0)',
          health: 'unknown',
          lastProbeAt: '2026-06-28T12:00:00.000Z',
        }),
        frontend: container({
          running: false,
          uptime: null,
          status: 'exited (255)',
          health: 'unknown',
          lastProbeAt: '2026-06-28T12:00:00.000Z',
        }),
      },
      stackHealth: { healthy: false, reasons: ['api exited'], lastObserved: '2026-06-29T12:00:00.000Z' },
    });

    expect(summary?.state).toBe('stopped');
    expect(summary?.label).toBe('UAT stack stopped 1d');
    expect(summary?.active).toBe(false);

    render(
      <UatStackStatus
        containers={{
          api: container({ running: false, uptime: null, status: 'exited (0)', health: 'unknown' }),
        }}
        stackHealth={{ healthy: false, reasons: ['api exited'], lastObserved: '2026-06-29T12:00:00.000Z' }}
      />,
    );

    const status = screen.getByTestId('uat-stack-status');
    expect(screen.getByText('UAT stack stopped')).toBeTruthy();
    expect(status.querySelector('.animate-spin')).toBeNull();
    expect(status.querySelector('.text-destructive')).toBeNull();
    expect(status.querySelector('.text-muted-foreground')).toBeTruthy();
  });

  it('summarizes failed exits with a failure reason as unhealthy and renders the reason', () => {
    const summary = getUatStackSummary({
      containers: {
        api: container({
          running: false,
          uptime: null,
          status: 'exited (1)',
          health: 'unknown',
          lastFailureReason: 'connection refused',
        }),
        frontend: container(),
      },
      stackHealth: { healthy: false, reasons: ['api unhealthy: connection refused'], lastObserved: '2026-06-29T12:00:00.000Z' },
    });

    expect(summary?.state).toBe('unhealthy');
    expect(summary?.label).toBe('UAT stack 1/2 unhealthy');
    expect(summary?.active).toBe(true);

    render(
      <UatStackStatus
        containers={{
          api: container({
            running: false,
            uptime: null,
            status: 'exited (1)',
            health: 'unknown',
            lastFailureReason: 'connection refused',
          }),
          frontend: container(),
        }}
        stackHealth={{ healthy: false, reasons: ['api unhealthy: connection refused'], lastObserved: '2026-06-29T12:00:00.000Z' }}
      />,
    );

    expect(screen.getByText('UAT stack 1/2 unhealthy')).toBeTruthy();
    expect(screen.getByText('api unhealthy: connection refused')).toBeTruthy();
    expect(screen.getByTestId('uat-stack-status').querySelector('.text-destructive')).toBeTruthy();
  });

  it('renders tree density as flat container rows without the compact card chrome', () => {
    render(
      <UatStackStatus
        density="tree"
        containers={{
          postgres: container({ uptime: '2m' }),
          api: container({
            running: false,
            uptime: null,
            status: 'exited (0)',
            health: 'unknown',
            lastProbeAt: '2026-06-28T12:00:00.000Z',
          }),
        }}
        stackHealth={{ healthy: false, reasons: ['api exited'], lastObserved: '2026-06-29T12:00:00.000Z' }}
      />,
    );

    const status = screen.getByTestId('uat-stack-status');
    expect(status.className).not.toContain('rounded-md');
    expect(status.className).not.toContain('border');
    expect(status.className).not.toContain('bg-muted');
    expect(status.innerHTML).not.toContain('border-border');
    expect(screen.getByText('postgres')).toBeTruthy();
    expect(screen.getByText('Up 2m')).toBeTruthy();
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('exited (0) 1d ago')).toBeTruthy();
  });

  it('preserves compact density card rendering', () => {
    render(
      <UatStackStatus
        density="compact"
        containers={{
          postgres: container({ uptime: '2m' }),
        }}
        stackHealth={{ healthy: true, reasons: [], lastObserved: '2026-06-29T12:00:00.000Z' }}
      />,
    );

    expect(screen.getByTestId('uat-stack-status').className).toContain('rounded-md border border-border bg-muted/20');
  });
});
