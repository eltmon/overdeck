/** PAN-4651 WI-24 (D-4651-19): the Costs → Machines panel. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FleetUsagePanel } from '../FleetUsagePanel';

const w = (totalCost: number) => ({ totalCost, totalTokens: 0, entryCount: 1 });
const ANSWER = {
  machines: [
    { environmentId: 'env-laptop', label: 'laptop', self: true, state: 'self', cached: false, fetchedAt: '2026-11-01T12:00:00.000Z', today: w(1), week: w(5), month: w(20) },
    { environmentId: 'env-lab', label: 'lab', self: false, state: 'offline', cached: true, fetchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), today: w(7), week: w(8), month: w(9) },
  ],
  allMachines: { today: w(7.6), week: w(13), month: w(28.6) },
  duplicates: { today: w(0.4), week: w(0.4), month: { totalCost: 0.4, totalTokens: 0, entryCount: 1 } },
};

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ANSWER), { status: 200 }))));
afterEach(() => vi.unstubAllGlobals());

describe('FleetUsagePanel (PAN-4651 WI-24)', () => {
  it('ac24: renders each machine, cached text for an offline one, and an All machines row', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FleetUsagePanel /></QueryClientProvider>);
    const lab = await screen.findByTestId('fleet-usage-row-lab');
    expect(within(lab).getByText(/^cached /)).toBeTruthy();
    expect(within(lab).getByText('$7.00')).toBeTruthy();
    const footer = screen.getByText('All machines').closest('tr') as HTMLElement;
    expect(within(footer).getByText('$7.60')).toBeTruthy();
    expect(within(footer).getByText('$28.60')).toBeTruthy();
    expect(screen.getByText(/counts 1 request recorded on two machines once/)).toBeTruthy();
  });
});
