import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { MetricsSummaryRow } from './MetricsSummaryRow';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockMetricsData = {
  today: { totalCost: 1.23, agentCount: 5, activeCount: 3, stuckCount: 1, warningCount: 0 },
  topSpenders: { agents: [], issues: [] },
};

const mockHandoffStats = {
  totalHandoffs: 10, byTrigger: {}, successRate: 0.9,
};

const mockSpecialistStats = {
  totalHandoffs: 4, todayCount: 2, successRate: 0.95, queueDepth: 1,
};

describe('MetricsSummaryRow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/metrics/summary')) {
        return Promise.resolve({ ok: true, json: async () => mockMetricsData });
      }
      if (url.includes('/api/handoffs/stats')) {
        return Promise.resolve({ ok: true, json: async () => mockHandoffStats });
      }
      if (url.includes('/api/specialist-handoffs/stats')) {
        return Promise.resolve({ ok: true, json: async () => mockSpecialistStats });
      }
      return Promise.resolve({ ok: false });
    }));
  });

  it('renders metric tile labels', async () => {
    render(<MetricsSummaryRow />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Cost Today')).toBeInTheDocument();
    });
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Stuck')).toBeInTheDocument();
  });

  it('displays cost value from API', async () => {
    render(<MetricsSummaryRow />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText('$1.23')).toBeInTheDocument();
    });
  });

  it('displays agent count ratio from API', async () => {
    render(<MetricsSummaryRow />, { wrapper: createWrapper() });
    await waitFor(() => {
      // activeCount / agentCount = "3 / 5"
      expect(screen.getByText('3 / 5')).toBeInTheDocument();
    });
  });

  it('renders without crashing on API failure', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(() => render(<MetricsSummaryRow />, { wrapper: createWrapper() })).not.toThrow();
  });
});
