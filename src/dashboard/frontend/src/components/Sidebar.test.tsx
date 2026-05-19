import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from './Sidebar';
import type { Tab } from './Header';

vi.mock('./CloisterStatusBar', () => ({ CloisterStatusBar: () => <div data-testid="cloister-status" /> }));
vi.mock('./FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('./DeaconPauseToggle', () => ({
  DeaconPauseToggle: () => <button type="button">Pause Deacon</button>,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

function renderSidebar(options: { activeTab?: Tab; runs?: Array<{ id: string; status: string }> } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
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

  const { container } = render(
    <QueryClientProvider client={client}>
      <Sidebar activeTab={options.activeTab ?? 'pipeline'} onTabChange={onTabChange} onSearchOpen={onSearchOpen} />
    </QueryClientProvider>,
  );

  return { container, onTabChange, fetchMock };
}

describe('Sidebar navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/version') {
        return new Response(JSON.stringify({ version: '0.9.3', isDev: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  it('orders Operations as Pipeline, Board, Command Deck, Agents, AutoPreso with the migration tooltip', () => {
    const { container, onTabChange } = renderSidebar({ activeTab: 'pipeline' });

    const operationLabels = Array.from(container.querySelectorAll('nav [data-testid^="sidebar-"]'))
      .slice(0, 5)
      .map((button) => button.textContent?.trim());

    expect(operationLabels).toEqual(['Pipeline', 'Board', 'Command Deck', 'Agents', 'AutoPreso']);
    expect(screen.getByTestId('sidebar-pipeline')).toHaveAttribute('title', 'Awaiting Merge → filter on Pipeline');
    expect(screen.queryByTestId('sidebar-awaiting-merge')).toBeNull();

    fireEvent.click(screen.getByTestId('sidebar-pipeline'));
    expect(onTabChange).toHaveBeenCalledWith('pipeline');
  });

  it('routes the expanded logo to Pipeline', () => {
    const { onTabChange } = renderSidebar({ activeTab: 'kanban' });

    const logo = screen.getByTitle('Go to Pipeline');
    fireEvent.click(logo);
    expect(onTabChange).toHaveBeenCalledWith('pipeline');
  });

  it('keeps collapsed-mode icons clickable', () => {
    localStorage.setItem('panopticon.ui.sidebarCollapsed', 'true');
    const { onTabChange } = renderSidebar({ activeTab: 'kanban' });

    const logo = screen.getByTitle('Go to Pipeline');
    fireEvent.click(logo);
    expect(onTabChange).toHaveBeenCalledWith('pipeline');

    const pipelineButton = screen.getByTestId('sidebar-pipeline');
    expect(pipelineButton).toHaveAttribute('title', 'Awaiting Merge → filter on Pipeline');
    expect(pipelineButton).toHaveTextContent('');

    fireEvent.click(pipelineButton);
    expect(onTabChange).toHaveBeenCalledWith('pipeline');
  });
});
