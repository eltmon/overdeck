import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResourcesPanel } from './ResourcesPanel';
import type { ResourcesSnapshot } from '../types';

vi.mock('../hooks/useResourceStats', () => ({
  useResourceStats: vi.fn(),
}));

global.fetch = vi.fn();

const mockSnapshot: ResourcesSnapshot = {
  containers: [
    {
      id: 'abc123def456',
      name: 'feature-pan-100-api',
      cpuPercent: 15,
      memoryUsage: 100 * 1024 ** 2,
      memoryLimit: 512 * 1024 ** 2,
      memoryPercent: 19.5,
      networkIn: 0,
      networkOut: 0,
      status: 'running',
    },
  ],
  agents: [
    {
      id: 'agent-pan-100',
      issueId: 'PAN-100',
      runtime: 'claude-code',
      model: 'claude-sonnet-4-5',
      status: 'healthy',
      startedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      killCount: 0,
    },
  ],
  hostVitals: {
    stale: false,
    cpu: { percent: 12, load: [1, 2, 3], spark: [2, 8, 12] },
    mem: { usedBytes: 6, availableBytes: 2, swapUsedBytes: 0, swapTotalBytes: 0 },
    disk: { usedBytes: 7, freeBytes: 3, reclaimableBytes: 0 },
    docker: { containers: 1, running: 1, stacks: 1, networks: 2, networkPool: { used: 2, total: 31 }, stale: false },
    agents: { sessions: 1, active: 1, idleOver15m: 0, burnUsdPerHour: 0, hypotheticalUsdPerHour: 0, totalUsd: 0 },
  },
  updatedAt: new Date().toISOString(),
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResourcesPanel', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSnapshot),
    } as Response);
  });

  it('renders the Machine Room shell when data loads', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Machine Room')).toBeTruthy());
    expect(screen.getByText('feature-pan-100-api')).toBeTruthy();
    expect(screen.getAllByText('agent-pan-100').length).toBeGreaterThan(0);
  });

  it('shows error message on fetch failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeTruthy());
  });
});
