import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStats } from '@overdeck/contracts';

import { FlywheelStatsPanel } from '../FlywheelStatsPanel';
import { renderWithQuery, stubFetch } from './fixtures';

function stats(overrides: Partial<FlywheelStats['criteria']> = {}, days = 30): FlywheelStats {
  return {
    window: { days, since: '2026-08-24T00:00:00.000Z', until: '2026-09-23T00:00:00.000Z' },
    generatedAt: '2026-09-23T00:00:00.000Z',
    criteria: {
      c1_bugRate: { value: 0.15, count: 3, denominator: 20, status: 'yellow', trend: 'down', dataSufficient: true },
      c2_p0Bugs: { value: 0, status: 'green', trend: 'flat', dataSufficient: true },
      ...overrides,
    },
    bugs: [{ number: 3960, title: 'Merge door wedge', createdAt: '2026-09-10T00:00:00.000Z', closedAt: null, severity: 'P1' }],
  };
}

describe('FlywheelStatsPanel (PAN-3964 FR-10)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders c1/c2 with status tones and trend arrows, plus the bug list', async () => {
    stubFetch((url) => (url.startsWith('/api/flywheel/stats') ? Response.json(stats()) : undefined));
    renderWithQuery(<FlywheelStatsPanel />);
    const c1 = await screen.findByRole('region', { name: 'Discovery rate metric' });
    expect(within(c1).getByText('0.15')).toBeInTheDocument();
    expect(within(c1).getByText('Yellow')).toHaveAttribute('data-tone', 'warning');
    expect(within(c1).getByLabelText('Trend: down')).toHaveTextContent('↘ down');
    const c2 = screen.getByRole('region', { name: 'P0 bugs metric' });
    expect(within(c2).getByText('Green')).toHaveAttribute('data-tone', 'success');
    expect(within(c2).getByLabelText('Trend: flat')).toHaveTextContent('→ flat');
    expect(screen.getByText('Merge door wedge')).toBeInTheDocument();
  });

  it('says "collecting since" when data is insufficient', async () => {
    stubFetch((url) => (url.startsWith('/api/flywheel/stats')
      ? Response.json(stats({ c1_bugRate: { value: 0.5, count: 2, denominator: 4, status: 'red', trend: 'up', dataSufficient: false } }))
      : undefined));
    renderWithQuery(<FlywheelStatsPanel />);
    const c1 = await screen.findByRole('region', { name: 'Discovery rate metric' });
    expect(within(c1).getByText('collecting since 2026-08-24')).toBeInTheDocument();
    expect(within(c1).getByText('Collecting')).toHaveAttribute('data-tone', 'neutral');
  });

  it('refetches with ?window= when the window changes', async () => {
    const fetchMock = stubFetch((url) => (url.startsWith('/api/flywheel/stats') ? Response.json(stats()) : undefined));
    renderWithQuery(<FlywheelStatsPanel />);
    await screen.findByRole('region', { name: 'Discovery rate metric' });
    expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/stats?window=30');
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/stats?window=7'));
    fireEvent.click(screen.getByRole('button', { name: '90d' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/stats?window=90'));
  });
});
