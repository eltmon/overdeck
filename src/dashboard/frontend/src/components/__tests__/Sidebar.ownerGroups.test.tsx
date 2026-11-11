/**
 * PAN-5153 W9: the sidebar groups projects under collapsible GitHub-owner
 * headers when the projects span two or more owners.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../Sidebar';
import { useDashboardStore } from '../../lib/store';
import { COLLAPSED_OWNERS_KEY } from '../sidebar/projectOwners';

vi.mock('../FreshnessIndicator', () => ({ FreshnessIndicator: () => <div data-testid="freshness-indicator" /> }));
vi.mock('../DeaconPauseToggle', () => ({ DeaconPauseToggle: () => <button type="button">Pause Deacon</button> }));
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }) }));

type RegisteredProject = { key: string; name: string; path: string; githubRepo: string | null };

function renderSidebar(registered: RegisteredProject[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/version') return Response.json({ version: '1.0.0', isDev: false });
    if (url === '/api/workspace-registry') return Response.json({ workspaces: [] });
    if (url === '/api/registered-projects') return Response.json(registered);
    if (url === '/api/issues/resource-allocated') return Response.json([]);
    if (url === '/api/conversations') return Response.json([]);
    return Response.json({});
  }));
  render(
    <QueryClientProvider client={client}>
      <Sidebar activeTab="command-deck" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  useDashboardStore.setState({
    issuesRaw: [],
    agentsById: {},
    derivedIssueStateByIssueId: {},
    backendPanesById: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar owner groups (PAN-5153)', () => {
  it('collapses one owner\'s projects and remembers it', async () => {
    renderSidebar([
      { key: 'myn', name: 'MYN', path: '/myn', githubRepo: 'mindyournow/myn-cli' },
      { key: 'overdeck', name: 'Overdeck', path: '/overdeck', githubRepo: 'eltmon/overdeck' },
    ]);

    const header = await screen.findByTestId('sidebar-owner-mindyournow');
    expect(screen.getByTestId('sidebar-owner-eltmon')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-project-MYN')).toBeInTheDocument();
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);

    expect(screen.queryByTestId('sidebar-project-MYN')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-project-Overdeck')).toBeInTheDocument();
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem(COLLAPSED_OWNERS_KEY) ?? '[]')).toEqual(['mindyournow']);
  });

  it('renders no owner headers when every project has one owner', async () => {
    renderSidebar([
      { key: 'overdeck', name: 'Overdeck', path: '/overdeck', githubRepo: 'eltmon/overdeck' },
      { key: 'krux', name: 'Krux', path: '/krux', githubRepo: 'eltmon/krux' },
    ]);

    await screen.findByTestId('sidebar-project-Overdeck');
    expect(screen.queryByTestId(/^sidebar-owner-/)).not.toBeInTheDocument();
  });
});
