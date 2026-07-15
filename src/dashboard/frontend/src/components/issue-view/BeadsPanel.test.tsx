import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeadsPanel } from './BeadsPanel';

const response = {
  issueId: 'PAN-2499',
  workspacePath: '/tmp/workspace',
  tasks: [
    { id: 'done', title: 'Completed item', status: 'closed', labels: [], blockedBy: [] },
    { id: 'working', title: 'Current item', status: 'in_progress', labels: [], blockedBy: [] },
    { id: 'open', title: 'Upcoming item', status: 'open', labels: [], blockedBy: [] },
  ],
  lastSyncedAt: null,
  freshnessAgeMs: null,
  stale: false,
  syncError: null,
};

function renderPanel(compact = false) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BeadsPanel issueId="PAN-2499" compact={compact} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('BeadsPanel', () => {
  it('renders plan progress plus completed, working, and open items', async () => {
    renderPanel();
    expect(await screen.findByText('Completed item')).toBeInTheDocument();
    expect(screen.getByText('Current item')).toBeInTheDocument();
    expect(screen.getByText('Upcoming item')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === '1 / 3 · 33%')).toBeInTheDocument();
  });

  it('renders the compact rail count and progress', async () => {
    renderPanel(true);
    expect(await screen.findByText('beads 1/3 · 33%')).toHaveAttribute('data-section', 'beads-panel-compact');
  });
});
