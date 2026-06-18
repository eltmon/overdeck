import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import type { FlywheelStats } from '@overdeck/contracts';
import { FlywheelStatsPanel } from '../FlywheelStatsPanel';

const stats: FlywheelStats = {
  window: '30d',
  generatedAt: '2026-05-25T10:00:00.000Z',
  criteria: {
    c1_bugRate: {
      label: 'Substrate-bug discovery rate',
      value: 0.01,
      target: 0.02,
      status: 'green',
      trend: 'down',
      sampleSize: 120,
      dataSufficient: true,
    },
    c2_p0Bugs: {
      label: 'Critical/P0 substrate bugs',
      value: 0,
      target: 0,
      status: 'green',
      sampleSize: 120,
      dataSufficient: true,
    },
    c3_passRate: {
      label: 'Pipeline pass success rate',
      value: 0.995,
      target: 0.99,
      status: 'green',
      trend: 'up',
      sampleSize: 120,
      dataSufficient: true,
    },
    c4_mttr: {
      label: 'MTTR for filed substrate bugs',
      value: { medianMs: 3_600_000, p95Ms: 86_400_000 },
      target: { medianMs: 86_400_000, p95Ms: 604_800_000 },
      status: 'yellow',
      trend: 'flat',
      sampleSize: 12,
      dataSufficient: true,
    },
    c5_intervention: {
      label: 'Operator intervention rate',
      value: 0.02,
      target: 0.05,
      status: 'green',
      sampleSize: 120,
      dataSufficient: true,
    },
    c6_timeConsistency: {
      label: 'Time-in-pipeline consistency',
      value: { simple: 1.1, medium: 1.4, complex: 1.8 },
      target: { maxRatio: 2 },
      status: 'green',
      sampleSize: 87,
      dataSufficient: true,
    },
    c7_flake: {
      label: 'Substrate-attributable flake rate',
      value: 0.03,
      target: 0.05,
      status: 'green',
      sampleSize: 20,
      dataSufficient: true,
    },
  },
};

function mockFetchWith(...responses: Response[]) {
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    return response ?? Response.json(stats);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flushStatsLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('FlywheelStatsPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders all seven criteria cards with values, targets, statuses, trends, and sample sizes', async () => {
    mockFetchWith(Response.json(stats));

    render(<FlywheelStatsPanel />);

    expect(await screen.findByText('Substrate-bug discovery rate')).toBeInTheDocument();
    const cards = screen.getAllByRole('region', { name: /metric$/i });
    expect(cards).toHaveLength(7);

    for (const criterion of Object.values(stats.criteria)) {
      const card = screen.getByRole('region', { name: `${criterion.label} metric` });
      expect(within(card).getByText(criterion.label)).toBeInTheDocument();
      expect(within(card).getByText(`Sample size: ${criterion.sampleSize}`)).toBeInTheDocument();
      expect(within(card).getByText(/^Target:/)).toBeInTheDocument();
      expect(within(card).getByLabelText(/Status:/)).toBeInTheDocument();
    }

    expect(within(screen.getByRole('region', { name: 'Substrate-bug discovery rate metric' })).getByText('1.0%')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Substrate-bug discovery rate metric' })).getByLabelText('Trend: ↘ Down')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'MTTR for filed substrate bugs metric' })).getByText(/medianMs: 1.0h/)).toBeInTheDocument();
  });

  it('shows collecting state as neutral when a criterion has insufficient data', async () => {
    const insufficientStats: FlywheelStats = {
      ...stats,
      criteria: {
        ...stats.criteria,
        c1_bugRate: {
          ...stats.criteria.c1_bugRate,
          status: 'red',
          dataSufficient: false,
          sampleSize: 1,
        },
      },
    };
    mockFetchWith(Response.json(insufficientStats));

    render(<FlywheelStatsPanel />);

    const card = await screen.findByRole('region', { name: 'Substrate-bug discovery rate metric' });
    expect(within(card).getByText('collecting since 2026-05-25')).toBeInTheDocument();
    expect(within(card).getByLabelText('Status: Collecting data')).toBeInTheDocument();
    expect(within(card).queryByLabelText('Status: Red')).not.toBeInTheDocument();
  });

  it('uses a constants map for metric tooltip text', async () => {
    mockFetchWith(Response.json(stats));

    render(<FlywheelStatsPanel />);

    const card = await screen.findByRole('region', { name: 'Substrate-attributable flake rate metric' });
    expect(card).toHaveAttribute('title', expect.stringContaining('same head SHA'));
  });

  it('refreshes every 60 seconds and keeps last good data when refresh fails', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchWith(
      Response.json(stats),
      Response.json({ error: 'boom' }, { status: 500 }),
    );

    render(<FlywheelStatsPanel />);
    await flushStatsLoad();

    expect(screen.getByText('Substrate-bug discovery rate')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Failed to refresh Flywheel stats: Request failed \(500\)/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Substrate-bug discovery rate metric' })).toBeInTheDocument();
  });
});
