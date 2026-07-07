import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MachineRoom } from './MachineRoom';
import type { ResourcesSnapshot } from '../../types';

describe('MachineRoom shell', () => {
  it('renders six vitals cells from hostVitals including sparkline and pressure bars', () => {
    render(<MachineRoom snapshot={fixtureSnapshot()} />);

    expect(screen.getByText('Machine Room')).toBeTruthy();
    expect(screen.getByText('CPU')).toBeTruthy();
    expect(screen.getByText('Memory')).toBeTruthy();
    expect(screen.getByText('Disk')).toBeTruthy();
    expect(screen.getByText('Docker')).toBeTruthy();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Spawn gate')).toBeTruthy();
    expect(screen.getByLabelText('CPU sparkline')).toBeTruthy();
  });

  it("focuses filter on '/' and filters rows by issue/container/process substring", () => {
    render(<MachineRoom snapshot={fixtureSnapshot()} />);

    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByLabelText('Filter resources')).toBe(document.activeElement);

    fireEvent.change(screen.getByLabelText('Filter resources'), { target: { value: 'api' } });
    expect(screen.getByText('feature-pan-2464-api')).toBeTruthy();
    expect(screen.queryByText('feature-pan-999-db')).toBeNull();
  });

  it('dispatches S/P/L action callbacks for the focused row', () => {
    const onStop = vi.fn();
    const onPause = vi.fn();
    const onLogs = vi.fn();
    render(<MachineRoom snapshot={fixtureSnapshot()} onStop={onStop} onPause={onPause} onLogs={onLogs} />);

    const row = screen.getByText('feature-pan-2464-api').closest('button');
    fireEvent.focus(row!);
    fireEvent.keyDown(window, { key: 'S' });
    fireEvent.keyDown(window, { key: 'P' });
    fireEvent.keyDown(window, { key: 'L' });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onLogs).toHaveBeenCalledTimes(1);
  });

  it("renders a stale badge when the snapshot is stale", () => {
    render(<MachineRoom snapshot={{ ...fixtureSnapshot(), stale: true }} />);

    expect(screen.getByText('stale')).toBeTruthy();
  });
});

function fixtureSnapshot(): ResourcesSnapshot {
  return {
    updatedAt: '2026-07-07T12:00:00.000Z',
    containers: [
      container('abc123def456', 'feature-pan-2464-api'),
      container('def456abc789', 'feature-pan-999-db'),
    ],
    agents: [
      {
        id: 'agent-pan-2464',
        issueId: 'PAN-2464',
        runtime: 'codex',
        model: 'codex-test',
        status: 'running',
        startedAt: '2026-07-07T11:00:00.000Z',
        consecutiveFailures: 0,
        killCount: 0,
      },
    ],
    hostVitals: {
      stale: false,
      cpu: { percent: 42, load: [1, 2, 3], spark: [10, 20, 30] },
      mem: { usedBytes: 6 * 1024 ** 3, availableBytes: 2 * 1024 ** 3, swapUsedBytes: 1, swapTotalBytes: 2 },
      disk: { usedBytes: 70, freeBytes: 30, reclaimableBytes: 0 },
      docker: { containers: 2, running: 1, stacks: 2, networks: 4, networkPool: { used: 4, total: 31 }, stale: false },
      agents: { sessions: 1, active: 1, idleOver15m: 0, burnUsdPerHour: 1, hypotheticalUsdPerHour: 0, totalUsd: 2 },
    },
  };
}

function container(id: string, name: string) {
  return {
    id,
    name,
    cpuPercent: 1,
    memoryUsage: 1,
    memoryLimit: 2,
    memoryPercent: 50,
    networkIn: 0,
    networkOut: 0,
    status: 'running' as const,
  };
}
