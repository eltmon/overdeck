import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MachineRoom } from './MachineRoom';
import type { ResourceStack, ResourcesSnapshot } from '../../types';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('wires service and stack stop buttons to their resource endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
    render(<MachineRoom snapshot={fixtureSnapshot({ stacks: [stack('PAN-2464')] })} />);

    expandStack('PAN-2464');
    const serviceRow = within(screen.getByTestId('stack-card')).getByText('feature-pan-2464-api').closest('div')!;
    fireEvent.click(within(serviceRow).getByText('Stop'));
    fireEvent.click(screen.getAllByText('Stop')[0]!);

    await waitFor(() => expect(destructiveCalls(fetchMock)).toHaveLength(2));
    expect(destructiveCalls(fetchMock)).toEqual([
      ['/api/resources/docker/container/c-api/stop', { method: 'POST' }],
      ['/api/resources/stacks/PAN-2464/stop', { method: 'POST' }],
    ]);
  });

  it('keeps teardown confirm disabled until typed text matches and posts the estimate token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/teardown-estimate')) {
        return new Response(JSON.stringify({
          issueId: 'PAN-2464',
          composeProject: 'feature-pan-2464',
          ramBytes: 3 * 1024 ** 3,
          diskBytes: 2 * 1024 ** 3,
          confirmToken: 'confirm-1',
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render(<MachineRoom snapshot={fixtureSnapshot({ stacks: [stack('PAN-2464')] })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tear down' }));
    expect(await screen.findByText('frees 3 GB RAM · 2 GB disk')).toBeTruthy();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Tear down' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type feature-pan-2464'), { target: { value: 'feature-pan' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type feature-pan-2464'), { target: { value: 'feature-pan-2464' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/resources/stacks/PAN-2464/teardown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmToken: 'confirm-1', typedText: 'feature-pan-2464' }),
    }));
  });

  it('does not send destructive requests when rendering cards or opening the teardown modal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      issueId: 'PAN-2464',
      composeProject: 'feature-pan-2464',
      ramBytes: 1,
      diskBytes: 2,
      confirmToken: 'confirm-1',
    }), { status: 200 }));
    render(<MachineRoom snapshot={fixtureSnapshot({ stacks: [stack('PAN-2464')] })} />);

    expect(destructiveCalls(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tear down' }));
    await screen.findByLabelText('Type feature-pan-2464');

    expect(fetchMock).toHaveBeenCalledWith('/api/resources/stacks/PAN-2464/teardown-estimate');
    expect(destructiveCalls(fetchMock)).toHaveLength(0);
  });

  it('renders Unpause for a paused service and posts unpause on click', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<MachineRoom snapshot={fixtureSnapshot({ stacks: [stack('PAN-2464', { services: [service('c-api', 'feature-pan-2464-api', 'paused')] })] })} />);

    expandStack('PAN-2464');
    fireEvent.click(screen.getByText('Unpause'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/resources/docker/container/c-api/unpause', { method: 'POST' }));
  });
});

function fixtureSnapshot(overrides: Partial<ResourcesSnapshot> = {}): ResourcesSnapshot {
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
    ...overrides,
  };
}

function expandStack(issueId: string) {
  const card = screen.getByTestId('stack-card');
  const toggle = within(card).getByRole('button', { name: new RegExp(issueId) });
  fireEvent.click(toggle);
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

function stack(issueId: string, overrides: Partial<ResourceStack> = {}): ResourceStack {
  const services = overrides.services ?? [service('c-api', 'feature-pan-2464-api')];
  return {
    id: issueId,
    issueId,
    issueTitle: `${issueId} stack`,
    composeProject: `feature-${issueId.toLowerCase()}`,
    serviceCount: services.length,
    services,
    aggregates: { cpuPercent: 1, memoryBytes: 3 * 1024 ** 3, diskBytes: 2 * 1024 ** 3 },
    phase: 'work',
    ...overrides,
  };
}

function service(id: string, name: string, status: 'running' | 'stopped' | 'paused' = 'running') {
  return {
    id,
    name,
    cpuPercent: 1,
    memoryUsage: 1,
    memoryLimit: 2,
    memoryPercent: 50,
    networkIn: 0,
    networkOut: 0,
    status,
  };
}

function destructiveCalls(fetchMock: { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } }) {
  return fetchMock.mock.calls.filter(([, init]) => {
    const method = init?.method?.toUpperCase();
    return method === 'POST' || method === 'DELETE';
  });
}
