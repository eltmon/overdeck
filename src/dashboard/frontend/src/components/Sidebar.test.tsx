import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import type { Tab } from './Header';

vi.mock('./CloisterStatusBar', () => ({
  CloisterStatusBar: () => <div data-testid="cloister-status" />,
}));
vi.mock('./FreshnessIndicator', () => ({
  FreshnessIndicator: () => <div data-testid="freshness-indicator" />,
}));
vi.mock('./DeaconPauseToggle', () => ({
  DeaconPauseToggle: () => <button type="button">Pause deacon</button>,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

function renderSidebar(options: { activeTab?: Tab; runs?: Array<{ id: string; status: string }> } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const onTabChange = vi.fn();
  const onSearchOpen = vi.fn();
  const runs = options.runs ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/version') {
      return Response.json({ version: '0.5.0', isDev: false });
    }
    if (url === '/api/flywheel/runs?limit=10') {
      return Response.json(runs);
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <QueryClientProvider client={client}>
      <Sidebar activeTab={options.activeTab ?? 'command-deck'} onTabChange={onTabChange} onSearchOpen={onSearchOpen} />
    </QueryClientProvider>,
  );

  return { onTabChange, fetchMock };
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('places Flywheel last in the Operations group and navigates to the flywheel tab', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderSidebar();

    const operationsItems = ['Command Deck', 'Board', 'Awaiting Merge', 'Agents', 'AutoPreso', 'Flywheel'];
    expect(operationsItems.map((label) => screen.getByText(label).textContent)).toEqual(operationsItems);

    await user.click(screen.getByTestId('sidebar-flywheel'));

    expect(onTabChange).toHaveBeenCalledWith('flywheel');
  });

  it('shows a live badge when a Flywheel run is active', async () => {
    renderSidebar({ runs: [{ id: 'RUN-1', status: 'running' }] });

    await expect.poll(() => screen.queryByText('live')).toBeTruthy();
  });

  it('does not show a live badge without an active Flywheel run', async () => {
    const { fetchMock } = renderSidebar({ runs: [{ id: 'RUN-1', status: 'complete' }] });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/runs?limit=10'));

    expect(screen.queryByText('live')).toBeNull();
  });
});
